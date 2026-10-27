-- Alteração aditiva: registros antigos ficam nulos e não são cancelados por suposição.
ALTER TABLE "payment_attempts" ADD COLUMN "submissionStarted" BOOLEAN;
