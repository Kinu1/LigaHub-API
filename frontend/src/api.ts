export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}
let csrf = '';
let csrfRequest: Promise<void> | undefined;
let refresh: Promise<void> | undefined;
async function security() {
  if (!csrf) {
    csrfRequest ??= (async () => {
      const response = await fetch('/api/browser/csrf', {
        credentials: 'include',
      });
      if (!response.ok)
        throw new ApiError(
          response.status,
          'Não foi possível iniciar uma conexão segura.',
        );
      csrf = (await response.json()).token;
    })().finally(() => {
      csrfRequest = undefined;
    });
    await csrfRequest;
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  await security();
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-browser-client': '1',
      'x-csrf-token': csrf,
      ...options.headers,
    },
  });
  if (
    response.status === 401 &&
    retry &&
    !path.startsWith('/public/') &&
    !['/auth/login', '/auth/refresh'].includes(path)
  ) {
    const renew = async () => {
      const current = await fetch('/api/auth/me', { credentials: 'include' });
      if (!current.ok)
        await api<void>('/auth/refresh', { method: 'POST' }, false);
    };
    refresh ??= (
      navigator.locks
        ? navigator.locks.request('ligahub-refresh', renew)
        : renew()
    )
      .then(() => {})
      .finally(() => {
        refresh = undefined;
      });
    try {
      await refresh;
      return api<T>(path, options, false);
    } catch {
      window.dispatchEvent(new Event('session-expired'));
      throw new ApiError(
        401,
        'Sua sessão expirou. Entre novamente para continuar.',
      );
    }
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const fields = Array.isArray(error.errors)
      ? Object.fromEntries(
          error.errors.map((e: { field: string; message: string }) => [
            e.field,
            e.message,
          ]),
        )
      : error.errors;
    throw new ApiError(
      response.status,
      Array.isArray(error.message)
        ? error.message.join(' ')
        : error.message || 'Não foi possível concluir. Tente novamente.',
      fields,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const send = <T>(
  path: string,
  body?: unknown,
  method = 'POST',
  headers?: HeadersInit,
) =>
  api<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  });
