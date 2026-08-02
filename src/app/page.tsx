"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type Competitor = {
  youtubeId: string;
  title: string;
  viewCount: number;
  thumbnailUrl: string;
  videoUrl: string;
  channelName: string;
  score: number;
};

type GenerateResponse = {
  ok?: boolean;
  error?: string;
  agent?: string | null;
  prompt?: string;
  analysis?: string | null;
  chosenFormat?: string | null;
  overlayText?: string | null;
  whyTheseComps?: string | null;
  playbookSummary?: string | null;
  competitors?: Competitor[];
  image?: { dataUrl: string; bytes: number };
  upload?: { key: string; publicUrl: string | null } | null;
  r2Configured?: boolean;
};

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export default function Home() {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setPhase("Mystery Thumb Agent scanning collection…");
    const phaseTimer = window.setTimeout(
      () => setPhase("Matching top 5 competitor thumbs + teaching format…"),
      2500,
    );
    const phaseTimer2 = window.setTimeout(
      () => setPhase("Rendering gpt-image-2 high 16:9…"),
      9000,
    );
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, notes, useAgent: true }),
      });
      const data = (await res.json()) as GenerateResponse;
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setResult(data);
      setPhase("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setPhase("");
    } finally {
      window.clearTimeout(phaseTimer);
      window.clearTimeout(phaseTimer2);
      setLoading(false);
    }
  }

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 pb-16 pt-10 sm:px-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22 viewBox=%220 0 120 120%22%3E%3Cpath d=%22M120 0H0v120%22 fill=%22none%22 stroke=%22rgba(244,247,242,0.04)%22 stroke-width=%221%22/%3E%3C/svg%3E')] opacity-80"
      />

      <header className="anim-rise relative z-10">
        <div className="mb-6 flex flex-wrap gap-4 text-xs font-semibold uppercase tracking-[0.18em]">
          <span className="text-[var(--accent)]">Generate</span>
          <Link href="/collection" className="text-[var(--muted)] hover:text-[var(--ink)]">
            Collection Database
          </Link>
          <Link href="/library" className="text-[var(--muted)] hover:text-[var(--ink)]">
            R2 Library
          </Link>
          <Link href="/agent" className="text-[var(--muted)] hover:text-[var(--ink)]">
            Mystery Agent
          </Link>
        </div>
        <p className="font-[family-name:var(--font-display)] text-5xl font-extrabold tracking-tight text-[var(--ink)] sm:text-7xl">
          Mlin Auto Thumb
        </p>
        <p className="anim-rise-delay mt-3 text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
          Mystery Thumb Agent
        </p>
        <p className="anim-rise-delay mt-4 max-w-2xl text-base text-[var(--muted)] sm:text-lg">
          Trained on your 40K+ competitor database. Submit a title — it finds the
          closest viral thumbs, copies the winning format, and renders a
          16:9 high still.
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="anim-rise-delay-2 relative z-10 mt-12 grid gap-5 border-t border-[var(--line)] pt-10"
      >
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Video title
          </span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Scientists Opened a Sealed Chamber in the Amazon — What They Found…"
            className="w-full border border-[var(--line)] bg-black/25 px-4 py-3 text-lg text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Direction (optional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Prefer face + artifact, red circle callout, no long text…"
            className="w-full resize-y border border-[var(--line)] bg-black/25 px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={loading || !title.trim()}
            className="bg-[var(--accent)] px-6 py-3 font-[family-name:var(--font-display)] text-base font-bold tracking-wide text-[var(--accent-ink)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Agent working…" : "Make thumbnail"}
          </button>
          {loading ? (
            <span className="busy-bar text-sm text-[var(--muted)]">{phase}</span>
          ) : (
            <span className="text-sm text-[var(--muted)]">
              terra playbook → top 5 comps → image-2 high
            </span>
          )}
        </div>
      </form>

      {error ? (
        <p className="relative z-10 mt-8 border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[#ffd2c6]">
          {error}
        </p>
      ) : null}

      {result?.image?.dataUrl ? (
        <section className="relative z-10 mt-12 grid gap-8 border-t border-[var(--line)] pt-10">
          <div className="overflow-hidden border border-[var(--line)] bg-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.image.dataUrl}
              alt="Generated thumbnail"
              className="aspect-video w-full object-cover"
            />
          </div>

          {(result.analysis || result.chosenFormat) && (
            <div className="grid gap-4 border border-[var(--line)] bg-black/20 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                Mystery Thumb Agent
              </p>
              {result.chosenFormat ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                    Chosen format
                  </p>
                  <p className="mt-1 text-sm">{result.chosenFormat}</p>
                </div>
              ) : null}
              {result.overlayText ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                    Overlay text
                  </p>
                  <p className="mt-1 text-sm font-semibold">{result.overlayText}</p>
                </div>
              ) : null}
              {result.analysis ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                    Analysis
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--ink)]/90">
                    {result.analysis}
                  </p>
                </div>
              ) : null}
              {result.whyTheseComps ? (
                <p className="text-sm text-[var(--muted)]">{result.whyTheseComps}</p>
              ) : null}
            </div>
          )}

          {result.competitors && result.competitors.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Top 5 closest competitor thumbs
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {result.competitors.map((c) => (
                  <a
                    key={c.youtubeId}
                    href={c.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden border border-[var(--line)] bg-black/25 transition hover:border-[var(--accent)]/50"
                  >
                    <div className="relative aspect-video bg-black/50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={c.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute bottom-1 right-1 bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                        {formatViews(c.viewCount)}
                      </span>
                    </div>
                    <p className="line-clamp-3 p-2 text-[11px] leading-snug text-[var(--ink)]/90">
                      {c.title}
                    </p>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {result.prompt ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Image prompt
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]/90">
                {result.prompt}
              </p>
            </div>
          ) : null}

          {result.upload?.publicUrl ? (
            <a
              href={result.upload.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
            >
              Open on R2 →
            </a>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
