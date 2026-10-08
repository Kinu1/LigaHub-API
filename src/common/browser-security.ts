import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { jwtSecret } from '../modules/auth/auth.service.js';

export function cookies(request: {
  headers: { cookie?: string };
}): Record<string, string> {
  return Object.fromEntries(
    (request.headers.cookie ?? '').split(';').flatMap((item) => {
      const i = item.indexOf('=');
      if (i < 0) return [];
      try {
        return [
          [item.slice(0, i).trim(), decodeURIComponent(item.slice(i + 1))],
        ];
      } catch {
        return [];
      }
    }),
  );
}
export function signed(value: string) {
  return `${value}.${createHmac('sha256', jwtSecret()).update(value).digest('base64url')}`;
}
export function verified(value?: string) {
  if (!value || value.length > 8192) return undefined;
  const i = value.lastIndexOf('.');
  if (i < 0) return undefined;
  const raw = value.slice(0, i);
  const expected = Buffer.from(signed(raw));
  const received = Buffer.from(value);
  return expected.length === received.length &&
    timingSafeEqual(expected, received)
    ? raw
    : undefined;
}
export function cookieOptions(path = '/') {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path,
  };
}
export function participantCookie(
  response: Response,
  id: string,
  token: string,
) {
  const expires = Date.now() + 8 * 3600_000;
  response.cookie(
    `lh_registration_${id}`,
    signed(
      Buffer.from(JSON.stringify({ token, expires })).toString('base64url'),
    ),
    { ...cookieOptions(), maxAge: 8 * 3600_000 },
  );
}
export function browserSecurity(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const stored = cookies(request);
  const browser =
    request.headers['x-browser-client'] === '1' ||
    stored.lh_access ||
    stored.lh_refresh ||
    Object.keys(stored).some((key) => key.startsWith('lh_registration_'));
  if (browser) response.setHeader('Cache-Control', 'no-store');
  // Any browser mutation must prove access to the CSRF token, including login.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && browser) {
    const csrf = verified(stored.lh_csrf);
    if (!csrf || request.headers['x-csrf-token'] !== csrf) {
      response
        .status(403)
        .json({
          statusCode: 403,
          message: 'Conexão de segurança inválida. Recarregue a página.',
        });
      return;
    }
    const origin = request.headers.origin;
    const configured = [
      process.env.FRONTEND_URL,
      ...(process.env.CORS_ORIGINS ?? '').split(','),
    ].filter(Boolean);
    if (origin && !configured.includes(origin)) {
      response
        .status(403)
        .json({ statusCode: 403, message: 'Origem não permitida.' });
      return;
    }
  }
  const match = /^\/public\/registrations\/([0-9a-f-]{36})(?:\/|$)/i.exec(
    request.path,
  );
  if (match && !request.headers['x-registration-token']) {
    const raw = verified(stored[`lh_registration_${match[1]}`]);
    try {
      if (raw) {
        const data = JSON.parse(Buffer.from(raw, 'base64url').toString()) as {
          token: string;
          expires: number;
        };
        if (data.expires > Date.now())
          request.headers['x-registration-token'] = data.token;
      }
    } catch {
      /* Invalid cookie stays unauthenticated. */
    }
  }
  next();
}
export function issueCsrf(request: Request, response: Response) {
  const token =
    verified(cookies(request).lh_csrf) ?? randomBytes(32).toString('base64url');
  response.cookie('lh_csrf', signed(token), cookieOptions());
  return { token };
}
