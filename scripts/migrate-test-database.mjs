import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { testDatabaseEnvironment } from './test-database.mjs';

const selected = testDatabaseEnvironment();
const result = spawnSync(
  process.execPath,
  [
    'node_modules/prisma/build/index.js',
    'migrate',
    'deploy',
    '--config',
    'prisma7.config.ts',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, ...selected },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
