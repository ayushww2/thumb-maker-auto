"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedId, setQueuedId] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setQueuedId(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, notes, useAgent: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to queue job");
      setQueuedId(data.job.id);
      setTitle("");
      setNotes("");
      // Jump to past jobs so user can watch progress in background
      router.push(`/jobs?selected=${data.job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue job");
    } finally {
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
          <Link href="/jobs" className="text-[var(--muted)] hover:text-[var(--ink)]">
            Past Jobs
          </Link>
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
          Submit a title — the job keeps running in the background. Watch it under
          Past Jobs while the agent matches comps and renders the still.
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
            placeholder="News-realism: shocked anchor left, discovery right, thick red arrow + circle, bold banner text…"
            className="w-full resize-y border border-[var(--line)] bg-black/25 px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={loading || !title.trim()}
            className="bg-[var(--accent)] px-6 py-3 font-[family-name:var(--font-display)] text-base font-bold tracking-wide text-[var(--accent-ink)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Queuing…" : "Queue thumbnail job"}
          </button>
          <span className="text-sm text-[var(--muted)]">
            Runs in background · opens Past Jobs
          </span>
        </div>
      </form>

      {error ? (
        <p className="relative z-10 mt-8 border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[#ffd2c6]">
          {error}
        </p>
      ) : null}

      {queuedId ? (
        <p className="relative z-10 mt-6 text-sm text-[var(--accent)]">
          Job queued.{" "}
          <Link href={`/jobs?selected=${queuedId}`} className="underline underline-offset-4">
            View in Past Jobs →
          </Link>
        </p>
      ) : null}
    </main>
  );
}
