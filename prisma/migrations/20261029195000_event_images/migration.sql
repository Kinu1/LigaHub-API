-- Imagens opcionais e compactadas; eventos existentes não precisam de alteração.
ALTER TABLE "academic_events" ADD COLUMN "logoImage" TEXT,
ADD COLUMN "bannerImage" TEXT;
