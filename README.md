# Mlin Auto Thumb

Auto YouTube thumbnail maker on Railway.

1. Paste a video title (+ optional direction)
2. **gpt-5.6-terra** (ContactBoxTools) writes the image prompt
3. **gpt-image-2** renders **high** quality **16:9** (`1536x1024`)
4. Optional upload to Cloudflare R2 bucket `auto-thumb`

## Stack

- Next.js App Router
- ContactBoxTools (`https://api.contactboxtools.me/v1`)
- Cloudflare R2

## Local

```bash
npm install
cp .env.example .env
npm run dev
```

## API

- `GET /api/health`
- `POST /api/generate` — `{ title, notes?, prompt?, skipUpload? }`
