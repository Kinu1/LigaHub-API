import { readFileSync } from 'node:fs';
import type {
  CommunicationAttachment,
  CommunicationCampaign,
} from '../../generated/prisma/client.js';
import { decryptCredential } from '../payments/payment-security.js';
import { escapeHtml } from './html-sanitizer.js';
import type { CommunicationsMessage } from './communications.gateway.js';
export function content(c: CommunicationCampaign) {
  return c.contentEncrypted
    ? (JSON.parse(decryptCredential(c.contentEncrypted)) as {
        htmlContent: string;
        textContent: string;
      })
    : { htmlContent: c.htmlContent, textContent: c.textContent };
}
export function render(
  c: CommunicationCampaign,
  event: { title: string; location: string; startsAt: Date | null },
  user: { email: string; name: string },
): Omit<CommunicationsMessage, 'attachments'> {
  const body = content(c);
  const when =
    event.startsAt?.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    }) ?? '';
  return {
    from: process.env.EMAIL_FROM!,
    to: [],
    reply_to: user.email,
    subject: c.subject,
    html: `<header><img src="cid:logo-lauen" alt="LAUEN / FABA"><h1>${escapeHtml(event.title)}</h1><p>${escapeHtml(when)} ${escapeHtml(event.location)}</p></header>${body.htmlContent}<footer>Enviado por ${escapeHtml(user.name)} (${escapeHtml(user.email)}) via LigaHub</footer>`,
    text: `${event.title}\n${when} ${event.location}\n${body.textContent}\nEnviado por ${user.name} (${user.email}) via LigaHub`,
  };
}
export function withFiles(
  message: Omit<CommunicationsMessage, 'attachments'>,
  files: CommunicationAttachment[],
): CommunicationsMessage {
  return {
    ...message,
    attachments: [
      {
        filename: 'logo-lauen.png',
        content: readFileSync(
          new URL('../../assets/logo-lauen.png', import.meta.url),
        ).toString('base64'),
        content_type: 'image/png',
        content_id: 'logo-lauen',
      },
      ...[...files]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((f) => {
          if (f.status !== 'ready' || !f.encryptedPayload)
            throw new Error('Anexo não disponível.');
          return {
            filename: f.filename,
            content: decryptCredential(f.encryptedPayload),
            content_type: f.mimeType,
          };
        }),
    ],
  };
}
