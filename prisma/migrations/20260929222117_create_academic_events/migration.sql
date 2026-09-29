-- CreateTable
CREATE TABLE "academic_events" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "priceInCents" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_events_pkey" PRIMARY KEY ("id")
);
