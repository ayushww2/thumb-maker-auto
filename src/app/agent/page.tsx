"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Playbook = {
  summary?: string;
  generatedAt?: string | Date;
  sampleSize?: number;
  viralCount?: number;
  lowCount?: number;
  scanCount?: number;
  r2Url?: string | null;
  viralPatterns?: string[];
  thumbnailFormats?: string[];
};

type Status = {
  trained?: boolean;
  videoCount?: number;
  scanCount?: number;
  playbook?: Playbook | null;
  error?: string;
};

export default function AgentPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/agent/status");
    const json = (await res.json()) as Status;
    if (!res.ok) throw new Error(json.error || "Failed to load agent");
    setStatus(json);
  }

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load"),
    );
  }, []);

  async function retrain() {
    setTraining(true);
    setError(null);
    setMessage("Mystery Thumb Agent scanning thumbs + rebuilding playbook…");
    try {
      const res = await fetch("/api/agent/playbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Train failed");
      setMessage(
        `Trained on ${json.playbook?.scanCount ?? "?"} visual scans · ${json.playbook?.sampleSize ?? "?"} titles`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Train failed");
      setMessage(null);
    } finally {
      setTraining(false);
    }
  }

  const playbook = status?.playbook;

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 pb-20 pt-8 sm:px-10">
      <div className="flex flex-wrap gap-4 text-xs font-semibold uppercase tracking-[0.18em]">
        <Link href="/" className="text-[var(--muted)] hover:text-[var(--ink)]">
          Generate
        </Link>
        <Link href="/jobs" className="text-[var(--muted)] hover:text-[var(--ink)]">
          Past Jobs
        </Link>
        <Link href="/collection" className="text-[var(--muted)] hover:text-[var(--ink)]">
          Collection
        </Link>
        <Link href="/library" className="text-[var(--muted)] hover:text-[var(--ink)]">
          R2 Library
        </Link>
        <span className="text-[var(--accent)]">Mystery Thumb Agent</span>
      </div>

      <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight sm:text-5xl">
        Mystery Thumb Agent
      </h1>
      <p className="mt-3 max-w-2xl text-[var(--muted)]">
        Trains on your competitor database — titles, views, and real thumbnail
        vision scans — then replicates winning formats when you submit a title.
      </p>

      <div className="mt-8 grid gap-4 border border-[var(--line)] bg-black/20 p-5 sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Status</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-xl font-bold">
            {status?.trained ? "Trained" : "Not trained"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Titles</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-xl font-bold">
            {status?.videoCount ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Thumb scans</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-xl font-bold">
            {status?.scanCount ?? playbook?.scanCount ?? "—"}
          </p>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            disabled={training}
            onClick={() => void retrain()}
            className="bg-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent-ink)] disabled:opacity-40"
          >
            {training ? "Training…" : "Retrain agent"}
          </button>
        </div>
      </div>

      {message ? <p className="mt-4 text-sm text-[var(--accent)]">{message}</p> : null}
      {error ? (
        <p className="mt-4 border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[#ffd2c6]">
          {error}
        </p>
      ) : null}

      {playbook?.summary ? (
        <section className="mt-10 grid gap-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              Playbook summary
            </p>
            <p className="mt-2 text-base leading-relaxed">{playbook.summary}</p>
            {playbook.r2Url ? (
              <a
                href={playbook.r2Url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-sm text-[var(--accent)] underline-offset-4 hover:underline"
              >
                Open playbook on R2 →
              </a>
            ) : null}
          </div>

          {playbook.viralPatterns?.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Viral patterns
              </p>
              <ul className="mt-3 grid gap-2 text-sm text-[var(--ink)]/90">
                {playbook.viralPatterns.slice(0, 8).map((p) => (
                  <li key={p} className="border-l-2 border-[var(--accent)] pl-3">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {playbook.thumbnailFormats?.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Thumbnail formats learned
              </p>
              <ul className="mt-3 grid gap-2 text-sm text-[var(--ink)]/90">
                {playbook.thumbnailFormats.slice(0, 8).map((p) => (
                  <li key={p} className="border-l-2 border-[var(--line)] pl-3">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Link
            href="/"
            className="inline-flex w-fit bg-[var(--accent)] px-5 py-3 text-sm font-bold text-[var(--accent-ink)]"
          >
            Generate with agent →
          </Link>
        </section>
      ) : null}
    </main>
  );
}
