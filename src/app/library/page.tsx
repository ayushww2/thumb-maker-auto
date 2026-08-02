"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Channel = {
  id: string;
  name: string;
  handle: string;
  url: string;
  videoCount?: number;
};

type LibraryVideo = {
  id: string;
  youtubeId: string;
  title: string;
  viewCount: number;
  videoUrl: string;
  thumbnailUrl: string | null;
  r2Key: string | null;
  channel: Channel;
};

type LibraryResponse = {
  ok?: boolean;
  error?: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  q: string;
  channel: string;
  sort: string;
  publicBaseUrl: string | null;
  indexUrl: string | null;
  stats: { mirrored: number; channels: number };
  channels: Channel[];
  videos: LibraryVideo[];
};

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(n);
}

export default function LibraryPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [channel, setChannel] = useState("");
  const [sort, setSort] = useState("views");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "24",
      sort,
    });
    if (debouncedQ) params.set("q", debouncedQ);
    if (channel) params.set("channel", channel);
    return params.toString();
  }, [page, sort, debouncedQ, channel]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/library?${queryString}`);
      const json = (await res.json()) as LibraryResponse;
      if (!res.ok) throw new Error(json.error || "Failed to load R2 library");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load R2 library");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-6xl px-6 pb-20 pt-8 sm:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line)] pb-8">
        <div>
          <div className="flex flex-wrap gap-4 text-xs font-semibold uppercase tracking-[0.18em]">
            <Link href="/" className="text-[var(--muted)] hover:text-[var(--ink)]">
              Generate
            </Link>
            <Link href="/collection" className="text-[var(--muted)] hover:text-[var(--ink)]">
              Collection
            </Link>
            <Link href="/agent" className="text-[var(--muted)] hover:text-[var(--ink)]">
              Mystery Agent
            </Link>
            <span className="text-[var(--accent)]">R2 Library</span>
          </div>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight sm:text-5xl">
            R2 Title Library
          </h1>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">
            Titles and thumbnails mirrored to Cloudflare R2 — served from your
            public bucket URL.
          </p>
          {data?.indexUrl ? (
            <a
              href={data.indexUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm text-[var(--accent)] underline-offset-4 hover:underline"
            >
              Open collection/index.json →
            </a>
          ) : null}
        </div>
        {data?.stats ? (
          <div className="grid grid-cols-2 gap-6 text-right">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">On R2</p>
              <p className="font-[family-name:var(--font-display)] text-2xl font-bold">
                {data.stats.mirrored}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Showing</p>
              <p className="font-[family-name:var(--font-display)] text-2xl font-bold">
                {data.total}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="sticky top-0 z-20 mt-6 grid gap-3 border border-[var(--line)] bg-[rgba(15,20,18,0.92)] p-4 backdrop-blur md:grid-cols-[1fr_220px_160px]">
        <label className="grid gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
            Search titles
          </span>
          <input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Search mirrored titles…"
            className="border border-[var(--line)] bg-black/30 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
            Channel
          </span>
          <select
            value={channel}
            onChange={(e) => {
              setPage(1);
              setChannel(e.target.value);
            }}
            className="border border-[var(--line)] bg-black/30 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">All channels</option>
            {(data?.channels || []).map((c) => (
              <option key={c.id} value={c.handle}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
            Sort
          </span>
          <select
            value={sort}
            onChange={(e) => {
              setPage(1);
              setSort(e.target.value);
            }}
            className="border border-[var(--line)] bg-black/30 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="views">Most views</option>
            <option value="title">Title A–Z</option>
            <option value="newest">Recently mirrored</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="mt-6 border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[#ffd2c6]">
          {error}
        </p>
      ) : null}

      <section className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {loading && !data ? (
          <p className="text-[var(--muted)]">Loading R2 library…</p>
        ) : null}
        {!loading && data && data.videos.length === 0 ? (
          <p className="text-[var(--muted)]">No mirrored thumbnails yet.</p>
        ) : null}
        {(data?.videos || []).map((video) => (
          <article
            key={video.id}
            className="group overflow-hidden border border-[var(--line)] bg-black/25 transition hover:border-[var(--accent)]/50"
          >
            <a href={video.videoUrl} target="_blank" rel="noreferrer" className="block">
              <div className="relative aspect-video overflow-hidden bg-black/50">
                {video.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={video.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                  />
                ) : null}
                <span className="absolute bottom-2 right-2 bg-black/75 px-2 py-1 text-xs font-semibold text-[var(--accent)]">
                  {formatViews(video.viewCount)}
                </span>
                <span className="absolute left-2 top-2 bg-[var(--accent)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--accent-ink)]">
                  R2
                </span>
              </div>
              <div className="grid gap-2 p-4">
                <h2 className="line-clamp-2 text-sm font-semibold leading-snug">{video.title}</h2>
                <p className="text-xs text-[var(--muted)]">{video.channel.name}</p>
                {video.r2Key ? (
                  <p className="truncate font-mono text-[10px] text-[var(--muted)]/80">
                    {video.r2Key}
                  </p>
                ) : null}
              </div>
            </a>
          </article>
        ))}
      </section>

      {data && data.totalPages > 1 ? (
        <div className="mt-10 flex items-center justify-between border-t border-[var(--line)] pt-6">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <p className="text-sm text-[var(--muted)]">
            Page {data.page} / {data.totalPages} · {data.total} on R2
          </p>
          <button
            type="button"
            disabled={page >= data.totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </main>
  );
}
