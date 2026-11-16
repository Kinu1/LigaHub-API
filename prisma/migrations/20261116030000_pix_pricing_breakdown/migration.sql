-- Campos nulos preservam os valores e as regras das cobranças anteriores.
ALTER TABLE "payment_attempts"
  ADD COLUMN "registrationAmountInCents" INTEGER,
  ADD COLUMN "platformFeeInCents" INTEGER,
  ADD COLUMN "processingFeeInCents" INTEGER,
  ADD COLUMN "pricingSnapshot" JSONB;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_pricing_sum_check" CHECK (
  ("registrationAmountInCents" IS NULL AND "platformFeeInCents" IS NULL AND "processingFeeInCents" IS NULL)
  OR ("registrationAmountInCents" IS NOT NULL AND "platformFeeInCents" IS NOT NULL AND "processingFeeInCents" IS NOT NULL
    AND "registrationAmountInCents" > 0 AND "platformFeeInCents" = 100 AND "processingFeeInCents" >= 0
    AND "amountInCents"::BIGINT = "registrationAmountInCents"::BIGINT + "platformFeeInCents" + "processingFeeInCents")
);
