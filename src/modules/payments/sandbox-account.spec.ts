import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../../prisma.service.js';
import type { PaymentGateway } from './payment.gateway.js';
import { connectSandboxAccount } from './sandbox-account.js';
import { decryptCredential } from './payment-security.js';
import { PaymentAccountsService } from './payment-accounts.service.js';

describe('Conta fixa de teste', () => {
  afterEach(() => vi.unstubAllEnvs());
  function setup() {
    vi.stubEnv('MERCADO_PAGO_TEST_MODE', 'true');
    vi.stubEnv('MERCADO_PAGO_TEST_ACCESS_TOKEN', 'token-teste');
    vi.stubEnv('MERCADO_PAGO_TEST_PUBLIC_KEY', 'publica-teste');
    vi.stubEnv('MERCADO_PAGO_TEST_OWNER_EMAIL', 'liga@example.com');
    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      randomBytes(32).toString('base64'),
    );
    const owner = { id: 'responsavel', role: 'organizer', active: true };
    const tx = {
      $executeRaw: vi.fn(),
      user: { findUnique: vi.fn().mockResolvedValue(owner) },
      paymentAccount: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUniqueOrThrow: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
        create: vi
          .fn()
          .mockImplementation(({ data }) => ({ id: 'conta', ...data })),
      },
      auditLog: { create: vi.fn() },
    };
    const db = {
      user: { findMany: vi.fn().mockResolvedValue([owner]) },
      $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    };
    const provider = {
      merchant: vi
        .fn()
        .mockResolvedValue({ id: 123, tags: ['test_user'], site_id: 'MLB' }),
    };
    return {
      tx,
      db,
      provider,
      prisma: db as unknown as PrismaService,
      gateway: provider as unknown as PaymentGateway,
    };
  }
  it.each(['false', undefined, 'invalido'])(
    'deve bloquear a conexão fora do modo de teste explícito: %s',
    async (mode) => {
      const { prisma, gateway, provider, db } = setup();
      vi.stubEnv('MERCADO_PAGO_TEST_MODE', mode);
      await expect(connectSandboxAccount(prisma, gateway)).rejects.toThrow(
        'explicitamente',
      );
      expect(provider.merchant).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it('deve rejeitar uma conta real antes de gravar no banco', async () => {
    const { prisma, gateway, provider, db } = setup();
    provider.merchant.mockResolvedValue({
      id: 123,
      tags: ['normal'],
      site_id: 'MLB',
    });
    await expect(connectSandboxAccount(prisma, gateway)).rejects.toThrow(
      'usuário de teste',
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('deve gravar o token criptografado e marcar a conta como teste', async () => {
    const { prisma, gateway, tx } = setup();
    await expect(connectSandboxAccount(prisma, gateway)).resolves.toEqual({
      connected: true,
      updated: false,
    });
    const data = tx.paymentAccount.create.mock.calls[0][0].data;
    expect(data.isTest).toBe(true);
    expect(data.accessTokenEncrypted).not.toContain('token-teste');
    expect(decryptCredential(data.accessTokenEncrypted)).toBe('token-teste');
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });
  it('deve preservar uma conta OAuth já conectada', async () => {
    const { prisma, gateway, tx } = setup();
    tx.paymentAccount.findFirst.mockResolvedValue({ isTest: false } as never);
    await expect(connectSandboxAccount(prisma, gateway)).rejects.toThrow(
      'não substitui',
    );
    expect(tx.paymentAccount.updateMany).not.toHaveBeenCalled();
  });
  it('deve atualizar a mesma conta sem criar outro vínculo', async () => {
    const { prisma, gateway, tx } = setup();
    tx.paymentAccount.findFirst.mockResolvedValue({
      id: 'conta',
      isTest: true,
      merchantId: '123',
      publicKey: 'publica-teste',
    } as never);
    await expect(connectSandboxAccount(prisma, gateway)).resolves.toEqual({
      connected: true,
      updated: true,
    });
    expect(tx.paymentAccount.create).not.toHaveBeenCalled();
    expect(tx.paymentAccount.update).toHaveBeenCalledOnce();
  });
  it('deve impedir a leitura do token de teste depois de mudar para produção', async () => {
    const { prisma, gateway, tx } = setup();
    vi.stubEnv('MERCADO_PAGO_TEST_MODE', 'false');
    tx.paymentAccount.findUniqueOrThrow.mockResolvedValue({ isTest: true });
    await expect(
      new PaymentAccountsService(prisma, gateway).accessToken('conta'),
    ).rejects.toThrow('ambiente de produção');
  });
});
