CREATE TYPE "RegistrationOrigin" AS ENUM ('public', 'manual', 'historical');

-- Existing registrations retain their public origin; no courtesy is inferred.
ALTER TABLE "registrations"
  ADD COLUMN "origin" "RegistrationOrigin" NOT NULL DEFAULT 'public',
  ADD COLUMN "manualAuthorId" UUID,
  ADD COLUMN "manualCreatedAt" TIMESTAMP(3);

CREATE INDEX "registrations_origin_idx" ON "registrations" ("origin");
CREATE INDEX "registrations_manualAuthorId_idx" ON "registrations" ("manualAuthorId");

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_manual_audit_check"
  CHECK ("origin" <> 'manual' OR (
    "manualAuthorId" IS NOT NULL AND "manualCreatedAt" IS NOT NULL AND "priceInCents" = 0
  ));
