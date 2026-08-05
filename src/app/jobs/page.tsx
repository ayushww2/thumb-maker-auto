"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

type JobRow = {
  id: string;
  title: string;
  notes?: string | null;
  status: string;
  progress: string;
  error?: string | null;
  imageUrl?: string | null;
  imageBytes?: number | null;
  chosenFormat?: string | null;
  overlayText?: string | null;
  formatRefYoutubeId?: string | null;
  formatRefTitle?: string | null;
  formatRefUrl?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

type JobsResponse = {
  ok?: boolean;
  error?: string;
  jobs: JobRow[];
  total: number;
};

function statusColor(status: string) {
  if (status === "completed") return "text-[var(--accent)]";
  if (status === "failed") return "text-[var(--danger)]";
  if (status === "running") return "text-[#7ec8ff]";
  return "text-[var(--muted)]";
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function JobsPageInner() {
  const searchParams = useSearchParams();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(
    searchParams.get("selected"),
  );
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const fromQuery = searchParams.get("selected");
    if (fromQuery) setSelected(fromQuery);
  }, [searchParams]);

  const load = useCallback(async () => {
    try {
      const qs = filter ? `?status=${encodeURIComponent(filter)}` : "";
      const res = await fetch(`/api/jobs${qs}`);
      const json = (await res.json()) as JobsResponse;
      if (!res.ok) throw new Error(json.error || "Failed to load jobs");
      setJobs(json.jobs || []);
      setTotal(json.total || 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    }
  }, [filter]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    async function fetchDetail() {
      const res = await fetch(`/api/jobs/${selected}`);
      const json = await res.json();
      if (!cancelled && res.ok) setDetail(json.job);
    }
    void fetchDetail();
    const t = window.setInterval(() => void fetchDetail(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [selected]);

  async function retry(id: string) {
    await fetch(`/api/jobs/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry" }),
    });
    void load();
  }

  const selectedJob = detail as JobRow & {
    prompt?: string;
    analysis?: string;
    whyTheseComps?: string;
    competitorsJson?: Array<{
      youtubeId: string;
      title: string;
      viewCount: number;
      thumbnailUrl: string;
      videoUrl: string;
      channelName: string;
      isFormatReference?: boolean;
    }>;
  } | null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 pb-20 pt-8 sm:px-10">
      <div className="flex flex-wrap gap-4 text-xs font-semibold uppercase tracking-[0.18em]">
        <Link href="/" className="text-[var(--muted)] hover:text-[var(--ink)]">
          Generate
        </Link>
        <span className="text-[var(--accent)]">Past Jobs</span>
        <Link href="/collection" className="text-[var(--muted)] hover:text-[var(--ink)]">
          Collection
        </Link>
        <Link href="/library" className="text-[var(--muted)] hover:text-[var(--ink)]">
          R2 Library
        </Link>
        <Link href="/agent" className="text-[var(--muted)] hover:text-[var(--ink)]">
          Mystery Agent
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight sm:text-5xl">
            Past Jobs
          </h1>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">
            Thumbnail jobs keep running in the background. Open any job to watch
            progress or grab the finished still.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-[var(--line)] bg-black/30 px-3 py-2 text-sm"
          >
            <option value="">All</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <p className="text-sm text-[var(--muted)]">{total} jobs</p>
        </div>
      </div>

      {error ? (
        <p className="mt-6 border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[#ffd2c6]">
          {error}
        </p>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="grid gap-3">
          {jobs.length === 0 ? (
            <p className="text-[var(--muted)]">
              No jobs yet.{" "}
              <Link href="/" className="text-[var(--accent)] underline-offset-4 hover:underline">
                Submit a title
              </Link>
              .
            </p>
          ) : null}
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => setSelected(job.id)}
              className={`grid grid-cols-[96px_1fr] gap-3 border p-3 text-left transition ${
                selected === job.id
                  ? "border-[var(--accent)] bg-black/35"
                  : "border-[var(--line)] bg-black/20 hover:border-[var(--accent)]/40"
              }`}
            >
              <div className="aspect-video overflow-hidden bg-black/50">
                {job.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={job.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-wider text-[var(--muted)]">
                    {job.status}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-semibold">{job.title}</p>
                <p className={`mt-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusColor(job.status)}`}>
                  {job.status}
                </p>
                <p className="mt-1 truncate text-xs text-[var(--muted)]">{job.progress}</p>
                <p className="mt-1 text-[11px] text-[var(--muted)]">{timeAgo(job.createdAt)}</p>
              </div>
            </button>
          ))}
        </section>

        <section className="border border-[var(--line)] bg-black/20 p-5">
          {!selectedJob ? (
            <p className="text-sm text-[var(--muted)]">Select a job to inspect details.</p>
          ) : (
            <div className="grid gap-4">
              <div>
                <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${statusColor(selectedJob.status)}`}>
                  {selectedJob.status} · {selectedJob.progress}
                </p>
                <h2 className="mt-2 text-lg font-semibold leading-snug">{selectedJob.title}</h2>
                {selectedJob.notes ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">{selectedJob.notes}</p>
                ) : null}
              </div>

              {selectedJob.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedJob.imageUrl}
                  alt=""
                  className="aspect-video w-full border border-[var(--line)] object-cover"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center border border-[var(--line)] bg-black/40 text-sm text-[var(--muted)]">
                  {selectedJob.status === "failed"
                    ? "Failed"
                    : "Still rendering in the background…"}
                </div>
              )}

              {selectedJob.error ? (
                <p className="border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[#ffd2c6]">
                  {selectedJob.error}
                </p>
              ) : null}

              {selectedJob.formatRefUrl ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                    Format reference (copied layout)
                  </p>
                  <a
                    href={
                      selectedJob.formatRefYoutubeId
                        ? `https://www.youtube.com/watch?v=${selectedJob.formatRefYoutubeId}`
                        : selectedJob.formatRefUrl
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 grid grid-cols-[140px_1fr] gap-3 overflow-hidden border border-[var(--accent)]/50 bg-black/30"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedJob.formatRefUrl}
                      alt=""
                      className="aspect-video w-full object-cover"
                    />
                    <div className="min-w-0 py-2 pr-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
                        16:9 layout source
                      </p>
                      <p className="mt-1 line-clamp-3 text-xs leading-snug">
                        {selectedJob.formatRefTitle || "Reference thumbnail"}
                      </p>
                    </div>
                  </a>
                </div>
              ) : null}

              {selectedJob.chosenFormat ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                    Chosen format
                  </p>
                  <p className="mt-1 text-sm">{selectedJob.chosenFormat}</p>
                </div>
              ) : null}

              {selectedJob.overlayText ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                    Overlay text
                  </p>
                  <p className="mt-1 text-sm font-semibold tracking-wide">
                    {selectedJob.overlayText}
                  </p>
                </div>
              ) : null}

              {selectedJob.analysis ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                    Analysis
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--ink)]/90">
                    {selectedJob.analysis}
                  </p>
                </div>
              ) : null}

              {selectedJob.competitorsJson && selectedJob.competitorsJson.length > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                    Related comps
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {selectedJob.competitorsJson.slice(0, 5).map((c) => (
                      <a
                        key={c.youtubeId}
                        href={c.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`overflow-hidden border ${
                          c.isFormatReference ||
                          c.youtubeId === selectedJob.formatRefYoutubeId
                            ? "border-[var(--accent)]"
                            : "border-[var(--line)]"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />
                        <p className="line-clamp-2 p-1.5 text-[10px]">
                          {c.isFormatReference ||
                          c.youtubeId === selectedJob.formatRefYoutubeId
                            ? "FORMAT · "
                            : ""}
                          {c.title}
                        </p>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2">
                {selectedJob.imageUrl ? (
                  <a
                    href={selectedJob.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent-ink)]"
                  >
                    Open on R2
                  </a>
                ) : null}
                {selectedJob.status === "failed" ? (
                  <button
                    type="button"
                    onClick={() => void retry(selectedJob.id)}
                    className="border border-[var(--line)] px-4 py-2 text-sm"
                  >
                    Retry job
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto min-h-screen w-full max-w-6xl px-6 pt-10 text-[var(--muted)]">
          Loading jobs…
        </main>
      }
    >
      <JobsPageInner />
    </Suspense>
  );
}
