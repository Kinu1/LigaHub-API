import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send, destroy } = vi.hoisted(() => ({
  send: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = send;
    destroy = destroy;
  },
  GetParameterCommand: class {
    constructor(public input: unknown) {}
  },
}));

const config = {
  DATABASE_URL: 'postgresql://test:secret@localhost:6543/db?sslmode=require',
  JWT_SECRET: 'a'.repeat(40),
  CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  FRONTEND_URL: 'https://example.com',
};

beforeEach(() => {
  vi.resetModules();
  send.mockReset();
  destroy.mockReset();
  for (const [key, value] of Object.entries({
    ...config,
    NODE_ENV: 'production',
    DEPLOYMENT_ENV: 'homologation',
    EMAIL_PROVIDER: 'resend',
    EMAIL_DELIVERY_ENABLED: 'false',
    MERCADO_PAGO_TEST_MODE: 'true',
    API_DOCS_ENABLED: 'false',
    BACKGROUND_TIMERS_ENABLED: 'false',
    BACKGROUND_JOBS_ENABLED: 'false',
    RUNTIME_CONFIG_PARAMETER: '/test/config',
    CORS_ORIGINS: 'https://example.com',
  }))
    vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

describe('Lambda runtime configuration', () => {
  it('rejects protected/unknown keys, non-string values and malformed documents without values in errors', async () => {
    const { parseRuntimeConfig } = await import('./runtime.config.js');
    for (const value of [
      'null',
      '[]',
      '{bad',
      '{"AWS_REGION":"secret"}',
      '{"BACKGROUND_JOBS_ENABLED":"true"}',
      '{"DATABASE_URL":12}',
    ]) {
      expect(() => parseRuntimeConfig(value)).toThrow(
        'Invalid runtime configuration document.',
      );
    }
    expect(
      parseRuntimeConfig('{"EMAIL_FROM":"LigaHub <test@example.com>"}'),
    ).toEqual({ EMAIL_FROM: 'LigaHub <test@example.com>' });
  });

  it('loads and decrypts SSM once for concurrent/warm invocations', async () => {
    send.mockResolvedValue({ Parameter: { Value: JSON.stringify(config) } });
    const { initializeLambdaRuntime } = await import('./runtime.config.js');
    await Promise.all([initializeLambdaRuntime(), initializeLambdaRuntime()]);
    await initializeLambdaRuntime();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].input).toEqual({
      Name: '/test/config',
      WithDecryption: true,
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('fails closed, redacts SDK errors and retries initialization after failure', async () => {
    send
      .mockRejectedValueOnce(new Error('database password secret'))
      .mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(config) } });
    const { initializeLambdaRuntime } = await import('./runtime.config.js');
    await expect(initializeLambdaRuntime()).rejects.toThrow(
      'Runtime configuration unavailable.',
    );
    await expect(initializeLambdaRuntime()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not partially apply an invalid document', async () => {
    send.mockResolvedValue({
      Parameter: {
        Value: JSON.stringify({
          JWT_SECRET: 'short',
          FRONTEND_URL: 'https://changed.com',
        }),
      },
    });
    const { initializeLambdaRuntime } = await import('./runtime.config.js');
    await expect(initializeLambdaRuntime()).rejects.toThrow(
      'Runtime configuration unavailable.',
    );
    expect(process.env.FRONTEND_URL).toBe('https://example.com');
  });

  it.each([
    { JWT_SECRET: '' },
    { CREDENTIALS_ENCRYPTION_KEY: 'bad' },
    { MERCADO_PAGO_TEST_MODE: 'false' },
    { BACKGROUND_TIMERS_ENABLED: 'true' },
    { BACKGROUND_JOBS_ENABLED: 'true' },
    { FRONTEND_URL: 'http://example.com' },
    { CORS_ORIGINS: '*' },
    { EMAIL_DELIVERY_ENABLED: 'true', RESEND_API_KEY: '' },
  ])('rejects unsafe configuration %o', async (changes) => {
    const { validateLambdaConfig } = await import('./runtime.config.js');
    expect(() =>
      validateLambdaConfig({ ...process.env, ...changes }),
    ).toThrow();
  });
});
