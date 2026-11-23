-- Migração aditiva. Não altera cobranças existentes nem ativa repasses.
ALTER TABLE "payment_attempts" ADD COLUMN "payoutOwnerId" UUID,
  ADD COLUMN "payoutDestinationEncrypted" TEXT;

CREATE TABLE "organizer_pix_destinations" (
  "ownerId" UUID NOT NULL PRIMARY KEY,
  "id" UUID NOT NULL,
  "keyType" TEXT NOT NULL,
  "keyEncrypted" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "approvedBy" UUID,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "organizer_pix_destinations_id_key" ON "organizer_pix_destinations"("id");

CREATE TABLE "pix_payouts" (
  "id" UUID NOT NULL PRIMARY KEY,
  "paymentId" UUID NOT NULL,
  "registrationId" UUID NOT NULL,
  "ownerId" UUID NOT NULL,
  "destinationEncrypted" TEXT NOT NULL,
  "amountInCents" INTEGER NOT NULL CHECK ("amountInCents" > 0),
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reason" TEXT,
  "submittedAt" TIMESTAMP(3),
  "providerPayoutId" TEXT,
  "providerTransactionId" TEXT,
  "leaseId" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pix_payouts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pix_payouts_paymentId_key" ON "pix_payouts"("paymentId");
CREATE UNIQUE INDEX "pix_payouts_registrationId_key" ON "pix_payouts"("registrationId");
CREATE UNIQUE INDEX "pix_payouts_providerPayoutId_key" ON "pix_payouts"("providerPayoutId");
CREATE UNIQUE INDEX "pix_payouts_providerTransactionId_key" ON "pix_payouts"("providerTransactionId");
CREATE INDEX "pix_payouts_status_nextAttemptAt_idx" ON "pix_payouts"("status", "nextAttemptAt");
CREATE INDEX "pix_payouts_ownerId_createdAt_idx" ON "pix_payouts"("ownerId", "createdAt");
