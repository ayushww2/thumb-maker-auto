-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "channelId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "videoCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "youtubeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL,
    "thumbnailUrl" TEXT NOT NULL,
    "thumbnailUrlHq" TEXT,
    "videoUrl" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "uploadDate" TEXT,
    "channelId" TEXT NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_handle_key" ON "Channel"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Video_youtubeId_key" ON "Video"("youtubeId");

-- CreateIndex
CREATE INDEX "Video_viewCount_idx" ON "Video"("viewCount");

-- CreateIndex
CREATE INDEX "Video_title_idx" ON "Video"("title");

-- CreateIndex
CREATE INDEX "Video_channelId_viewCount_idx" ON "Video"("channelId", "viewCount");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
