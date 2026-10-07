import { PrismaService } from '../../prisma.service.js';
import { PaymentGateway } from './payment.gateway.js';
import { encryptCredential } from './payment-security.js';

export async function connectSandboxAccount(
  prisma: PrismaService,
  gateway: PaymentGateway,
) {
  if (process.env.MERCADO_PAGO_TEST_MODE !== 'true')
    throw new Error(
      'A conta fixa exige MERCADO_PAGO_TEST_MODE=true explicitamente.',
    );
  const token = process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN?.trim();
  const publicKey = process.env.MERCADO_PAGO_TEST_PUBLIC_KEY?.trim();
  if (!token || !publicKey)
    throw new Error(
      'Configure MERCADO_PAGO_TEST_ACCESS_TOKEN e MERCADO_PAGO_TEST_PUBLIC_KEY no .env local.',
    );
  const merchant = await gateway.merchant(token);
  if (
    !merchant.tags?.includes('test_user') ||
    merchant.site_id !== 'MLB' ||
    !merchant.id
  )
    throw new Error(
      'A conta recebedora precisa ser um usuário de teste do Brasil.',
    );
  const encryptedToken = encryptCredential(token);
  const email = process.env.MERCADO_PAGO_TEST_OWNER_EMAIL?.trim().toLowerCase();
  const owners = await prisma.user.findMany({
    where: {
      active: true,
      ...(email
        ? { email, role: { in: ['admin', 'organizer'] } }
        : { role: 'organizer' }),
    },
    take: 2,
  });
  if (owners.length !== 1)
    throw new Error(
      'Defina MERCADO_PAGO_TEST_OWNER_EMAIL com o e-mail de um responsável ativo da LigaHub.',
    );
  const owner = owners[0];
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${owner.id}))`;
    const currentOwner = await tx.user.findUnique({ where: { id: owner.id } });
    if (
      !currentOwner?.active ||
      !['admin', 'organizer'].includes(currentOwner.role)
    )
      throw new Error(
        'O responsável não está ativo ou não pode organizar eventos.',
      );
    const current = await tx.paymentAccount.findFirst({
      where: { ownerId: owner.id, active: true },
      orderBy: { createdAt: 'desc' },
    });
    if (current && !current.isTest)
      throw new Error(
        'A conta fixa de teste não substitui uma conta OAuth existente.',
      );
    if (
      current?.merchantId === String(merchant.id) &&
      current.publicKey === publicKey
    ) {
      await tx.paymentAccount.update({
        where: { id: current.id },
        data: { accessTokenEncrypted: encryptedToken },
      });
      return { connected: true, updated: true };
    }
    await tx.paymentAccount.updateMany({
      where: { ownerId: owner.id, active: true },
      data: { active: false },
    });
    const account = await tx.paymentAccount.create({
      data: {
        ownerId: owner.id,
        merchantId: String(merchant.id),
        publicKey,
        accessTokenEncrypted: encryptedToken,
        isTest: true,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: owner.id,
        entityType: 'payment_account',
        entityId: account.id,
        action: 'payment_account.sandbox_connected',
        metadata: { merchantId: account.merchantId },
      },
    });
    return { connected: true, updated: false };
  });
}
