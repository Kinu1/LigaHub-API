-- Controle aditivo de execução; não altera filas ou pagamentos.
CREATE TABLE "background_jobs" (
  "name" TEXT NOT NULL PRIMARY KEY,
  "leaseId" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "lastSucceededAt" TIMESTAMP(3),
  "lastFailedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "runCount" INTEGER NOT NULL DEFAULT 0,
  "failureCount" INTEGER NOT NULL DEFAULT 0
);
