import { lookup } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';

// Somente consultas. Nunca cria pagamento, altera configuração ou envia webhook.
export async function checkSandboxRemote(
  env,
  { fetchImpl = fetch, lookupImpl = lookup, now = () => new Date() } = {},
) {
  const report = {
    checkedAt: now().toISOString(),
    testMode: env.MERCADO_PAGO_TEST_MODE === 'true',
    tokenPresent: Boolean(env.MERCADO_PAGO_TEST_ACCESS_TOKEN?.trim()),
    publicKeyPresent: Boolean(env.MERCADO_PAGO_TEST_PUBLIC_KEY?.trim()),
    webhookSecretPresent: Boolean(env.MERCADO_PAGO_WEBHOOK_SECRET?.trim()),
    automaticWebhook: 'pending',
  };
  if (!report.testMode) return report;

  if (report.tokenPresent) {
    try {
      const response = await fetchImpl('https://api.mercadopago.com/users/me', {
        headers: {
          Authorization: `Bearer ${env.MERCADO_PAGO_TEST_ACCESS_TOKEN}`,
        },
        signal: AbortSignal.timeout(12_000),
      });
      const account = await response.json().catch(() => null);
      report.merchant = {
        httpStatus: response.status,
        testUser: response.ok && account?.tags?.includes('test_user') === true,
        brazil: response.ok && account?.site_id === 'MLB',
      };
    } catch {
      report.merchant = { reachable: false };
    }
  }

  let url;
  try {
    url = new URL(env.MERCADO_PAGO_NOTIFICATION_URL ?? '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/payments/webhook' ||
      url.search ||
      url.hash ||
      !url.hostname.includes('.') ||
      /(^|\.)(localhost|local|example|invalid|test)$|^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./i.test(
        url.hostname,
      )
    )
      throw new Error('invalid_endpoint');
  } catch {
    report.endpoint = { valid: false };
    return report;
  }
  report.endpoint = { valid: true };
  try {
    await lookupImpl(url.hostname);
    report.endpoint.dnsResolved = true;
  } catch (error) {
    report.endpoint.dnsResolved = false;
    report.endpoint.errorCode = ['ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)
      ? error.code
      : 'DNS_ERROR';
    return report;
  }
  for (const [label, path] of [
    ['health', '/health'],
    ['webhook', '/payments/webhook'],
  ]) {
    try {
      const response = await fetchImpl(new URL(path, url), {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000),
      });
      report.endpoint[label] = { httpStatus: response.status };
      await response.body?.cancel();
    } catch {
      report.endpoint[label] = { reachable: false };
    }
  }
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { config } = await import('dotenv');
  config({ quiet: true });
  const report = await checkSandboxRemote(process.env);
  console.log(JSON.stringify(report, null, 2));
  console.log(
    'Consultas sem cobrança. Recebimento automático de webhook continua pendente.',
  );
  const reachable =
    report.endpoint?.dnsResolved &&
    report.endpoint.health?.httpStatus === 200 &&
    Number.isInteger(report.endpoint.webhook?.httpStatus);
  process.exitCode =
    report.testMode &&
    report.tokenPresent &&
    report.publicKeyPresent &&
    report.webhookSecretPresent &&
    report.merchant?.testUser &&
    report.merchant?.brazil &&
    reachable
      ? 0
      : 1;
}
