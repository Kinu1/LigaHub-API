import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

const { initialize, create } = vi.hoisted(() => ({
  initialize: vi.fn(),
  create: vi.fn(),
}));
vi.mock('../config/runtime.config.js', () => ({
  initializeLambdaRuntime: initialize,
}));
vi.mock('../bootstrap.js', async () => {
  const { default: express } = await import('express');
  const app = express();
  app.use(express.json());
  app.post('/echo', (req, res) => {
    res.cookie('session', 'abc', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
    res.cookie('csrf', 'def', { secure: true });
    res.json({
      path: req.path,
      query: req.query,
      body: req.body,
      cookie: req.headers.cookie,
      auth: req.headers.authorization,
      csrf: req.headers['x-csrf-token'],
      idempotency: req.headers['idempotency-key'],
      signature: req.headers['x-signature'],
    });
  });
  return {
    createHttpApplication: () => {
      create();
      return {
        init: vi.fn(),
        getHttpAdapter: () => ({ getInstance: () => app }),
      };
    },
  };
});

function event(path = '/api/echo'): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: 'value=a%2Bb',
    headers: {
      'x-ligahub-origin': 'a'.repeat(40),
      'content-type': 'application/json',
      authorization: 'Bearer test',
      'x-csrf-token': 'csrf',
      'idempotency-key': 'key',
      'x-signature': 'signature',
    },
    cookies: ['session=old', 'csrf=old'],
    body: Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64'),
    isBase64Encoded: true,
    requestContext: {
      http: {
        method: 'POST',
        path,
        sourceIp: '127.0.0.1',
        protocol: 'HTTP/1.1',
        userAgent: 'test',
      },
    },
  } as APIGatewayProxyEventV2;
}
const context = { callbackWaitsForEmptyEventLoop: true } as Context;
beforeEach(() => {
  vi.resetModules();
  initialize.mockReset();
  create.mockReset();
  vi.stubEnv('CLOUDFRONT_ORIGIN_SECRET', 'a'.repeat(40));
});
afterEach(() => vi.unstubAllEnvs());

describe('Function URL adapter', () => {
  it('rejects missing/wrong origin before fetching secrets or bootstrapping', async () => {
    const { handler } = await import('./api.js');
    const request = event();
    request.headers['x-ligahub-origin'] = 'wrong';
    expect(await handler(request, context)).toMatchObject({ statusCode: 403 });
    expect(initialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('preserves body, cookies, query, auth, CSRF, idempotency, webhook headers and response cookies', async () => {
    const { handler } = await import('./api.js');
    const result = await handler(event(), context);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(
      Buffer.from(
        result.body!,
        result.isBase64Encoded ? 'base64' : 'utf8',
      ).toString(),
    );
    expect(body).toEqual({
      path: '/echo',
      query: { value: 'a+b' },
      body: { hello: 'world' },
      cookie: 'session=old; csrf=old',
      auth: 'Bearer test',
      csrf: 'csrf',
      idempotency: 'key',
      signature: 'signature',
    });
    expect(result.cookies).toHaveLength(2);
    await handler(event(), context);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('returns 503 on failed bootstrap and retries on the next invocation', async () => {
    initialize
      .mockRejectedValueOnce(new Error('secret'))
      .mockResolvedValue(undefined);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = await import('./api.js');
    expect(await handler(event(), context)).toMatchObject({
      statusCode: 503,
      body: '{"message":"Service unavailable"}',
    });
    expect((await handler(event(), context)).statusCode).toBe(200);
    log.mockRestore();
  });

  it('strips only one exact prefix', async () => {
    const { stripApiPrefix } = await import('./api.js');
    for (const [input, output] of [
      ['/api', '/'],
      ['/api/api/events', '/api/events'],
      ['/apiculture', '/apiculture'],
    ]) {
      expect(stripApiPrefix(event(input)).rawPath).toBe(output);
    }
  });

  it('uses the viewer IP overwritten by CloudFront, without trusting X-Forwarded-For', async () => {
    const { stripApiPrefix } = await import('./api.js');
    const request = event();
    request.headers['x-forwarded-for'] = 'spoofed';
    request.headers['x-ligahub-client-ip'] = '2001:db8::1';
    expect(stripApiPrefix(request).requestContext.http.sourceIp).toBe(
      '2001:db8::1',
    );
    request.headers['x-ligahub-client-ip'] = 'invalid';
    expect(stripApiPrefix(request).requestContext.http.sourceIp).toBe(
      '127.0.0.1',
    );
  });
});
