import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const allowedKeys = new Set([
  'DATABASE_URL',
  'JWT_SECRET',
  'CREDENTIALS_ENCRYPTION_KEY',
  'FRONTEND_URL',
  'CORS_ORIGINS',
  'EMAIL_FROM',
  'RESEND_API_KEY',
  'MERCADO_PAGO_CLIENT_ID',
  'MERCADO_PAGO_CLIENT_SECRET',
  'MERCADO_PAGO_REDIRECT_URI',
  'MERCADO_PAGO_WEBHOOK_SECRET',
  'MERCADO_PAGO_NOTIFICATION_URL',
  'MERCADO_PAGO_TEST_ACCESS_TOKEN',
  'MERCADO_PAGO_TEST_PUBLIC_KEY',
  'MERCADO_PAGO_TEST_OWNER_EMAIL',
]);

export function parseRuntimeConfig(value: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    const result: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (!allowedKeys.has(key) || typeof entry !== 'string') throw new Error();
      result[key] = entry;
    }
    return result;
  } catch {
    throw new Error('Invalid runtime configuration document.');
  }
}

export function validateLambdaConfig(env: NodeJS.ProcessEnv): void {
  const requireValue = (key: string) => {
    if (!env[key]?.trim())
      throw new Error(`Missing runtime configuration: ${key}.`);
  };
  for (const key of [
    'DATABASE_URL',
    'JWT_SECRET',
    'CREDENTIALS_ENCRYPTION_KEY',
    'FRONTEND_URL',
  ])
    requireValue(key);
  if (env.JWT_SECRET!.length < 32)
    throw new Error('JWT_SECRET must have at least 32 characters.');
  const key = Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY!, 'base64');
  if (
    key.length !== 32 ||
    key.toString('base64') !== env.CREDENTIALS_ENCRYPTION_KEY
  ) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be 32 bytes in base64.');
  }
  const database = new URL(env.DATABASE_URL!);
  if (!['postgres:', 'postgresql:'].includes(database.protocol))
    throw new Error('Invalid database protocol.');
  for (const name of [
    'FRONTEND_URL',
    'MERCADO_PAGO_REDIRECT_URI',
    'MERCADO_PAGO_NOTIFICATION_URL',
  ]) {
    if (env[name] && new URL(env[name]!).protocol !== 'https:')
      throw new Error(`${name} must use HTTPS.`);
  }
  for (const origin of env.CORS_ORIGINS?.split(',') ?? []) {
    const url = new URL(origin.trim());
    if (url.protocol !== 'https:' || url.origin !== origin.trim())
      throw new Error('Invalid CORS origin.');
  }
  if (
    env.BACKGROUND_TIMERS_ENABLED !== 'false' ||
    env.BACKGROUND_JOBS_ENABLED !== 'false'
  ) {
    throw new Error('Lambda timers and public HTTP jobs must be disabled.');
  }
  if (env.DEPLOYMENT_ENV === 'homologation') {
    if (
      env.NODE_ENV !== 'production' ||
      env.MERCADO_PAGO_TEST_MODE !== 'true' ||
      env.EMAIL_PROVIDER !== 'resend' ||
      env.API_DOCS_ENABLED !== 'false'
    ) {
      throw new Error('Unsafe homologation runtime configuration.');
    }
  }
  if (env.EMAIL_DELIVERY_ENABLED === 'true') {
    requireValue('RESEND_API_KEY');
    requireValue('EMAIL_FROM');
  }
}

let initialization: Promise<void> | undefined;

export function initializeLambdaRuntime(): Promise<void> {
  initialization ??= loadRuntimeConfig().catch(() => {
    initialization = undefined;
    // SDK and URL errors can contain connection strings or secret values.
    throw new Error('Runtime configuration unavailable.');
  });
  return initialization;
}

async function loadRuntimeConfig(): Promise<void> {
  let config: Record<string, string> = {};
  if (process.env.RUNTIME_CONFIG_PARAMETER) {
    const client = new SSMClient({
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
    });
    try {
      const response = await client.send(
        new GetParameterCommand({
          Name: process.env.RUNTIME_CONFIG_PARAMETER,
          WithDecryption: true,
        }),
      );
      config = parseRuntimeConfig(response.Parameter?.Value ?? '');
    } finally {
      client.destroy();
    }
  }
  validateLambdaConfig({ ...process.env, ...config });
  Object.assign(process.env, config);
}
