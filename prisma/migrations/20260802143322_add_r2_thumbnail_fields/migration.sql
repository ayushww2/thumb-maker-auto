-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "r2Key" TEXT,
ADD COLUMN     "r2ThumbnailUrl" TEXT;

-- CreateIndex
CREATE INDEX "Video_r2ThumbnailUrl_idx" ON "Video"("r2ThumbnailUrl");
