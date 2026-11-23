export enum CommunicationStatus {
  draft = 'draft',
  sending = 'sending',
  sent = 'sent',
  failed = 'failed',
}

export enum CommunicationAudience {
  all_active = 'all_active',
  confirmed_only = 'confirmed_only',
  categories = 'categories',
}

export enum RecipientStatus {
  pending = 'pending',
  queued = 'queued',
  processing = 'processing',
  accepted = 'accepted',
  delivered = 'delivered',
  delayed = 'delayed',
  failed = 'failed',
  unconfirmed_after24h = 'unconfirmed_after24h',
  skipped = 'skipped',
}

export enum AttachmentStatus {
  uploading = 'uploading',
  ready = 'ready',
  failed = 'failed',
  expired = 'expired',
}

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
export const MAX_TOTAL_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MiB
export const MAX_CHUNK_SIZE = 512 * 1024; // 512 KiB
export const ATTACHMENT_EXPIRY_HOURS = 24;
export const FINALIZED_RETENTION_DAYS = 30;
export const IDEMPOTENCY_WINDOW_HOURS = 24;
export const RESEND_IDEMPOTENCY_WINDOW_HOURS = 24;
export const MAX_RETRIES = 5;
export const LEASE_DURATION_MS = 90_000;
