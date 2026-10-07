CREATE UNIQUE INDEX "users_one_organizer" ON "users" ("role") WHERE "role" = 'organizer';
CREATE UNIQUE INDEX "payment_accounts_one_active" ON "payment_accounts" ("ownerId") WHERE "active" = true;
CREATE UNIQUE INDEX "payment_attempts_one_pending" ON "payment_attempts" ("registrationId") WHERE "status" IN ('created', 'pending', 'in_process', 'authorized', 'in_mediation');
ALTER TABLE "academic_events" ADD CONSTRAINT "academic_events_positive_values" CHECK ("capacity" > 0 AND "priceInCents" > 0);
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_positive_price" CHECK ("priceInCents" > 0);
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payments_positive_amount" CHECK ("amountInCents" > 0 AND "installments" BETWEEN 1 AND 12);
