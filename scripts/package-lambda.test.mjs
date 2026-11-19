import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertCommunicationsLogo } from './package-lambda.mjs';
test('Lambda build requires current source logo byte-for-byte in dist', async () => {
  const root = resolve('.test-temp');
  await mkdir(root, { recursive: true });
  const fixture = await mkdtemp(join(root, 'communications-logo-'));
  try {
    await mkdir(join(fixture, 'src/assets'), { recursive: true });
    await mkdir(join(fixture, 'dist/assets'), { recursive: true });
    const logo = await readFile('src/assets/logo-lauen.png');
    await writeFile(join(fixture, 'src/assets/logo-lauen.png'), logo);
    await assert.rejects(assertCommunicationsLogo(fixture));
    await writeFile(join(fixture, 'dist/assets/logo-lauen.png'), logo);
    await assert.doesNotReject(assertCommunicationsLogo(fixture));
    await writeFile(
      join(fixture, 'dist/assets/logo-lauen.png'),
      Buffer.from('outdated'),
    );
    await assert.rejects(
      assertCommunicationsLogo(fixture),
      /missing or changed/,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
