import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma.service.js';
import { AccessEmailProcessor } from './access-email.processor.js';
import { renderAccessEmail } from './access-email.js';

describe('Preparação e bloqueio da fila de acesso sem banco', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('disabled retorna antes de acessar banco ou provedor', async () => {
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'false');
    const transaction = vi.fn();
    const send = vi.fn();
    await new AccessEmailProcessor(
      { $transaction: transaction } as unknown as PrismaService,
      { send },
    ).processBatch();
    expect(transaction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('render usa remetente/URL compartilhados e mantém token apenas no fragmento', () => {
    vi.stubEnv('EMAIL_FROM', 'LigaHub <teste@example.com>');
    vi.stubEnv('FRONTEND_URL', 'https://example.com');
    const message = renderAccessEmail({
      registrationId: 'registro',
      to: 'teste@example.com',
      name: 'Ana',
      eventTitle: 'Evento',
      token: 'token-teste',
    });
    expect(message.from).toBe(process.env.EMAIL_FROM);
    expect(message.text).toContain(
      'https://example.com/inscricao/registro#access=token-teste',
    );
    expect(message.text).toContain('uso único');
    expect(message.text).toContain('15 minutos');
    vi.stubEnv('FRONTEND_URL', 'https://example.com?token=x');
    expect(() =>
      renderAccessEmail({
        registrationId: 'registro',
        to: 'teste@example.com',
        name: '',
        eventTitle: '',
        token: '',
      }),
    ).toThrow();
  });
  it('valida configuração do provedor selecionado antes de abrir transação', async () => {
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('EMAIL_FROM', 'teste@example.com');
    vi.stubEnv('FRONTEND_URL', 'https://example.com');
    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      Buffer.alloc(32, 1).toString('base64'),
    );
    const transaction = vi.fn().mockResolvedValue(null),
      send = vi.fn();
    const worker = new AccessEmailProcessor(
      { $transaction: transaction } as unknown as PrismaService,
      { send },
    );
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('SMTP_HOST', 'simulado');
    vi.stubEnv('RESEND_API_KEY', '');
    await expect(worker.processBatch()).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
    vi.stubEnv('EMAIL_PROVIDER', 'smtp');
    vi.stubEnv('SMTP_HOST', '');
    vi.stubEnv('RESEND_API_KEY', 'simulado');
    await expect(worker.processBatch()).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
    vi.stubEnv('SMTP_HOST', 'simulado');
    await worker.processBatch();
    expect(transaction).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });
});
