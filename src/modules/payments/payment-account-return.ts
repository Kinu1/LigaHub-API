import { ServiceUnavailableException } from '@nestjs/common';

export function paymentAccountReturnUrl() {
  try {
    const url = new URL(process.env.FRONTEND_URL ?? '');
    const localDevelopment =
      process.env.NODE_ENV !== 'production' &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !localDevelopment) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error();
    return new URL('/painel/financeiro', url.origin);
  } catch {
    throw new ServiceUnavailableException(
      'Configure o endereço do site para concluir a conexão de pagamento.',
    );
  }
}
