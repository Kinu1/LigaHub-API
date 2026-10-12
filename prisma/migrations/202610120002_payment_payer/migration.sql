-- Additive migration; rollback application code while retaining the column/data.
ALTER TABLE "payment_attempts" ADD COLUMN "payerEncrypted" TEXT;
