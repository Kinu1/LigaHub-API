ALTER TABLE registrations ADD COLUMN "manageTokenEncrypted" TEXT;
CREATE TABLE browser_sessions (id UUID PRIMARY KEY, "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, "tokenVersion" INTEGER NOT NULL, "tokenHash" TEXT NOT NULL UNIQUE, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3));
CREATE INDEX browser_sessions_user_idx ON browser_sessions("userId");
CREATE TABLE registration_access_links (id UUID PRIMARY KEY, "registrationId" UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE, "tokenHash" TEXT NOT NULL UNIQUE, "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3));
