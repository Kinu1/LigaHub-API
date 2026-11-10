import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dumpOptions } from './backup-database.mjs';
import { packageLambda } from './package-lambda.mjs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('dump keeps password out of process arguments and handles URL encoding', () => {
  const result = dumpOptions(
    'postgresql://postgres:a%24%27%3B%26@localhost:5432/test?sslmode=require',
    'backup.dump',
  );
  assert.equal(result.env.PGPASSWORD, "a$';&");
  assert.equal(
    result.args[1],
    'postgresql://postgres@localhost:5432/test?sslmode=require',
  );
  assert.ok(result.args.includes('--no-owner'));
});

test('Lambda package rejects Windows binaries before invoking npm', async () => {
  await assert.rejects(packageLambda('output', { platform: 'win32' }), /Linux/);
});

test('Lambda package needs an output directory', async () => {
  await assert.rejects(
    packageLambda(undefined, { platform: 'linux' }),
    /ARTIFACTS_DIR/,
  );
});

test('package builds from an allowlist and exports only runtime artifacts', async () => {
  const output = await mkdtemp(join(tmpdir(), 'ligahub-package-test-'));
  const commands = [];
  try {
    await packageLambda(output, {
      platform: 'linux',
      run: (_command, args, options) => {
        commands.push(args);
        assert.equal(options.shell, false);
        assert.equal(options.env.DIRECT_URL, '');
        assert.equal(
          options.env.DATABASE_URL,
          'postgresql://build:build@localhost:5432/build',
        );
        if (args[1] === 'build') {
          mkdirSync(join(options.cwd, 'dist'), { recursive: true });
          mkdirSync(join(options.cwd, 'node_modules'), { recursive: true });
          writeFileSync(join(options.cwd, 'dist', 'main.js'), '// mock build');
        }
        return { status: 0 };
      },
    });
    assert.deepEqual(commands, [
      ['ci'],
      ['run', 'db:generate'],
      ['run', 'build'],
      ['prune', '--omit=dev'],
    ]);
    assert.deepEqual((await readdir(output)).sort(), [
      'dist',
      'node_modules',
      'package.json',
    ]);
    const pkg = JSON.parse(
      await readFile(join(output, 'package.json'), 'utf8'),
    );
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.devDependencies, undefined);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
