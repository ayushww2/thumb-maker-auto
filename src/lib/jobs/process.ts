import { prisma } from "@/lib/db";
import { generateThumbnailImage } from "@/lib/contactbox";
import { generateWithMysteryAgent } from "@/lib/mysteryThumbAgent";
import { getR2Config } from "@/lib/env";
import { uploadThumbnail } from "@/lib/r2";

let processing = false;
const waiters: Array<() => void> = [];

async function withJobLock<T>(fn: () => Promise<T>): Promise<T> {
  if (processing) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  processing = true;
  try {
    return await fn();
  } finally {
    processing = false;
    const next = waiters.shift();
    if (next) next();
  }
}

async function setProgress(jobId: string, progress: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: { progress },
  });
}

export async function processJob(jobId: string): Promise<void> {
  await withJobLock(async () => {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return;
    if (job.status === "completed" || job.status === "failed") return;

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "running",
        progress: "Mystery Thumb Agent starting…",
        startedAt: job.startedAt ?? new Date(),
        error: null,
      },
    });

    try {
      let prompt = "";
      let analysis: string | null = null;
      let chosenFormat: string | null = null;
      let overlayText: string | null = null;
      let whyTheseComps: string | null = null;
      let playbookSummary: string | null = null;
      let competitorsJson: unknown = null;
      let image: Buffer;

      if (job.useAgent) {
        await setProgress(jobId, "Scanning collection + matching top 5 comps…");
        const result = await generateWithMysteryAgent({
          title: job.title,
          notes: job.notes || undefined,
        });
        await setProgress(jobId, "Rendering gpt-image-2 high 16:9…");
        prompt = result.brief.imagePrompt;
        analysis = result.brief.analysis;
        chosenFormat = result.brief.chosenFormat;
        overlayText = result.brief.overlayText;
        whyTheseComps = result.brief.whyTheseComps;
        playbookSummary = result.brief.playbook.summary;
        competitorsJson = result.brief.competitors;
        image = result.image;
      } else {
        await setProgress(jobId, "Rendering gpt-image-2…");
        // Fallback shouldn't normally happen for queued agent jobs
        image = await generateThumbnailImage(
          `Cinematic 16:9 mystery YouTube thumbnail for: ${job.title}`,
        );
        prompt = `Direct render for: ${job.title}`;
      }

      let imageUrl: string | null = null;
      let imageR2Key: string | null = null;
      const r2 = getR2Config();
      if (r2.configured) {
        await setProgress(jobId, "Uploading thumbnail to R2…");
        const upload = await uploadThumbnail(image, "image/png");
        imageUrl = upload.publicUrl;
        imageR2Key = upload.key;
      }

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "completed",
          progress: "Done",
          prompt,
          analysis,
          chosenFormat,
          overlayText,
          whyTheseComps,
          playbookSummary,
          competitorsJson: competitorsJson as object | undefined,
          imageUrl,
          imageR2Key,
          imageBytes: image.byteLength,
          completedAt: new Date(),
          error: null,
        },
      });
      console.log("[jobs] completed", jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Job failed";
      console.error("[jobs] failed", jobId, message);
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "failed",
          progress: "Failed",
          error: message,
          completedAt: new Date(),
        },
      });
    }
  });
}

export function enqueueJob(jobId: string) {
  // Fire-and-forget in this Node process
  void processJob(jobId).catch((err) => {
    console.error("[jobs] enqueue crash", jobId, err);
  });
}

export async function resumeQueuedJobs() {
  // Recover jobs interrupted by deploy/restart
  const stuck = await prisma.job.findMany({
    where: { status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const job of stuck) {
    if (job.status === "running") {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "queued", progress: "Re-queued after restart…" },
      });
    }
    enqueueJob(job.id);
  }
  if (stuck.length) {
    console.log("[jobs] resumed", stuck.length, "jobs");
  }
}
