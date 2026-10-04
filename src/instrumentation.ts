export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { resumeQueuedJobs } = await import("@/lib/jobs/process");
    // Delay slightly so Prisma / DB is ready after boot
    setTimeout(() => {
      void resumeQueuedJobs().catch((err) => {
        console.error("[instrumentation] resumeQueuedJobs failed", err);
      });
    }, 1500);
  } catch (err) {
    console.error("[instrumentation] register failed", err);
  }
}
