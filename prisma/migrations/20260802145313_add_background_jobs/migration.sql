-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" TEXT NOT NULL DEFAULT 'Queued',
    "error" TEXT,
    "useAgent" BOOLEAN NOT NULL DEFAULT true,
    "prompt" TEXT,
    "analysis" TEXT,
    "chosenFormat" TEXT,
    "overlayText" TEXT,
    "whyTheseComps" TEXT,
    "playbookSummary" TEXT,
    "competitorsJson" JSONB,
    "imageR2Key" TEXT,
    "imageUrl" TEXT,
    "imageBytes" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");
