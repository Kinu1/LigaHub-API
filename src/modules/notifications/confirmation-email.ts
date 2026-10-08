import { randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { digest, encryptCredential } from '../payments/payment-security.js';

export async function enqueueConfirmation(
  tx: Prisma.TransactionClient,
  registration: {
    id: string;
    name: string;
    email: string;
    event: { title: string; startsAt: Date | null; location: string };
  },
) {
  // O pagamento já mantém o bloqueio do evento durante esta transação.
  if (
    await tx.emailOutbox.findUnique({
      where: { registrationId: registration.id },
    })
  )
    return;
  const token = randomBytes(32).toString('base64url');
  await tx.registration.update({
    where: { id: registration.id },
    data: {
      statusTokenHash: digest(token),
      statusTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });
  await tx.emailOutbox.create({
    data: {
      registrationId: registration.id,
      payloadEncrypted: encryptCredential(
        JSON.stringify({
          registrationId: registration.id,
          to: registration.email,
          name: registration.name,
          eventTitle: registration.event.title,
          startsAt: registration.event.startsAt?.toISOString(),
          location: registration.event.location,
          token,
        }),
      ),
    },
  });
}

export type EmailMessage = {
  from: string;
  to: string[];
  subject: string;
  text: string;
};
export function renderConfirmation(payload: {
  registrationId: string;
  to: string;
  name: string;
  eventTitle: string;
  startsAt?: string;
  location: string;
  token: string;
}): EmailMessage {
  const base = new URL(process.env.FRONTEND_URL ?? '');
  if (
    (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && base.hostname === 'localhost')) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Configure FRONTEND_URL com a origem do frontend.');
  const from = process.env.EMAIL_FROM;
  if (!from || /[\r\n]/.test(from))
    throw new Error('Configure EMAIL_FROM com o remetente verificado.');
  const link = new URL(`/inscricoes/${payload.registrationId}`, base);
  link.hash = new URLSearchParams({ token: payload.token }).toString();
  const date = payload.startsAt
    ? new Date(payload.startsAt).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      })
    : 'A confirmar';
  return {
    from,
    to: [payload.to],
    subject: 'Sua vaga no evento está confirmada — LigaHub',
    text: `Olá, ${payload.name}!\n\nSeu pagamento foi aprovado e sua vaga no evento ${payload.eventTitle} está confirmada.\nData: ${date}\nLocal: ${payload.location || 'A confirmar'}\n\nConsulte a situação atual da sua inscrição: ${link.toString()}\n\nEste link é pessoal. Não o compartilhe. Ele permite consultar sua inscrição por 90 dias após a confirmação.\nLigaHub`,
  };
}
