import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function packageLambda(
  artifacts,
  { platform = process.platform, run = spawnSync } = {},
) {
  if (platform !== 'linux')
    throw new Error('Build Lambda on Linux with sam build --use-container.');
  if (!artifacts) throw new Error('ARTIFACTS_DIR is required.');
  const output = resolve(artifacts);
  const scratch = await mkdtemp(join(tmpdir(), 'ligahub-build-'));
  try {
    // Explicit allowlist: never copy .env, local repos, backups, or Windows binaries.
    for (const path of [
      'package.json',
      'package-lock.json',
      'nest-cli.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'prisma7.config.ts',
      'src',
      'prisma',
    ]) {
      await cp(resolve(path), join(scratch, path), {
        recursive: true,
        filter: (source) =>
          !source.replaceAll('\\', '/').includes('/src/generated/'),
      });
    }
    const env = {
      ...process.env,
      DATABASE_URL: 'postgresql://build:build@localhost:5432/build',
      DIRECT_URL: '',
    };
    const execute = (args) => {
      const result = run('npm', args, {
        cwd: scratch,
        env,
        stdio: 'inherit',
        shell: false,
      });
      if (result.error || result.status !== 0)
        throw new Error('Lambda build command failed.');
    };
    execute(['ci']);
    execute(['run', 'db:generate']);
    execute(['run', 'build']);
    execute(['prune', '--omit=dev']);
    await mkdir(output, { recursive: true });
    for (const path of ['dist', 'node_modules'])
      await cp(join(scratch, path), join(output, path), { recursive: true });
    const pkg = JSON.parse(
      await readFile(join(scratch, 'package.json'), 'utf8'),
    );
    await writeFile(
      join(output, 'package.json'),
      JSON.stringify({
        name: pkg.name,
        version: pkg.version,
        type: pkg.type,
        dependencies: pkg.dependencies,
      }),
    );
  } finally {
    // scratch was created by mkdtemp under the OS temporary directory.
    await rm(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await packageLambda(process.argv[2]);
}
