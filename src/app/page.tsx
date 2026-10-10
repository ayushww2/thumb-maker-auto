"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function parseTitleLines(raw: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const title = line.trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }
  return titles;
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [title, setTitle] = useState("");
  const [batchTitles, setBatchTitles] = useState("");
  const [notes, setNotes] = useState("");
  const [agentType, setAgentType] = useState<
    "mystery" | "clay" | "space" | "crown"
  >("crown");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedIds, setQueuedIds] = useState<string[]>([]);

  const batchCount = useMemo(
    () => parseTitleLines(batchTitles).length,
    [batchTitles],
  );

  const canSubmit =
    mode === "single" ? Boolean(title.trim()) : batchCount > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setQueuedIds([]);
    try {
      const titles =
        mode === "batch" ? parseTitleLines(batchTitles) : [title.trim()];
      if (titles.length === 0) {
        throw new Error("At least one title is required");
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titles,
          notes,
          useAgent: true,
          agentType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to queue job");

      const jobs = Array.isArray(data.jobs)
        ? data.jobs
        : data.job
          ? [data.job]
          : [];
      const ids = jobs.map((j: { id: string }) => j.id).filter(Boolean);
      setQueuedIds(ids);
      setTitle("");
      setBatchTitles("");
      setNotes("");

      if (ids.length === 1) {
        router.push(`/jobs?selected=${ids[0]}`);
      } else if (ids.length > 1) {
        router.push(`/jobs?selected=${ids[0]}&batch=${ids.length}`);
      }
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
            Agents
          </Link>
        </div>
        <p className="font-[family-name:var(--font-display)] text-5xl font-extrabold tracking-tight text-[var(--ink)] sm:text-7xl">
          Mlin Auto Thumb
        </p>
        <p className="anim-rise-delay mt-3 text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
          {agentType === "crown"
            ? "Crown Watch Agent"
            : agentType === "space"
              ? "Space Thumb Agent"
              : agentType === "clay"
                ? "Clay Thumb Agent"
                : "Mystery Thumb Agent"}
        </p>
        <p className="anim-rise-delay mt-4 max-w-2xl text-base text-[var(--muted)] sm:text-lg">
          {agentType === "crown"
            ? "Crown Watch thumbs are trained on the channel’s top 150 videos — red BREAKING NEWS tab plus a short high-CTR quote banner."
            : agentType === "space"
              ? "Space thumbs are trained only on Space competitor titles + thumbs (≥100K views)."
              : agentType === "clay"
                ? "Clay thumbnails are trained only on Clay Mysteries competitor titles + thumbs (≥100K views)."
                : "Submit a title — the job keeps running in the background while comps are matched and rendered."}
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="anim-rise-delay-2 relative z-10 mt-12 grid gap-5 border-t border-[var(--line)] pt-10"
      >
        <fieldset className="grid gap-2">
          <legend className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Agent
          </legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAgentType("crown")}
              className={`border px-4 py-2 text-sm font-semibold ${
                agentType === "crown"
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] text-[var(--muted)]"
              }`}
            >
              Crown Watch
            </button>
            <button
              type="button"
              onClick={() => setAgentType("space")}
              className={`border px-4 py-2 text-sm font-semibold ${
                agentType === "space"
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] text-[var(--muted)]"
              }`}
            >
              Space Thumbs
            </button>
            <button
              type="button"
              onClick={() => setAgentType("clay")}
              className={`border px-4 py-2 text-sm font-semibold ${
                agentType === "clay"
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] text-[var(--muted)]"
              }`}
            >
              Clay Thumbnails
            </button>
            <button
              type="button"
              onClick={() => setAgentType("mystery")}
              className={`border px-4 py-2 text-sm font-semibold ${
                agentType === "mystery"
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] text-[var(--muted)]"
              }`}
            >
              Mystery Thumbnails
            </button>
          </div>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Submit
          </legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("single")}
              className={`border px-4 py-2 text-sm font-semibold ${
                mode === "single"
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] text-[var(--muted)]"
              }`}
            >
              One title
            </button>
            <button
              type="button"
              onClick={() => setMode("batch")}
              className={`border px-4 py-2 text-sm font-semibold ${
                mode === "batch"
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] text-[var(--muted)]"
              }`}
            >
              Multiple titles
            </button>
          </div>
        </fieldset>

        {mode === "single" ? (
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              Video title
            </span>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            placeholder={
              agentType === "crown"
                ? "William And Catherine Shock The Palace With A Final Decision On Camilla…"
                : agentType === "space"
                  ? "What NASA Found on the Dark Side of Jupiter…"
                  : agentType === "clay"
                    ? "The Sumerian Tablet That Reveals Why Humans Were Hidden Underground…"
                    : "Scientists Opened a Sealed Chamber in the Amazon — What They Found…"
            }
              className="w-full border border-[var(--line)] bg-black/25 px-4 py-3 text-lg text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
        ) : (
          <label className="grid gap-2">
            <span className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              <span>Video titles</span>
              <span className="normal-case tracking-normal text-[var(--muted)]">
                {batchCount} title{batchCount === 1 ? "" : "s"} · one per line ·
                max 25
              </span>
            </span>
            <textarea
              required
              value={batchTitles}
              onChange={(e) => setBatchTitles(e.target.value)}
              rows={8}
              placeholder={
                agentType === "crown"
                  ? "William Bars Camilla From The Palace\nCatherine’s Mother Shuts Down The Attack\nHarry Crosses A Red Line And Loses Everything"
                  : agentType === "space"
                    ? "What NASA Found Beyond Pluto\nJupiter Is Not What You Think\nThe Object That Will Change Your View of Space Forever…"
                    : agentType === "clay"
                      ? "The Sumerian Tablet That Reveals Why Humans Were Hidden Underground\nThe Ethiopian Bible Verse That Names the End Date\nAI Reanalyzed the Sealed Chamber Under Jerusalem…"
                      : "Scientists Opened a Sealed Chamber in the Amazon — What They Found\nDivers Found a Door Under the Ice — Then It Opened\nThey Dug Under the Vatican Vault — And Froze…"
              }
              className="w-full resize-y border border-[var(--line)] bg-black/25 px-4 py-3 font-mono text-base leading-relaxed text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
        )}

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Direction (optional)
            {mode === "batch" ? " · shared across all titles" : ""}
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={
              agentType === "crown"
                ? "Keep the red BREAKING NEWS tab and a short quoted banner — split face left, scandal right…"
                : agentType === "space"
                  ? "Heavy comp copy: same layout + real youtube-space text (THIS IS … / WHAT NASA SAW), planet/NASA find dominant…"
                  : agentType === "clay"
                    ? "Copy clay viral layout: ancient tablet / sealed text + punch banner + red marker…"
                    : "News-realism: shocked face, discovery right, thick red arrow + circle…"
            }
            className="w-full resize-y border border-[var(--line)] bg-black/25 px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="bg-[var(--accent)] px-6 py-3 font-[family-name:var(--font-display)] text-base font-bold tracking-wide text-[var(--accent-ink)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading
              ? "Queuing…"
              : mode === "batch"
                ? `Queue ${batchCount || ""} thumbnail job${batchCount === 1 ? "" : "s"}`.trim()
                : "Queue thumbnail job"}
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

      {queuedIds.length > 0 ? (
        <p className="relative z-10 mt-6 text-sm text-[var(--accent)]">
          {queuedIds.length === 1
            ? "Job queued."
            : `${queuedIds.length} jobs queued.`}{" "}
          <Link
            href={`/jobs?selected=${queuedIds[0]}`}
            className="underline underline-offset-4"
          >
            View in Past Jobs →
          </Link>
        </p>
      ) : null}
    </main>
  );
}
