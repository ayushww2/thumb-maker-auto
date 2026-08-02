"use client";

import { FormEvent, useState } from "react";

type GenerateResponse = {
  ok?: boolean;
  error?: string;
  prompt?: string;
  image?: { dataUrl: string; bytes: number };
  upload?: { key: string; publicUrl: string | null } | null;
  r2Configured?: boolean;
};

export default function Home() {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, notes }),
      });
      const data = (await res.json()) as GenerateResponse;
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
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
        <p className="font-[family-name:var(--font-display)] text-5xl font-extrabold tracking-tight text-[var(--ink)] sm:text-7xl">
          Mlin Auto Thumb
        </p>
        <p className="anim-rise-delay mt-4 max-w-xl text-base text-[var(--muted)] sm:text-lg">
          Drop a title. We reason with gpt-5.6-terra, then render a high-quality
          16:9 still on gpt-image-2.
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
            placeholder="Why this city vanished overnight"
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
            placeholder="Cold night, lone figure, documentary still, no text in frame…"
            className="w-full resize-y border border-[var(--line)] bg-black/25 px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={loading || !title.trim()}
            className="bg-[var(--accent)] px-6 py-3 font-[family-name:var(--font-display)] text-base font-bold tracking-wide text-[var(--accent-ink)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Rendering…" : "Make thumbnail"}
          </button>
          {loading ? (
            <span className="busy-bar text-sm text-[var(--muted)]">
              ContactBox · terra → image-2 high
            </span>
          ) : null}
        </div>
      </form>

      {error ? (
        <p className="relative z-10 mt-8 border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[#ffd2c6]">
          {error}
        </p>
      ) : null}

      {result?.image?.dataUrl ? (
        <section className="relative z-10 mt-12 grid gap-6 border-t border-[var(--line)] pt-10">
          <div className="overflow-hidden border border-[var(--line)] bg-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.image.dataUrl}
              alt="Generated thumbnail"
              className="aspect-video w-full object-cover"
            />
          </div>
          {result.prompt ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Prompt
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
          ) : result.r2Configured === false ? (
            <p className="text-sm text-[var(--muted)]">
              Saved in-browser only — R2 upload needs Access Key ID + bucket.
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
