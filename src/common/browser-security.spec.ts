import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { browserSecurity, signed, verified } from './browser-security.js';
describe('Proteção de cookies no navegador', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'segredo-de-teste-browser-security-123456');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3001');
  });
  afterEach(() => vi.unstubAllEnvs());
  function check(
    headers: Record<string, string>,
    method = 'POST',
    path = '/auth/logout',
  ) {
    const req = { headers, method, path } as Request;
    const status = vi.fn().mockReturnThis();
    const res = {
      setHeader: vi.fn(),
      status,
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn();
    browserSecurity(req, res, next);
    return { req, res, next, status };
  }
  it('rejeita cookie assinado adulterado', () => {
    const token = signed('valor');
    expect(verified(token)).toBe('valor');
    expect(verified(token + 'a')).toBeUndefined();
  });
  it('exige CSRF mesmo que um cliente omita o cabeçalho do navegador', () => {
    const result = check({ cookie: 'lh_access=jwt' });
    expect(result.status).toHaveBeenCalledWith(403);
    expect(result.next).not.toHaveBeenCalled();
  });
  it('recusa origem diferente mesmo com CSRF válido', () => {
    const result = check({
      cookie: `lh_access=jwt; lh_csrf=${signed('csrf')}`,
      'x-csrf-token': 'csrf',
      origin: 'https://outro.example',
    });
    expect(result.next).not.toHaveBeenCalled();
  });
  it('não injeta cookie de uma inscrição em outra e recusa cookie expirado', () => {
    const id = '7610c4b6-ec08-4fce-9335-b2357ca2eaba';
    const raw = (expires: number) =>
      signed(
        Buffer.from(JSON.stringify({ token: 'credencial', expires })).toString(
          'base64url',
        ),
      );
    const other = check(
      { cookie: `lh_registration_${id}=${raw(Date.now() + 1000)}` },
      'GET',
      '/public/registrations/6510c4b6-ec08-4fce-9335-b2357ca2eaba',
    );
    expect(other.req.headers['x-registration-token']).toBeUndefined();
    const expired = check(
      { cookie: `lh_registration_${id}=${raw(Date.now() - 1000)}` },
      'GET',
      `/public/registrations/${id}`,
    );
    expect(expired.req.headers['x-registration-token']).toBeUndefined();
  });
});
