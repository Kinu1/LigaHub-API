CREATE TABLE "access_email_outbox" (
 "id" UUID NOT NULL, "linkId" UUID NOT NULL, "payloadEncrypted" TEXT,
 "status" TEXT NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "firstAttemptAt" TIMESTAMP(3),
 "leaseId" UUID, "leaseExpiresAt" TIMESTAMP(3), "providerId" TEXT, "sentAt" TIMESTAMP(3),
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "access_email_outbox_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "access_email_outbox_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "registration_access_links"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "access_email_outbox_linkId_key" ON "access_email_outbox"("linkId");
CREATE INDEX "access_email_outbox_status_nextAttemptAt_idx" ON "access_email_outbox"("status", "nextAttemptAt");
CREATE INDEX "access_email_outbox_status_leaseExpiresAt_idx" ON "access_email_outbox"("status", "leaseExpiresAt");
CREATE INDEX "access_email_outbox_expiresAt_idx" ON "access_email_outbox"("expiresAt");
