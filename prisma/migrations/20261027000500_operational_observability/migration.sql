-- Migration aditiva para observabilidade operacional de rotinas e pagamentos
ALTER TABLE "payment_attempts" ADD COLUMN "lastSyncAttemptAt" TIMESTAMP(3);
ALTER TABLE "payment_attempts" ADD COLUMN "lastSyncSucceededAt" TIMESTAMP(3);
ALTER TABLE "payment_attempts" ADD COLUMN "lastSyncErrorCode" TEXT;

CREATE INDEX "payment_attempts_lastSyncErrorCode_idx" ON "payment_attempts"("lastSyncErrorCode");

ALTER TABLE "background_jobs" ADD COLUMN "status" TEXT;
ALTER TABLE "background_jobs" ADD COLUMN "processedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "background_jobs" ADD COLUMN "succeededCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "background_jobs" ADD COLUMN "failedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "background_jobs" ADD COLUMN "skippedCount" INTEGER NOT NULL DEFAULT 0;
