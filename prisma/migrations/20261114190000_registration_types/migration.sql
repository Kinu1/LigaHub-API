ALTER TABLE "academic_events" ADD COLUMN "registrationTypes" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "registrations" ADD COLUMN "registrationTypeId" TEXT;
ALTER TABLE "registrations" ADD COLUMN "registrationTypeName" TEXT;
ALTER TABLE "registrations" DROP CONSTRAINT "registrations_positive_price";
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_nonnegative_price" CHECK ("priceInCents" >= 0);
CREATE INDEX "registrations_eventId_registrationTypeId_status_reservationExpiresAt_idx"
  ON "registrations"("eventId", "registrationTypeId", "status", "reservationExpiresAt");
