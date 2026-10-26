export type User = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'organizer';
  active?: boolean;
};
export type Field = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox';
  required: boolean;
  options?: string[];
};
export type Event = {
  id: string;
  publicId: string;
  title: string;
  description: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  registrationDeadline: string | null;
  priceInCents: number;
  capacity: number;
  ownerId: string;
  reservationMinutes: number;
  form: Field[];
  status: string;
  availableSpots?: number;
  acceptingRegistrations?: boolean;
};
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};
export type Payment = {
  id: string;
  method: string;
  status: string;
  amountInCents: number;
  installments: number;
  createdAt: string;
  checkout?: {
    qrCode?: string;
    qrCodeBase64?: string;
    ticketUrl?: string;
  } | null;
};
export type Registration = {
  id: string;
  name: string;
  email: string;
  status: string;
  answers: Record<string, unknown>;
  priceInCents: number;
  reservationExpiresAt: string;
  suspended?: boolean;
  suspendedAt?: string | null;
  cancellationRequestedAt: string | null;
  event: Pick<Event, 'title' | 'publicId' | 'status'>;
  payments: Payment[];
};
export type PaymentHistory = Payment & {
  payer: { name: string; cpf: string } | null;
};
export const formatCpf = (value?: string | null) =>
  value && /^\d{11}$/.test(value)
    ? value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    : 'Não informado';
export type Audit = {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  actorId?: string | null;
  actor?: { id: string; name: string; email: string; role: string } | null;
  subject?: { name: string; eventTitle?: string } | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
};
export const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    value / 100,
  );
export const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/Sao_Paulo',
      }).format(new Date(value))
    : 'A confirmar';
export const labels: Record<string, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  suspended: 'Suspenso',
  closed: 'Encerrado',
  reserved: 'Reservada',
  expired: 'Expirada',
  confirmed: 'Confirmada',
  pending: 'Pendente',
  approved: 'Aprovado',
  created: 'Processando',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
  charged_back: 'Contestação',
  in_process: 'Em análise',
  authorized: 'Autorizado',
  in_mediation: 'Em mediação',
  payment_review: 'Revisão necessária',
};
