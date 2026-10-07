ALTER TABLE "registrations" ADD COLUMN "statusTokenHash" TEXT, ADD COLUMN "statusTokenExpiresAt" TIMESTAMP(3);
CREATE TABLE "email_outbox" (
  "id" UUID NOT NULL,
  "registrationId" UUID NOT NULL,
  "payloadEncrypted" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstAttemptAt" TIMESTAMP(3),
  "leaseId" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "providerId" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_outbox_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "email_outbox_registrationId_key" ON "email_outbox"("registrationId");
CREATE INDEX "email_outbox_status_nextAttemptAt_idx" ON "email_outbox"("status", "nextAttemptAt");
