import { prisma } from "@/lib/db";
import { generateThumbnailImage } from "@/lib/contactbox";
import { generateWithClayAgent } from "@/lib/clayThumbAgent";
import { generateWithMysteryAgent } from "@/lib/mysteryThumbAgent";
import { generateWithSpaceAgent } from "@/lib/spaceThumbAgent";
import { getR2Config } from "@/lib/env";
import { uploadThumbnail } from "@/lib/r2";

let processing = false;
const waiters: Array<() => void> = [];
let watchdogStarted = false;

/** Hard ceiling so one hung ContactBox call cannot block the whole queue forever. */
const JOB_TIMEOUT_MS = 8 * 60 * 1000;
/** Re-queue jobs stuck in running with no recent progress. */
const STUCK_RUNNING_MS = 6 * 60 * 1000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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
        progress:
          job.agentType === "space"
            ? "Space Thumb Agent starting…"
            : job.agentType === "clay"
              ? "Clay Thumb Agent starting…"
              : "Mystery Thumb Agent starting…",
        startedAt: job.startedAt ?? new Date(),
        error: null,
      },
    });

    const heartbeat = setInterval(() => {
      void prisma.job
        .update({
          where: { id: jobId },
          data: {
            progress:
              job.agentType === "space"
                ? "Space Agent · still working (streaming high-quality render)…"
                : job.agentType === "clay"
                  ? "Clay Agent · still working (streaming high-quality render)…"
                  : "Mystery Agent · still working (streaming high-quality render)…",
          },
        })
        .catch(() => undefined);
    }, 45_000);

    try {
      await withTimeout(
        (async () => {
          let prompt = "";
          let analysis: string | null = null;
          let chosenFormat: string | null = null;
          let overlayText: string | null = null;
          let whyTheseComps: string | null = null;
          let playbookSummary: string | null = null;
          let competitorsJson: unknown = null;
          let formatRefYoutubeId: string | null = null;
          let formatRefTitle: string | null = null;
          let formatRefUrl: string | null = null;
          let image: Buffer;

          if (job.useAgent && job.agentType === "space") {
            await setProgress(
              jobId,
              "Space Agent · scanning ≥100K space titles/thumbs only…",
            );
            const result = await generateWithSpaceAgent({
              title: job.title,
              notes: job.notes || undefined,
            });
            await setProgress(
              jobId,
              `Space render 16:9 · format — ${result.brief.formatReference.title.slice(0, 42)}…`,
            );
            prompt = result.brief.generatePrompt || result.brief.imagePrompt;
            analysis = result.brief.analysis;
            chosenFormat = result.brief.chosenFormat;
            overlayText = result.brief.overlayText;
            whyTheseComps = result.brief.whyTheseComps;
            playbookSummary = result.brief.playbook.summary;
            competitorsJson = result.brief.competitors;
            formatRefYoutubeId = result.brief.formatReference.youtubeId;
            formatRefTitle = result.brief.formatReference.title;
            formatRefUrl = result.brief.formatReference.thumbnailUrl;
            image = result.image;
          } else if (job.useAgent && job.agentType === "clay") {
            await setProgress(
              jobId,
              "Clay Agent · scanning ≥100K clay titles/thumbs only…",
            );
            const result = await generateWithClayAgent({
              title: job.title,
              notes: job.notes || undefined,
            });
            await setProgress(
              jobId,
              `Clay render 16:9 · format — ${result.brief.formatReference.title.slice(0, 42)}…`,
            );
            prompt = result.brief.generatePrompt || result.brief.imagePrompt;
            analysis = result.brief.analysis;
            chosenFormat = result.brief.chosenFormat;
            overlayText = result.brief.overlayText;
            whyTheseComps = result.brief.whyTheseComps;
            playbookSummary = result.brief.playbook.summary;
            competitorsJson = result.brief.competitors;
            formatRefYoutubeId = result.brief.formatReference.youtubeId;
            formatRefTitle = result.brief.formatReference.title;
            formatRefUrl = result.brief.formatReference.thumbnailUrl;
            image = result.image;
          } else if (job.useAgent) {
            await setProgress(
              jobId,
              "Scanning DB for 1 layout format + unique reaction face…",
            );
            const result = await generateWithMysteryAgent({
              title: job.title,
              notes: job.notes || undefined,
            });
            await setProgress(
              jobId,
              `Rendering unique 16:9 · format from — ${result.brief.formatReference.title.slice(0, 42)}…`,
            );
            prompt = result.brief.generatePrompt || result.brief.imagePrompt;
            analysis = [
              result.brief.analysis,
              result.brief.anchorPlan
                ? `UNIQUE FACE: ${result.brief.anchorPlan}`
                : "",
            ]
              .filter(Boolean)
              .join("\n\n");
            chosenFormat = result.brief.chosenFormat;
            overlayText = result.brief.overlayText;
            whyTheseComps = result.brief.whyTheseComps;
            playbookSummary = result.brief.playbook.summary;
            competitorsJson = result.brief.competitors;
            formatRefYoutubeId = result.brief.formatReference.youtubeId;
            formatRefTitle = result.brief.formatReference.title;
            formatRefUrl = result.brief.formatReference.thumbnailUrl;
            image = result.image;
          } else {
            await setProgress(jobId, "Rendering gpt-image-2 16:9…");
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
              formatRefYoutubeId,
              formatRefTitle,
              formatRefUrl,
              imageUrl,
              imageR2Key,
              imageBytes: image.byteLength,
              completedAt: new Date(),
              error: null,
            },
          });
          console.log("[jobs] completed", jobId);
        })(),
        JOB_TIMEOUT_MS,
        `job ${jobId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Job failed";
      console.error("[jobs] failed", jobId, message);
      const isStall =
        /timed out/i.test(message) ||
        /upstream/i.test(message) ||
        /temporarily unavailable/i.test(message);
      const alreadyRetried =
        (job.progress || "").includes("Auto-retry") ||
        (job.progress || "").includes("Re-queued after");

      if (isStall && !alreadyRetried) {
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: "queued",
            progress: "Auto-retry after stall…",
            error: null,
            completedAt: null,
          },
        });
        // Defer so the lock releases before re-entry
        setTimeout(() => enqueueJob(jobId), 1500);
      } else {
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
    } finally {
      clearInterval(heartbeat);
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

/** Periodically re-queue jobs that look wedged so the pipeline stays autonomous. */
export function startJobWatchdog() {
  if (watchdogStarted) return;
  watchdogStarted = true;
  console.log("[jobs] watchdog started");
  setInterval(() => {
    void (async () => {
      const cutoff = new Date(Date.now() - STUCK_RUNNING_MS);
      const stuck = await prisma.job.findMany({
        where: {
          status: "running",
          updatedAt: { lt: cutoff },
        },
        orderBy: { updatedAt: "asc" },
        take: 10,
      });
      for (const job of stuck) {
        console.warn("[jobs] watchdog re-queue stuck job", job.id, job.progress);
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: "queued",
            progress: "Auto-retry after stall…",
            error: null,
            completedAt: null,
          },
        });
        enqueueJob(job.id);
      }
    })().catch((err) => {
      console.error("[jobs] watchdog error", err);
    });
  }, 60_000);
}
