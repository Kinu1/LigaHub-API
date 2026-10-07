import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendEmailGateway } from './email.gateway.js';
describe('ResendEmailGateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const message = {
    from: 'LigaHub <confirmacoes@example.com>',
    to: ['participante@example.com'],
    subject: 'Confirmação',
    text: 'Vaga confirmada.',
  };
  it('deve usar a chave de idempotência e retornar o identificador aceito', async () => {
    vi.stubEnv('RESEND_API_KEY', 'segredo-teste');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'email-123' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await new ResendEmailGateway().send(message, 'confirmation/123'),
    ).toBe('email-123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'confirmation/123',
        }),
        body: JSON.stringify(message),
      }),
    );
  });
  it('deve ocultar dados da resposta de erro do provedor', async () => {
    vi.stubEnv('RESEND_API_KEY', 'segredo-teste');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('dados-sensiveis', { status: 429 })),
    );
    await expect(
      new ResendEmailGateway().send(message, 'confirmation/123'),
    ).rejects.toThrow('O provedor não aceitou');
  });
  it('não deve tentar enviar sem chave configurada', async () => {
    vi.stubEnv('RESEND_API_KEY', undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new ResendEmailGateway().send(message, 'confirmation/123'),
    ).rejects.toThrow('RESEND_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
