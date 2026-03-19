# okacephoto-image-host

Lightweight, production-ready global image hosting on Cloudflare:
- Public image URLs (no login, no Cloudflare Access)
- Admin upload/gallery/folder management with a single shared password
- Cloudflare edge caching via R2 public custom domain

## Architecture (required choices)

This project uses **Option A** for public delivery:

### Option A (chosen)
- **R2 custom public domain serves the images directly**
- The Worker is used for:
  - admin login (shared password)
  - upload + metadata writes (D1 + R2)
  - authenticated gallery/folder/search APIs

Why this is simpler and more globally reliable:
- Public delivery **does not go through the Worker at all**, so it is impossible for admin-only auth logic or cookies to affect public viewing in any region/country (including Laos).
- Public URLs are stable and permanent because they directly reference an immutable object key in R2.
- Worker overhead is eliminated from public image fetches (lower latency + fewer failure modes at the edge).

### Public URL format

Uploaded objects are stored in R2 under:
- `i/<random_key>`

So the public URL becomes:
- `https://img.yourdomain.com/i/<random_key>`

The exact base domain is configured by `R2_PUBLIC_BASE_URL`.

## Key features

1. Admin login
   - Single shared password verified server-side
   - HttpOnly, Secure session cookie
   - Logout + session expiry
   - Login rate limiting
2. Upload panel
   - Drag & drop, multi-file upload
   - Per-file progress
   - Optional client-side compression toggle
   - Folder + tags + alt/title/note metadata
   - Copy public URL, Markdown, and HTML `img` embed immediately after upload
3. Gallery
   - Grid, lazy-loaded thumbnails
   - Search by filename, folder, and tag
   - Sort + pagination
   - Preview modal + copy actions
   - Soft delete and hard delete
   - Move asset between folders
4. Folder system
   - Create, rename, and assign assets to folders
5. Security
   - Strong server-side MIME + magic-byte validation
   - Strict upload size limit (configurable)
   - Reject unsafe SVG (basic checks: no scripts / JS URLs)
   - No Cloudflare Access anywhere

## Cloudflare Dashboard deployment (exact steps)

The steps below assume you will deploy:
- Worker: `api.yourdomain.com`
- Admin UI: Cloudflare Pages (static)
- Public images: R2 public custom domain `img.yourdomain.com`

## Deploy without running Wrangler locally (recommended)

เป้าหมายคือ “ไม่ต้องรันคำสั่ง `wrangler` บนเครื่องคุณ”

1. ใช้ Cloudflare Dashboard deploy Worker จาก GitHub
2. รัน D1 migration ผ่านแท็บ SQL ใน Cloudflare Dashboard
3. Deploy frontend ผ่าน Cloudflare Pages

ขั้นตอนจริงดูในหัวข้อด้านล่าง (1 ถึง 6) โดย:
- ให้คุณทำ “Run the D1 migration” แบบ `Option 1 (Dashboard)` จะไม่ต้องใช้ `wrangler`
- ส่วน Worker ทำผ่าน “Deploy from Git” ที่ Dashboard จะจัดการ build/deploy ให้

### 1) Create R2 bucket

1. Go to Cloudflare Dashboard -> **Workers & Routes** -> **R2**.
2. Click **Create bucket**.
3. Name it: `okacephoto-images`
4. In the bucket settings, enable **Public bucket / Public access with a custom domain** (wording may vary by account UI).
5. Configure the public custom domain:
   - Create/verify DNS for `img.yourdomain.com`
   - Add a CNAME/ALIAS as directed by Cloudflare for the R2 public domain feature
6. After this, objects stored in R2 are reachable publicly at:
   - `https://img.yourdomain.com/<object_key>`
7. This repo uploads objects using the object key prefix:
   - `i/<random_key>`
   - So public URLs become: `https://img.yourdomain.com/i/<random_key>`

> Important: This project expects R2 public URLs to serve objects at:
> `https://img.yourdomain.com/<object_key>`
>
> Example: object key `i/AbCd...` must be reachable at `https://img.yourdomain.com/i/AbCd...`.

### 2) Create D1 database

1. Dashboard -> **D1** -> **Create database**
2. Name it: `okacephoto`
3. Note the **Database ID** (needed for `wrangler.toml` if you want local `wrangler d1 migrations apply`).

### 3) Create the Worker

1. Dashboard -> **Workers & Routes** -> **Create** -> **Worker**
2. Name it: `okacephoto-api`
3. Set the Worker route:
   - `api.yourdomain.com/*`
4. Add bindings:
   - D1 binding: `DB`
     - Database: `okacephoto`
   - R2 binding: `ASSETS_BUCKET`
     - Bucket: `okacephoto-images`
