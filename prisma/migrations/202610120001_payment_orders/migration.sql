-- Os registros existentes continuam sendo consultados pela Payments API.
-- Reversao: retornar o codigo anterior preservando estas colunas e os dados.
ALTER TABLE "payment_attempts"
  ADD COLUMN "providerApi" TEXT NOT NULL DEFAULT 'payments',
  ADD COLUMN "providerRequestEncrypted" TEXT;

ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_api_check"
  CHECK ("providerApi" IN ('payments', 'orders'));
