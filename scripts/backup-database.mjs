import { spawn } from 'node:child_process';
import { mkdir, open, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export function dumpOptions(connectionString, output) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Invalid DIRECT_URL.');
  const password = decodeURIComponent(url.password);
  url.password = '';
  return {
    args: [
      '--dbname',
      url.toString(),
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--file',
      resolve(output),
    ],
    env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '15' },
  };
}

async function run(command, args, env) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      env,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // pg_dump errors may contain sensitive connection information; never relay stderr.
    child.stderr.resume();
    child.on('error', () => reject(new Error(`${command} unavailable.`)));
    child.on('close', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`${command} failed.`)),
    );
  });
}

export async function backupDatabase(output, bucket) {
  if (!process.env.DIRECT_URL || !output)
    throw new Error('DIRECT_URL and output path are required.');
  if (bucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error('Invalid backup bucket.');
  const file = resolve(output);
  const options = dumpOptions(process.env.DIRECT_URL, file);
  await mkdir(dirname(file), { recursive: true });
  // Exclusive creation protects existing backups; restrict POSIX permissions.
  const handle = await open(file, 'wx', 0o600);
  await handle.close();
  try {
    await run('pg_dump', options.args, options.env);
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
  if (bucket) {
    const key = `database/${new Date().toISOString().replaceAll(':', '-')}.dump`;
    await run(
      'aws',
      [
        's3',
        'cp',
        file,
        `s3://${bucket}/${key}`,
        '--sse',
        'AES256',
        '--only-show-errors',
      ],
      process.env,
    );
  }
  return file;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await backupDatabase(process.argv[2], process.env.BACKUP_BUCKET);
    console.log('Backup completed.');
  } catch {
    console.error(
      'Backup failed. Check DIRECT_URL, pg_dump, output path and AWS permissions.',
    );
    process.exitCode = 1;
  }
}