5. Ensure the Worker route is not protected by any Access policy (public images must be served directly from R2).

### 4) Add Worker secrets/variables

In the Worker -> **Settings** -> **Variables and secrets**, set:

Secrets (do not expose to frontend):
- `AUTH_SHARED_PASSWORD` (single admin password)
- `COOKIE_SIGNING_SECRET` (random secret for signing session cookies; use a long random value)

Variables:
- `COOKIE_NAME` (default: `okacephoto_admin`)
- `COOKIE_DOMAIN` (example: `.yourdomain.com` so the cookie is sent to `api.yourdomain.com`)
- `CORS_ALLOW_ORIGIN` (example: `https://app.yourdomain.com`)
- `R2_PUBLIC_BASE_URL` (example: `https://img.yourdomain.com`)
- Must match the R2 public custom domain exactly (no `/i` suffix; this repo appends `/i/<key>` itself).
- `MAX_FILE_SIZE_BYTES` (example: `10485760` for 10MB)

Rate limit knobs (defaults are used if you don’t set them):
- `LOGIN_RATE_MAX_ATTEMPTS` (default: `10`)
- `LOGIN_RATE_WINDOW_SECONDS` (default: `600`)
- `LOGIN_RATE_BLOCK_SECONDS` (default: `900`)

Allowed MIME list (defaults are used if you don’t set them):
- `ALLOWED_MIME` (comma-separated)

### 5) Run the D1 migration

You can run migrations either via:

Option 1 (Dashboard):
1. Dashboard -> D1 -> your database `okacephoto`
2. Tab: **SQL**
3. Copy and run the contents of `worker/d1/migrations/001_init.sql`

Option 2 (recommended with wrangler):
- Run from this repo root:
  - `cd worker`
  - `npm run d1-migrate`

If you run locally, update `wrangler.toml` with your real `database_id` (D1) value.

### 6) Deploy with Git-based deployment

1. Push this repo to GitHub/GitLab.
2. Dashboard -> **Workers & Routes** -> your worker -> **Deploy from Git**
3. Select your repo + branch
4. Ensure build step uses the worker configuration from `wrangler.toml`

Deploy the frontend with Cloudflare Pages:
1. Dashboard -> **Pages** -> **Create**
2. Connect repo
3. Build command: `npm run build`
4. Build output: for this repo, Pages should point at `frontend/dist`
5. Set Pages environment variable:
   - `VITE_API_BASE_URL` = `https://api.yourdomain.com`
6. This frontend uses `HashRouter`, so you do NOT need SPA rewrite rules for deep links.

## Local development (optional)

See `frontend/` and `worker/` folders for dev scripts.

## Repo Structure

- `frontend/`: React/Vite admin panel (login, upload, gallery, folders)
- `worker/`: Cloudflare Worker API (Hono + TypeScript)
- `worker/d1/migrations/001_init.sql`: D1 schema + indexes
- `wrangler.toml`: Worker entrypoint + binding names (`DB`, `ASSETS_BUCKET`)

## Environment Files

- Root: `.env.example` (worker variables documented)
- `worker/.env.example` (worker variables documented)
- `frontend/.env.example` (frontend-only variables)

Notes:
- The shared password `AUTH_SHARED_PASSWORD` is only in **Worker secrets**.
- The frontend never receives the password.

## Worker Binding Names (must match code)

The Worker expects these bindings:
- D1 binding: `DB`
- R2 bucket binding: `ASSETS_BUCKET`

The admin API endpoints are under `https://api.yourdomain.com/api/*` and require the session cookie.

## Public Image Delivery Details (R2 public custom domain)

The Worker uploads objects into R2 under the object key:
- `i/<random_key>`

Therefore, the public URL format is:
- `R2_PUBLIC_BASE_URL + "/i/<random_key>"`

Example:
- If `R2_PUBLIC_BASE_URL = https://img.yourdomain.com`, then an uploaded object key `i/AbCd...` is reachable at:
  - `https://img.yourdomain.com/i/AbCd...`

To ensure this works globally without any auth/cookies, configure the R2 bucket feature “Public access with custom domain” for `img.yourdomain.com`.

## How this fixes the old Cloudflare Access issue

The prior design used Cloudflare Access in front of image viewing, which can:
- require cookies/token negotiation,
- accidentally break “public” image links in certain networks/regions,
- cause unpredictable behavior in clients that do not present Access cookies.

This new architecture never routes public image fetches through authenticated endpoints.
Public URLs resolve directly against the **R2 public custom domain**, which is globally accessible without login and without any Access cookies or auth headers.

