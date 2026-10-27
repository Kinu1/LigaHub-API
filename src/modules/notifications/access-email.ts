import { emailRenderConfig, type EmailMessage } from './confirmation-email.js';

export function renderAccessEmail(payload: {
  registrationId: string;
  to: string;
  name: string;
  eventTitle: string;
  token: string;
}): EmailMessage {
  const { base, from } = emailRenderConfig();
  const url = new URL(`/inscricao/${payload.registrationId}`, base);
  url.hash = new URLSearchParams({ access: payload.token }).toString();
  return {
    from,
    to: [payload.to],
    subject: 'Acesse sua inscrição — LigaHub',
    text: `Olá, ${payload.name}!\n\nAcompanhe sua inscrição em ${payload.eventTitle}:\n${url.toString()}\n\nEste link é pessoal, de uso único e expira em 15 minutos. Ele não confirma pagamento. Caso não tenha solicitado, ignore esta mensagem.\nLigaHub`,
  };
}
