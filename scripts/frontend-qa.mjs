// Temporary local fixtures for browser QA. Never enables real payments or external email.
import 'dotenv/config';
import fs from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { PrismaService } from '../dist/prisma.service.js';
import { Argon2PasswordHasher } from '../dist/modules/users/argon2-password-hasher.js';
import {
  digest,
  encryptCredential,
} from '../dist/modules/payments/payment-security.js';
import { RegistrationAccessService } from '../dist/modules/registrations/access.service.js';
import { ConfigurableEmailGateway } from '../dist/modules/notifications/smtp.gateway.js';
const prisma = new PrismaService();
const file = new URL('../.test-temp/frontend-qa.json', import.meta.url);
try {
  if (process.argv[2] === 'clean') {
    const fixture = JSON.parse(await fs.readFile(file, 'utf8'));
    const user = await prisma.user.findUnique({
      where: { id: fixture.userId },
    });
    if (
      !user ||
      user.email !== fixture.email ||
      !user.email.endsWith('@frontend-qa.ligahub.test')
    )
      throw new Error('QA fixture identity mismatch; cleanup cancelled.');
    await prisma.registration.deleteMany({
      where: { eventId: fixture.eventId },
    });
    await prisma.academicEvent.deleteMany({
      where: { id: fixture.eventId, ownerId: fixture.userId },
    });
    await prisma.paymentAccount.deleteMany({
      where: { ownerId: fixture.userId, merchantId: fixture.merchantId },
    });
    await prisma.browserSession.deleteMany({
      where: { userId: fixture.userId },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: fixture.userId },
          { entityId: { in: [fixture.eventId, fixture.registrationId] } },
        ],
      },
    });
    await prisma.user.delete({ where: { id: fixture.userId } });
    await fs.unlink(file);
    console.log("Only this run's QA fixtures were removed.");
  } else {
    const userId = randomUUID(),
      eventId = randomUUID(),
      registrationId = randomUUID(),
      email = `${userId}@frontend-qa.ligahub.test`,
      password = randomBytes(18).toString('base64url'),
      merchantId = `frontend-qa-${userId}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: 'Equipe de teste LigaHub',
        email,
        role: 'admin',
        passwordHash: await new Argon2PasswordHasher().hash(password),
      },
    });
    await prisma.paymentAccount.create({
      data: {
        ownerId: userId,
        merchantId,
        publicKey: 'TEST-QA-INVALID',
        accessTokenEncrypted: encryptCredential('not-a-provider-credential'),
        isTest: true,
      },
    });
    const event = await prisma.academicEvent.create({
      data: {
        id: eventId,
        ownerId: userId,
        title: 'Jornada de conhecimento · teste local',
        description:
          'Um encontro para compartilhar experiências, descobrir novas ideias e aproximar estudantes. Dados temporários para verificar a interface.',
        location: 'Auditório da liga',
        startsAt: new Date(Date.now() + 7 * 86400_000),
        endsAt: new Date(Date.now() + 7 * 86400_000 + 7200_000),
        priceInCents: 2500,
        capacity: 50,
        status: 'published',
        form: [
          {
            id: 'instituicao',
            label: 'Instituição de ensino',
            type: 'text',
            required: true,
          },
        ],
      },
    });
    const management = randomBytes(32).toString('base64url');
    await prisma.registration.create({
      data: {
        id: registrationId,
        eventId,
        name: 'Participante de teste',
        email: `${registrationId}@frontend-qa.ligahub.test`,
        answers: { instituicao: 'Universidade de teste' },
        formSnapshot: event.form,
        priceInCents: 2500,
        reservationExpiresAt: new Date(Date.now() + 900_000),
        manageTokenHash: digest(management),
        manageTokenEncrypted: encryptCredential(management),
      },
    });
    await fs.mkdir(new URL('../.test-temp/', import.meta.url), {
      recursive: true,
    });
    await fs.writeFile(
      file,
      JSON.stringify({
        userId,
        email,
        password,
        eventId,
        registrationId,
        publicId: event.publicId,
        merchantId,
      }),
    );
    Object.assign(process.env, {
      EMAIL_PROVIDER: 'smtp',
      EMAIL_DELIVERY_ENABLED: 'true',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      EMAIL_FROM: 'LigaHub <qa@ligahub.test>',
      FRONTEND_URL: 'http://localhost:3001',
    });
    await new RegistrationAccessService(
      prisma,
      new ConfigurableEmailGateway(),
    ).sendLink(registrationId);
    console.log(
      JSON.stringify({
        fixtureFile: file.pathname,
        publicId: event.publicId,
        registrationId,
        message:
          'QA fixtures created; an access link was sent only to local Mailpit.',
      }),
    );
  }
} finally {
  await prisma.$disconnect();
}
