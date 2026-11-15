import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { parse } from 'dotenv';

test('gera chaves sem ativar repasses, preserva credenciais e não imprime o segredo', () => {
  const parent = resolve('.test-temp', 'payout-key-tests');
  mkdirSync(parent, { recursive: true });
  const cwd = mkdtempSync(resolve(parent, 'fixture-'));
  const script = fileURLToPath(
    new URL('./setup-payout-keys.mjs', import.meta.url),
  );
  writeFileSync(
    resolve(cwd, '.env'),
    'MERCADO_PAGO_CLIENT_SECRET=segredo-ficticio-preservado\nCREDENTIALS_ENCRYPTION_KEY=chave-ficticia-preservada\n',
  );
  const run = () =>
    spawnSync(process.execPath, [script, '--configure-local'], {
      cwd,
      encoding: 'utf8',
    });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const env = parse(readFileSync(resolve(cwd, '.env')));
  assert.equal(env.MERCADO_PAGO_PAYOUTS_ENABLED, 'false');
  assert.equal(env.MERCADO_PAGO_PIX_PLATFORM_ACCOUNT_ID, '');
  assert.equal(env.MERCADO_PAGO_CLIENT_SECRET, 'segredo-ficticio-preservado');
  assert.equal(env.CREDENTIALS_ENCRYPTION_KEY, 'chave-ficticia-preservada');
  assert.ok(
    !first.stdout.includes(env.MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64),
  );
  const key = createPrivateKey(
    Buffer.from(env.MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64, 'base64'),
  );
  assert.equal(key.asymmetricKeyType, 'ed25519');
  assert.equal(
    readFileSync(
      resolve(cwd, '.test-temp/mercado-pago-payouts/public.pem'),
      'utf8',
    ),
    createPublicKey(key).export({ type: 'spki', format: 'pem' }),
  );
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(
    parse(readFileSync(resolve(cwd, '.env')))
      .MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64,
    env.MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64,
  );
  writeFileSync(
    resolve(cwd, '.env'),
    'MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64=outra-chave-ficticia\n',
  );
  const refused = run();
  assert.notEqual(refused.status, 0);
  assert.equal(
    readFileSync(resolve(cwd, '.env'), 'utf8'),
    'MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64=outra-chave-ficticia\n',
  );
});
