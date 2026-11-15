-- Adição de registro manual. Mantém o histórico de transferências anteriores.
ALTER TABLE "pix_payouts"
  ADD COLUMN "manualReservedBy" UUID,
  ADD COLUMN "manualReservedAt" TIMESTAMP(3),
  ADD COLUMN "manualReceiptEncrypted" TEXT,
  ADD COLUMN "manualReceiptHash" TEXT,
  ADD COLUMN "manualPaidAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "pix_payouts_manualReceiptHash_key" ON "pix_payouts"("manualReceiptHash");
