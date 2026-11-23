-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('draft', 'sending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "CommunicationAudience" AS ENUM ('all_active', 'confirmed_only', 'categories');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('pending', 'queued', 'processing', 'accepted', 'delivered', 'delayed', 'failed', 'unconfirmed_after24h', 'skipped');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('uploading', 'ready', 'failed', 'expired');

-- CreateTable
CREATE TABLE "communication_campaigns" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "htmlContent" TEXT NOT NULL,
    "textContent" TEXT NOT NULL,
    "audienceType" "CommunicationAudience" NOT NULL DEFAULT 'all_active',
    "audienceCategoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confirmedOnly" BOOLEAN NOT NULL DEFAULT false,
    "contentEncrypted" TEXT,
    "envelopeEncrypted" TEXT,
    "snapshotCount" INTEGER NOT NULL DEFAULT 0,
    "status" "CommunicationStatus" NOT NULL DEFAULT 'draft',
    "idempotencyKey" UUID NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_attachments" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'uploading',
    "encryptedPayload" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalChunks" INTEGER NOT NULL,

    CONSTRAINT "communication_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_attachment_chunks" (
    "id" UUID NOT NULL,
    "attachmentId" UUID NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "dataBase64" TEXT NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_attachment_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_recipients" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseId" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "providerId" VARCHAR(255),
    "firstAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "errorCode" VARCHAR(100),
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_webhook_events" (
    "id" UUID NOT NULL,
    "svixId" VARCHAR(255) NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "providerId" VARCHAR(255) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "matchedRecipientId" UUID,
    "reconciliationStatus" VARCHAR(50) NOT NULL DEFAULT 'unmatched',

    CONSTRAINT "communication_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "communication_campaigns_eventId_idx" ON "communication_campaigns"("eventId");

-- CreateIndex
CREATE INDEX "communication_campaigns_ownerId_idx" ON "communication_campaigns"("ownerId");

-- CreateIndex
CREATE INDEX "communication_campaigns_idempotencyKey_idx" ON "communication_campaigns"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "communication_campaigns_eventId_idempotencyKey_key" ON "communication_campaigns"("eventId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "communication_attachments_campaignId_idx" ON "communication_attachments"("campaignId");

-- CreateIndex
CREATE INDEX "communication_attachments_status_expiresAt_idx" ON "communication_attachments"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "communication_attachment_chunks_attachmentId_chunkIndex_key" ON "communication_attachment_chunks"("attachmentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "communication_recipients_campaignId_idx" ON "communication_recipients"("campaignId");

-- CreateIndex
CREATE INDEX "communication_recipients_status_nextAttemptAt_idx" ON "communication_recipients"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "communication_recipients_leaseId_idx" ON "communication_recipients"("leaseId");

-- CreateIndex
CREATE INDEX "communication_recipients_providerId_idx" ON "communication_recipients"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "communication_recipients_campaignId_registrationId_key" ON "communication_recipients"("campaignId", "registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "communication_webhook_events_svixId_key" ON "communication_webhook_events"("svixId");

-- CreateIndex
CREATE INDEX "communication_webhook_events_receivedAt_idx" ON "communication_webhook_events"("receivedAt");

-- CreateIndex
CREATE INDEX "communication_webhook_events_matchedRecipientId_idx" ON "communication_webhook_events"("matchedRecipientId");

-- CreateIndex
CREATE INDEX "communication_webhook_events_reconciliationStatus_idx" ON "communication_webhook_events"("reconciliationStatus");

-- CreateIndex
CREATE INDEX "communication_webhook_events_providerId_idx" ON "communication_webhook_events"("providerId");

-- AddForeignKey
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "academic_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachments_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "communication_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_attachment_chunks" ADD CONSTRAINT "communication_attachment_chunks_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "communication_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "communication_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_webhook_events" ADD CONSTRAINT "communication_webhook_events_matchedRecipientId_fkey" FOREIGN KEY ("matchedRecipientId") REFERENCES "communication_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
