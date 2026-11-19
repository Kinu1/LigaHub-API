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
export type RegistrationType = {
  id: string;
  name: string;
  priceInCents: number;
  capacity: number | null;
  availableSpots?: number | null;
};
export type Event = {
  pixFeePolicy?: { platformFeeInCents: number };
  id: string;
  publicId: string;
  logoImage?: string | null;
  bannerImage?: string | null;
  title: string;
  description: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  registrationDeadline: string | null;
  registrationStartsAt: string | null;
  priceInCents: number;
  registrationTypes?: RegistrationType[];
  capacity: number;
  ownerId: string;
  reservationMinutes: number;
  form: Field[];
  status: string;
  availableSpots?: number;
  acceptingRegistrations?: boolean;
  publicKey?: string | null;
};
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};
export type PaymentPricing = {
  registrationAmountInCents: number;
  platformFeeInCents: number;
  processingFeeInCents: number;
  totalInCents: number;
};
export type Payment = {
  pricing?: PaymentPricing;
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
  cpf?: string | null;
  registrationTypeId?: string | null;
  paymentStatus?: string;
  financialStatus?: string;
  latestPaymentStatus?: string;
  financialWarnings?: ('multiple_approvals' | 'dispute_history')[];
  id: string;
  name: string;
  email: string;
  status: string;
  reviewReason?: string | null;
  answers: Record<string, unknown>;
  priceInCents: number;
  registrationTypeName?: string | null;
  reservationExpiresAt: string;
  suspended?: boolean;
  suspendedAt?: string | null;
  cancellationRequestedAt: string | null;
  event: Pick<
    Event,
    'title' | 'publicId' | 'status' | 'logoImage' | 'bannerImage'
  >;
  payments: Payment[];
};
export const reviewReasons: Record<string, string> = {
  capacity_full:
    'Todas as vagas estão ocupadas por confirmações ou reservas vigentes.',
  registration_canceled: 'A inscrição está cancelada.',
  participant_cancellation_requested:
    'O participante solicitou o cancelamento.',
  registration_suspended: 'A inscrição está suspensa.',
  owner_inactive: 'O organizador responsável está inativo.',
  event_unpublished: 'O evento não está publicado.',
  event_started: 'O evento já começou.',
  invalid_registration_state: 'O estado da inscrição não permite confirmação.',
  reason_not_recorded:
    'Motivo não registrado; consulte o pagamento antes de resolver',
};
export const reviewReasonText = (reason?: string | null) =>
  reviewReasons[reason ?? ''] ?? reviewReasons.reason_not_recorded;
export type PaymentHistory = Payment & {
  event?: { id: string; title: string };
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
  free: 'Gratuita',
  unpaid: 'Sem pagamento',
  draft: 'Rascunho',
  published: 'Publicado',
  suspended: 'Suspenso',
  closed: 'Encerrado',
  reserved: 'Reservada',
  expired: 'Expirada',
  confirmed: 'Confirmada',
  canceled: 'Cancelada',
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

// Communications types
export type CommunicationAudience =
  'all_active' | 'confirmed_only' | 'categories';
export type CommunicationStatus = 'draft' | 'sending' | 'sent' | 'failed';
export type RecipientStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'accepted'
  | 'delivered'
  | 'delayed'
  | 'failed'
  | 'unconfirmed_after24h'
  | 'skipped';
export type AttachmentStatus = 'uploading' | 'ready' | 'failed' | 'expired';

export type CommunicationCampaign = {
  id: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  audienceType: CommunicationAudience;
  audienceCategoryIds: string[];
  status: CommunicationStatus;
  createdAt: string;
  sentAt: string | null;
  event: {
    title: string;
    location: string;
    startsAt: string | null;
    logoImage: string | null;
  };
  owner: { email: string; name: string };
  attachments: CommunicationAttachment[];
  recipients: CommunicationRecipient[];
};

export type CommunicationCampaignListItem = {
  id: string;
  subject: string;
  status: CommunicationStatus;
  audienceType: CommunicationAudience;
  recipientCount: number;
  attachmentCount: number;
  createdAt: string;
  sentAt: string | null;
};

export type CommunicationCampaignsPage = Page<CommunicationCampaignListItem>;

export type CommunicationAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  status: AttachmentStatus;
  expiresAt: string;
  uploadedAt: string | null;
};

export type CommunicationRecipient = {
  id: string;
  campaignId: string;
  registrationId: string;
  email: string;
  name: string;
  status: RecipientStatus;
  attempts: number;
  providerId: string | null;
  firstAttemptAt: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  errorCode: string | null;
  errorDetail: string | null;
};

export type CommunicationRecipientsPage = Page<CommunicationRecipient>;

export type AudiencePreview = {
  total: number;
  byCategory: { categoryId: string; categoryName: string; count: number }[];
};

export const communicationLabels = {
  draft: 'Rascunho',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Falhou',
  all_active: 'Todos ativos',
  confirmed_only: 'Apenas confirmados',
  categories: 'Por categorias',
  pending: 'Pendente',
  queued: 'Na fila',
  processing: 'Processando',
  accepted: 'Aceito pelo servidor',
  delivered: 'Entregue',
  delayed: 'Atrasado',
  unconfirmed_after24h: 'Nao confirmado em 24h',
  skipped: 'Ignorado',
};

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export const MAX_ATTACHMENTS = 5;
export const MAX_TOTAL_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const MAX_CHUNK_SIZE = 512 * 1024;
export const ATTACHMENT_EXPIRY_HOURS = 24;
