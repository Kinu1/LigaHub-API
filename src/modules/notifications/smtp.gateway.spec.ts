import nodemailer from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurableEmailGateway } from './smtp.gateway.js';
import { ResendEmailGateway } from './email.gateway.js';

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }));

const message = {
  from: 'LigaHub <confirmacoes@example.com>',
  to: ['participante@example.com'],
  subject: 'Confirmação',
  text: 'Vaga confirmada.',
};
const sendMail = vi.fn();
const close = vi.fn();

describe('Seleção do provedor de e-mail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: 'smtp-123' });
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail,
      close,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    { provider: 'resend', host: 'smtp.example.com', expected: 'resend' },
    { provider: 'smtp', host: 'smtp.example.com', expected: 'smtp' },
    { provider: undefined, host: 'smtp.example.com', expected: 'smtp' },
    { provider: undefined, host: undefined, expected: 'resend' },
  ])(
    'encaminha o envio para $expected com EMAIL_PROVIDER=$provider e SMTP_HOST=$host',
    async ({ provider, host, expected }) => {
      vi.stubEnv('EMAIL_PROVIDER', provider);
      vi.stubEnv('SMTP_HOST', host);
      const resend = vi
        .spyOn(ResendEmailGateway.prototype, 'send')
        .mockResolvedValue('resend-123');
      const result = await new ConfigurableEmailGateway().send(
        message,
        'confirmation/123',
      );
      expect(result).toBe(`${expected}-123`);
      if (expected === 'resend') {
        expect(resend).toHaveBeenCalledWith(message, 'confirmation/123');
        expect(nodemailer.createTransport).not.toHaveBeenCalled();
      } else {
        expect(resend).not.toHaveBeenCalled();
        expect(nodemailer.createTransport).toHaveBeenCalledWith(
          expect.objectContaining({ host }),
        );
        expect(sendMail).toHaveBeenCalledWith(expect.objectContaining(message));
        expect(close).toHaveBeenCalledOnce();
      }
    },
  );

  it('não usa SMTP como alternativa quando falta a chave do Resend selecionado', async () => {
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('RESEND_API_KEY', undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new ConfigurableEmailGateway().send(message, 'confirmation/123'),
    ).rejects.toThrow('RESEND_API_KEY');
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('não usa Resend como alternativa quando falta o host SMTP selecionado', async () => {
    vi.stubEnv('EMAIL_PROVIDER', 'smtp');
    vi.stubEnv('SMTP_HOST', undefined);
    vi.stubEnv('RESEND_API_KEY', 'chave-simulada');
    const resend = vi.spyOn(ResendEmailGateway.prototype, 'send');
    await expect(
      new ConfigurableEmailGateway().send(message, 'confirmation/123'),
    ).rejects.toThrow('SMTP_HOST');
    expect(resend).not.toHaveBeenCalled();
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});
