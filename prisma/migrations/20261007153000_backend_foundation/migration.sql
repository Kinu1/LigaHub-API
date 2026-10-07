-- AlterTable
ALTER TABLE "academic_events" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "form" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "location" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ownerId" UUID,
ADD COLUMN     "publicId" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "registrationDeadline" TIMESTAMP(3),
ADD COLUMN     "reservationMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "startsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "formSnapshot" JSONB NOT NULL,
    "priceInCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "reservationExpiresAt" TIMESTAMP(3) NOT NULL,
    "manageTokenHash" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "cancellationRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "merchantId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" UUID NOT NULL,
    "stateHash" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "verifierEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "method" TEXT NOT NULL,
    "installments" INTEGER NOT NULL,
    "amountInCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "statusDetail" TEXT,
    "checkout" JSONB,
    "providerUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registrations_eventId_status_reservationExpiresAt_idx" ON "registrations"("eventId", "status", "reservationExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_eventId_email_key" ON "registrations"("eventId", "email");

-- CreateIndex
CREATE INDEX "payment_accounts_ownerId_active_idx" ON "payment_accounts"("ownerId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_stateHash_key" ON "oauth_states"("stateHash");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_idempotencyKey_key" ON "payment_attempts"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_providerPaymentId_key" ON "payment_attempts"("providerPaymentId");

-- CreateIndex
CREATE INDEX "payment_attempts_status_updatedAt_idx" ON "payment_attempts"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "academic_events_publicId_key" ON "academic_events"("publicId");

-- AddForeignKey
ALTER TABLE "academic_events" ADD CONSTRAINT "academic_events_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "academic_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "payment_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
