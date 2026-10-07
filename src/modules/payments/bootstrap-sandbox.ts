import 'dotenv/config';
import { PrismaService } from '../../prisma.service.js';
import { MercadoPagoGateway } from './payment.gateway.js';
import { connectSandboxAccount } from './sandbox-account.js';

async function bootstrap() {
  const prisma = new PrismaService();
  try {
    const result = await connectSandboxAccount(
      prisma,
      new MercadoPagoGateway(),
    );
    console.info(
      result.updated
        ? 'Credenciais da conta fixa de teste atualizadas.'
        : 'Conta fixa de teste conectada. Nenhum pagamento foi criado.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(
    error instanceof Error &&
      (error.name === 'Error' || error.name === 'ServiceUnavailableException')
      ? error.message
      : 'Não foi possível conectar a conta fixa de teste. Verifique a configuração e o banco de dados.',
  );
  process.exitCode = 1;
});
