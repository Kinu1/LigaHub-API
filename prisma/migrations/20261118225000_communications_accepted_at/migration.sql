-- Delivery confirmation timeout is measured from provider acceptance, separately from retry age.
ALTER TABLE "communication_recipients" ADD COLUMN "acceptedAt" TIMESTAMP(3);
