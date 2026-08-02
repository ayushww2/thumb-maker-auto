-- CreateTable
CREATE TABLE "ThumbScan" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "subject" TEXT,
    "composition" TEXT,
    "colors" TEXT,
    "overlayText" TEXT,
    "emotionalHook" TEXT,
    "formatLabel" TEXT,
    "whyItWorks" TEXT,
    "rawNotes" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThumbScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPlaybook" (
    "id" TEXT NOT NULL DEFAULT 'mystery-thumb-agent',
    "agent" TEXT NOT NULL DEFAULT 'mystery-thumb-agent',
    "summary" TEXT NOT NULL,
    "viralPatterns" JSONB NOT NULL,
    "lowViewPatterns" JSONB NOT NULL,
    "thumbnailFormats" JSONB NOT NULL,
    "titleFormulas" JSONB NOT NULL,
    "doList" JSONB NOT NULL,
    "dontList" JSONB NOT NULL,
    "viralThreshold" INTEGER NOT NULL,
    "lowThreshold" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "viralCount" INTEGER NOT NULL,
    "lowCount" INTEGER NOT NULL,
    "scanCount" INTEGER NOT NULL DEFAULT 0,
    "r2Key" TEXT,
    "r2Url" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ThumbScan_videoId_key" ON "ThumbScan"("videoId");

-- CreateIndex
CREATE INDEX "ThumbScan_tier_idx" ON "ThumbScan"("tier");

-- AddForeignKey
ALTER TABLE "ThumbScan" ADD CONSTRAINT "ThumbScan_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
