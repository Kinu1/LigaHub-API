-- Campo opcional: eventos existentes continuam abrindo inscrições ao publicar.
ALTER TABLE "academic_events" ADD COLUMN "registrationStartsAt" TIMESTAMP(3);
