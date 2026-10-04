-- AlterTable
ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "niche" TEXT;
CREATE INDEX IF NOT EXISTS "Video_niche_viewCount_idx" ON "Video"("niche", "viewCount");

-- AlterTable
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "agentType" TEXT NOT NULL DEFAULT 'mystery';
