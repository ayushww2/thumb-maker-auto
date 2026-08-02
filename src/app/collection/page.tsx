"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Channel = {
  id: string;
  name: string;
  handle: string;
  url: string;
  videoCount: number;
};

type Video = {
  id: string;
  youtubeId: string;
  title: string;
  viewCount: number;
  thumbnailUrl: string;
  thumbnailUrlHq?: string | null;
  r2ThumbnailUrl?: string | null;
  displayThumbnailUrl?: string;
  videoUrl: string;
  channel: Channel;
};

type CollectionResponse = {
  ok?: boolean;
  error?: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  q: string;
  channel: string;
  sort: string;
  stats: { videos: number; maxViews: number; sumViews: number; channels: number };
  channels: Channel[];
  videos: Video[];
};

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(n);
}

export default function CollectionPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [channel, setChannel] = useState("");
  const [sort, setSort] = useState("views");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CollectionResponse | null>(null);
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
      minViews: "40000",
    });
    if (debouncedQ) params.set("q", debouncedQ);
    if (channel) params.set("channel", channel);
    return params.toString();
  }, [page, sort, debouncedQ, channel]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/collection?${queryString}`);
      const json = (await res.json()) as CollectionResponse;
      if (!res.ok) throw new Error(json.error || "Failed to load collection");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collection");
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
            <span className="text-[var(--accent)]">Collection Database</span>
            <Link href="/library" className="text-[var(--muted)] hover:text-[var(--ink)]">
              R2 Library
            </Link>
            <Link href="/agent" className="text-[var(--muted)] hover:text-[var(--ink)]">
              Mystery Agent
            </Link>
          </div>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight sm:text-5xl">
            Collection Database
          </h1>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">
            Indexed titles, view counts, and thumbnails from scanned channels
            (40K+ views).
          </p>
        </div>
        {data?.stats ? (
          <div className="grid grid-cols-3 gap-4 text-right">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Videos</p>
              <p className="font-[family-name:var(--font-display)] text-2xl font-bold">
                {data.stats.videos}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Channels</p>
              <p className="font-[family-name:var(--font-display)] text-2xl font-bold">
                {data.stats.channels}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Top views</p>
              <p className="font-[family-name:var(--font-display)] text-2xl font-bold">
                {formatViews(data.stats.maxViews)}
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
            placeholder="python, sphinx, florida…"
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
                {c.name} ({c.videoCount})
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
            <option value="newest">Recently indexed</option>
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
          <p className="text-[var(--muted)]">Loading indexed titles…</p>
        ) : null}
        {(data?.videos || []).map((video) => (
          <article
            key={video.id}
            className="group overflow-hidden border border-[var(--line)] bg-black/25 transition hover:border-[var(--accent)]/50"
          >
            <a href={video.videoUrl} target="_blank" rel="noreferrer" className="block">
              <div className="relative aspect-video overflow-hidden bg-black/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={video.displayThumbnailUrl || video.r2ThumbnailUrl || video.thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                  onError={(e) => {
                    const el = e.currentTarget;
                    if (video.thumbnailUrlHq && el.src !== video.thumbnailUrlHq) {
                      el.src = video.thumbnailUrlHq;
                    }
                  }}
                />
                <span className="absolute bottom-2 right-2 bg-black/75 px-2 py-1 text-xs font-semibold text-[var(--accent)]">
                  {formatViews(video.viewCount)} views
                </span>
              </div>
              <div className="grid gap-2 p-4">
                <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--ink)]">
                  {video.title}
                </h2>
                <p className="text-xs text-[var(--muted)]">{video.channel.name}</p>
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
            Page {data.page} / {data.totalPages} · {data.total} titles
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
