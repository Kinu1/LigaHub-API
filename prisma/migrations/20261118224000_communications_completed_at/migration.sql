-- Retention starts when a campaign finishes, including long-running retries.
ALTER TABLE "communication_campaigns" ADD COLUMN "completedAt" TIMESTAMP(3);
