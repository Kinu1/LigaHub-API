import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSandboxRemote } from './check-mercado-pago-remote.mjs';

const env = {
  MERCADO_PAGO_TEST_MODE: 'true',
  MERCADO_PAGO_TEST_ACCESS_TOKEN: 'token-ficticio-nao-usar',
  MERCADO_PAGO_TEST_PUBLIC_KEY: 'publica-ficticia',
  MERCADO_PAGO_WEBHOOK_SECRET: 'assinatura-ficticia',
  MERCADO_PAGO_NOTIFICATION_URL:
    'https://sandbox.ligahub.com.br/payments/webhook',
};
const accountResponse = () =>
  Response.json({
    id: 'identificador-privado',
    email: 'nao-publicar@example.com',
    tags: ['test_user'],
    site_id: 'MLB',
  });

test('não consulta credenciais quando o modo de teste não é explícito', async () => {
  let calls = 0;
  const report = await checkSandboxRemote(
    { ...env, MERCADO_PAGO_TEST_MODE: 'false' },
    {
      fetchImpl: async () => {
        calls++;
        throw new Error('proibido');
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(report.testMode, false);
});

test('registra DNS indisponível sem criar operação nem expor valores', async () => {
  const calls = [];
  const report = await checkSandboxRemote(env, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return accountResponse();
    },
    lookupImpl: async () => {
      throw Object.assign(new Error(env.MERCADO_PAGO_NOTIFICATION_URL), {
        code: 'ENOTFOUND',
      });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.mercadopago.com/users/me');
  assert.equal(report.endpoint.errorCode, 'ENOTFOUND');
  assert.equal(report.merchant.testUser, true);
  const output = JSON.stringify(report);
  for (const value of [
    ...Object.values(env),
    'identificador-privado',
    'nao-publicar@example.com',
  ]) {
    if (value === 'true') continue;
    assert.equal(output.includes(value), false);
  }
});

test('consulta HTTPS somente por GET e não considera isso homologação automática', async () => {
  const calls = [];
  const report = await checkSandboxRemote(env, {
    lookupImpl: async () => ({ address: '203.0.113.20', family: 4 }),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return String(url).endsWith('/users/me')
        ? accountResponse()
        : new Response(null, {
            status: String(url).endsWith('/health') ? 200 : 404,
          });
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[2].options.method, 'GET');
  assert.equal(calls[1].options.redirect, 'manual');
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(report.automaticWebhook, 'pending');
  assert.equal(report.endpoint.webhook.httpStatus, 404);
});

test('rejeita URL com credenciais ou host local sem consultar o endpoint', async () => {
  let lookups = 0;
  for (const endpoint of [
    'https://usuario:senha@sandbox.ligahub.com.br/payments/webhook',
    'https://127.0.0.1/payments/webhook',
  ]) {
    const report = await checkSandboxRemote(
      { ...env, MERCADO_PAGO_NOTIFICATION_URL: endpoint },
      {
        fetchImpl: async () => accountResponse(),
        lookupImpl: async () => {
          lookups++;
        },
      },
    );
    assert.equal(report.endpoint.valid, false);
  }
  assert.equal(lookups, 0);
});
