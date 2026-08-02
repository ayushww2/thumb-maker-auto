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
