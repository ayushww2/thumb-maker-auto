# Mlin Auto Thumb

Auto YouTube thumbnail maker on Railway + indexed collection database.

1. Paste a video title (+ optional direction)
2. **gpt-5.6-terra** (ContactBoxTools) writes the image prompt
3. **gpt-image-2** renders **high** quality **16:9** (`1536x1024`)
4. Browse **Collection Database** of competitor titles/thumbnails (40K+ views)

## Stack

- Next.js App Router
- Postgres (Prisma)
- ContactBoxTools (`https://api.contactboxtools.me/v1`)
- Cloudflare R2

## Local

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run db:seed
npm run dev
```

## API

- `GET /api/health`
- `POST /api/generate` — `{ title, notes?, prompt?, skipUpload? }`
- `GET /api/collection` — indexed titles (`q`, `channel`, `sort`, `page`)
- `POST /api/collection/seed` — upsert `data/collection.json`
- `GET /api/library` — R2-mirrored titles/thumbnails
- `GET /api/agent/status` — Mystery Thumb Agent training status
- `POST /api/agent/playbook` — retrain (vision-scan viral vs low thumbs + rebuild playbook)
- Public R2 index: `https://pub-c25f40bdebfb4d9cb7c2539a01c0854d.r2.dev/collection/index.json`
- Agent playbook: `https://pub-c25f40bdebfb4d9cb7c2539a01c0854d.r2.dev/collection/mystery-playbook.json`

## Mystery Thumb Agent

1. Scans competitor titles/views + real thumbnail vision (gpt-5.6-terra)
2. Builds a viral vs low-view playbook
3. On title submit: finds top 5 closest comps → chooses format/text → renders gpt-image-2 high 16:9
