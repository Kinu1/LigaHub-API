-- Campo opcional para preservar inscrições existentes; CPF armazenado com AES-GCM.
ALTER TABLE "registrations" ADD COLUMN "participantCpfEncrypted" TEXT;
