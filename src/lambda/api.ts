import 'reflect-metadata';
import { configure as serverlessExpress } from '@codegenie/serverless-express';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { initializeLambdaRuntime } from '../config/runtime.config.js';

type ProxyHandler = ReturnType<
  typeof serverlessExpress<
    APIGatewayProxyEventV2,
    APIGatewayProxyStructuredResultV2
  >
>;
let application: Promise<ProxyHandler> | undefined;

export function validOrigin(
  headers: APIGatewayProxyEventV2['headers'],
): boolean {
  const expected = process.env.CLOUDFRONT_ORIGIN_SECRET ?? '';
  const supplied =
    Object.entries(headers).find(
      ([key]) => key.toLowerCase() === 'x-ligahub-origin',
    )?.[1] ?? '';
  const actual = Buffer.from(supplied);
  const secret = Buffer.from(expected);
  return (
    secret.length >= 32 &&
    actual.length === secret.length &&
    timingSafeEqual(actual, secret)
  );
}

export function stripApiPrefix(
  event: APIGatewayProxyEventV2,
): APIGatewayProxyEventV2 {
  const path =
    event.rawPath === '/api' ? '/' : event.rawPath.replace(/^\/api\//, '/');
  // CloudFront overwrites this header with event.viewer.ip on both API behaviors.
  // Avoid trusting an arbitrary X-Forwarded-For chain or sharing the edge IP quota.
  const viewerIp = event.headers['x-ligahub-client-ip'];
  return {
    ...event,
    rawPath: path,
    requestContext: {
      ...event.requestContext,
      http: {
        ...event.requestContext.http,
        path,
        ...(viewerIp && isIP(viewerIp) ? { sourceIp: viewerIp } : {}),
      },
    },
  };
}

async function createHandler(): Promise<ProxyHandler> {
  await initializeLambdaRuntime();
  // Import only after configuration has been installed; modules read env at startup.
  const { createHttpApplication } = await import('../bootstrap.js');
  const app = await createHttpApplication();
  try {
    await app.init();
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
  return serverlessExpress<
    APIGatewayProxyEventV2,
    APIGatewayProxyStructuredResultV2
  >({ app: app.getHttpAdapter().getInstance() });
}

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyStructuredResultV2> {
  context.callbackWaitsForEmptyEventLoop = false;
  if (!validOrigin(event.headers)) return response(403, 'Forbidden');
  let proxy: ProxyHandler;
  try {
    application ??= createHandler().catch((error: unknown) => {
      application = undefined;
      throw error;
    });
    proxy = await application;
  } catch {
    console.error('API initialization unavailable.');
    return response(503, 'Service unavailable');
  }
  return (
    (await proxy(stripApiPrefix(event), context, () => undefined)) ??
    response(503, 'Service unavailable')
  );
}

function response(
  statusCode: number,
  message: string,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({ message }),
  };
}
