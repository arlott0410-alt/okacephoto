import { Hono } from "hono";
import { z } from "zod";
import { getEnv } from "./env";
import { requireAuth, issueSessionCookie, logoutCookie, verifySession, checkAndBumpLoginRateLimit } from "./auth";
import { detectMimeFromMagicBytes, assertMimeIsAllowed } from "./mime";
import { makePublicUrl } from "./publicUrl";
import { sanitizeText, splitTags } from "./text";

const app = new Hono();

// Critical decision:
// Public image delivery NEVER goes through this Worker.
// We upload to R2 under the key `i/<random_key>` and serve images directly from the
// R2 public custom domain (`R2_PUBLIC_BASE_URL`). This prevents auth/cookie logic from
// accidentally breaking public image URLs in any region.

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function getIp(c: any) {
  // Cloudflare provides CF-Connecting-IP; fallback to X-Forwarded-For.
  const cfIp = c.req.header("CF-Connecting-IP");
  const fwd = c.req.header("X-Forwarded-For");
  return cfIp ?? (fwd ? fwd.split(",")[0].trim() : "unknown");
}

function setCommonApiHeaders(c: any) {
  const env = c.env as any;
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
  // Credentials required for cookie-based auth.
  const origin = env.CORS_ALLOW_ORIGIN;
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Vary", "Origin");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
}

app.use("/api/*", async (c, next) => {
  setCommonApiHeaders(c);
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }
  return next();
});

app.post("/api/auth/login", async (c) => {
  const env = getEnv(c.env as any);
  const ip = getIp(c);

  const schema = z.object({ password: z.string().min(1).max(256), ttlSeconds: z.number().int().positive().max(2592000).optional() });
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

  const rate = await checkAndBumpLoginRateLimit(env, ip);
  if (!rate.ok) return c.json({ error: "Too many attempts", retryAfterSeconds: rate.retryAfterSeconds }, 429);

  // Constant-time compare for the shared password.
  const a = parsed.data.password;
  const b = env.AUTH_SHARED_PASSWORD;
  let ok = a.length === b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) ok = ok && a.charCodeAt(i) === b.charCodeAt(i);
  if (!ok) return c.json({ error: "Unauthorized" }, 401);

  const cookie = await issueSessionCookie(env, parsed.data.ttlSeconds);
  c.header("Set-Cookie", cookie);
  return c.json({ ok: true });
});

app.post("/api/auth/logout", async (c) => {
  const env = getEnv(c.env as any);
  const cookie = await logoutCookie(env);
  c.header("Set-Cookie", cookie);
  return c.json({ ok: true });
});

app.get("/api/auth/me", async (c) => {
  const env = getEnv(c.env as any);
  const cookie = c.req.header("Cookie") ?? null;
  const auth = await verifySession(env, cookie);
  if (!auth.ok) return c.json({ loggedIn: false });
  return c.json({ loggedIn: true, adminLabel: "admin" });
});

// --- Authenticated routes (admin panel only) ---
app.use("/api/assets", requireAuth);
app.use("/api/folders", requireAuth);
app.use("/api/search", requireAuth);

app.post("/api/assets", async (c) => {
  const env = getEnv(c.env as any);

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Missing file", 400);

  const maxBytes = Number(env.MAX_FILE_SIZE_BYTES);
  if (file.size <= 0 || file.size > maxBytes) return jsonError("Invalid file size", 400);

  const folderIdRaw = form.get("folderId");
  const folderId = typeof folderIdRaw === "string" && folderIdRaw.trim() ? folderIdRaw.trim() : null;

  const tagsRaw = form.get("tags");
  const tags = splitTags(tagsRaw);

  const alt_text = sanitizeText(form.get("altText"), { maxLen: 200 });
  const title = sanitizeText(form.get("title"), { maxLen: 140 });
  const note = sanitizeText(form.get("note"), { maxLen: 400 });

  const widthRaw = form.get("width");
  const heightRaw = form.get("height");
  const width = typeof widthRaw === "string" ? Number(widthRaw) : null;
  const height = typeof heightRaw === "string" ? Number(heightRaw) : null;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectMimeFromMagicBytes(bytes);
  const asserted = assertMimeIsAllowed(detected, env.ALLOWED_MIME);
  if (!asserted.ok) return jsonError("Unsupported or invalid image", 415);

  // Extra safety for SVG: reject any inline script blocks (basic check).
  if (asserted.mime === "image/svg+xml") {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (/<\s*script\b/i.test(text) || /javascript\s*:/i.test(text)) {
      return jsonError("Unsafe SVG rejected", 415);
    }
  }

  // Generate random unguessable key. Do not include original filename.
  const keyBytes = new Uint8Array(24);
  crypto.getRandomValues(keyBytes);
  const key = BufferToBase64Url(keyBytes);
  const objectKey = `i/${key}`;

  // Validate/normalize folder_id if provided.
  let validatedFolderId: string | null = null;
  if (folderId) {
    const folder = await env.DB.prepare(
      "SELECT id FROM folders WHERE id = ? AND deleted_at IS NULL"
    )
      .bind(folderId)
      .first<{ id: string }>();
    if (!folder) return jsonError("Unknown folder", 400);
    validatedFolderId = folderId;
  }

  const now = Date.now();

  // Upload to R2 with long-lived caching since keys are content-addressed by randomness.
  await env.ASSETS_BUCKET.put(objectKey, bytes, {
    httpMetadata: {
      contentType: asserted.mime,
      // Long-lived + immutable: the key is unguessable and stable forever.
      cacheControl: "public, max-age=31536000, immutable"
    }
  });

  const id = crypto.randomUUID();
  const filenameOriginal =
    typeof file.name === "string" && file.name ? file.name.slice(0, 260) : "upload";

  const tagsJson = JSON.stringify(tags);

  await env.DB.prepare(
    "INSERT INTO assets (id, key, filename_original, mime, size, width, height, folder_id, tags, alt_text, title, note, created_at, updated_at, deleted_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      id,
      key,
      filenameOriginal,
      asserted.mime,
      file.size,
      width && Number.isFinite(width) && width > 0 ? width : null,
      height && Number.isFinite(height) && height > 0 ? height : null,
      validatedFolderId,
      tags.length ? tagsJson : null,
      alt_text,
      title,
      note,
      now,
      now,
      null,
      "admin"
    )
    .run();

  for (const t of tags) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO asset_tags (asset_id, tag, created_at) VALUES (?, ?, ?)"
    )
      .bind(id, t, now)
      .run();
  }

  const publicUrl = makePublicUrl(env.R2_PUBLIC_BASE_URL, objectKey);
  return c.json({
    ok: true,
    asset: {
      id,
      key,
      publicUrl,
      filename_original: filenameOriginal,
      mime: asserted.mime,
      size: file.size,
      width,
      height,
      folder_id: validatedFolderId,
      tags,
      alt_text,
      title,
      note,
      created_at: now
    }
  });
});

app.get("/api/search", async (c) => {
  const env = getEnv(c.env as any);
  const url = new URL(c.req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const folderId = (url.searchParams.get("folderId") ?? "").trim() || null;
  const tag = (url.searchParams.get("tag") ?? "").trim() || null;
  const sort = (url.searchParams.get("sort") ?? "newest").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(60, Math.max(1, Number(url.searchParams.get("pageSize") ?? "24")));
  const offset = (page - 1) * pageSize;
  const limitPlusOne = pageSize + 1;

  const where: string[] = ["a.deleted_at IS NULL"];
  const binds: unknown[] = [];

  if (folderId) {
    where.push("a.folder_id = ?");
    binds.push(folderId);
  }
  if (q) {
    where.push("a.filename_original LIKE ?");
    binds.push(`%${q}%`);
  }
  if (tag) {
    where.push(
      "EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag = ?)"
    );
    binds.push(tag.toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 40));
  }

  let orderBy = "a.created_at DESC";
  if (sort === "oldest") orderBy = "a.created_at ASC";
  if (sort === "size") orderBy = "a.size DESC, a.created_at DESC";
  if (sort === "name") orderBy = "a.filename_original ASC, a.created_at DESC";

  const rowRes = await env.DB.prepare(
    `SELECT a.* FROM assets a WHERE ${where.join(" AND ")} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  )
    .bind(...binds, limitPlusOne, offset)
    .all<any>();

  const rows = rowRes.results as any[];
  const hasMore = rows.length > pageSize;
  const take = hasMore ? rows.slice(0, pageSize) : rows;

  const assets = take.map((a) => {
    const tagsArr: string[] = a.tags ? (() => { try { return JSON.parse(a.tags); } catch { return []; } })() : [];
    const objectKey = `i/${a.key}`;
    return {
      id: a.id,
      key: a.key,
      publicUrl: makePublicUrl(env.R2_PUBLIC_BASE_URL, objectKey),
      filename_original: a.filename_original,
      mime: a.mime,
      size: a.size,
      width: a.width,
      height: a.height,
      folder_id: a.folder_id,
      tags: tagsArr,
      alt_text: a.alt_text,
      title: a.title,
      note: a.note,
      created_at: a.created_at
    };
  });

  return c.json({ ok: true, assets, page, pageSize, hasMore });
});

app.get("/api/folders", async (c) => {
  const env = getEnv(c.env as any);
  const rowRes = await env.DB.prepare(
    "SELECT id, name, created_at, updated_at FROM folders WHERE deleted_at IS NULL ORDER BY name ASC"
  ).all<any>();
  const rows = rowRes.results as any[];
  return c.json({ ok: true, folders: rows });
});

app.post("/api/folders", async (c) => {
  const env = getEnv(c.env as any);
  const schema = z.object({ name: z.string().min(1).max(80) });
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

  const name = sanitizeText(parsed.data.name, { maxLen: 80 });
  if (!name) return c.json({ error: "Invalid folder name" }, 400);

  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO folders (id, name, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)"
  )
    .bind(id, name, now, now)
    .run();

  return c.json({ ok: true, folder: { id, name, created_at: now, updated_at: now } });
});

app.patch("/api/folders/:id", async (c) => {
  const env = getEnv(c.env as any);
  const folderId = c.req.param("id");
  const schema = z.object({ name: z.string().min(1).max(80) });
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
  const name = sanitizeText(parsed.data.name, { maxLen: 80 });
  if (!name) return c.json({ error: "Invalid folder name" }, 400);

  const folder = await env.DB.prepare(
    "SELECT id FROM folders WHERE id = ? AND deleted_at IS NULL"
  )
    .bind(folderId)
    .first<{ id: string }>();
  if (!folder) return c.json({ error: "Unknown folder" }, 404);

  const now = Date.now();
  await env.DB.prepare("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?").bind(name, now, folderId).run();
  return c.json({ ok: true });
});

app.patch("/api/assets/:id", async (c) => {
  const env = getEnv(c.env as any);
  const assetId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const schema = z.object({ folderId: z.string().trim().nullable().optional() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

  const folderId = parsed.data.folderId ?? null;
  const now = Date.now();

  if (folderId) {
    const folder = await env.DB.prepare(
      "SELECT id FROM folders WHERE id = ? AND deleted_at IS NULL"
    )
      .bind(folderId)
      .first<{ id: string }>();
    if (!folder) return c.json({ error: "Unknown folder" }, 400);
  }

  await env.DB.prepare(
    "UPDATE assets SET folder_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
  )
    .bind(folderId, now, assetId)
    .run();

  return c.json({ ok: true });
});

app.delete("/api/assets/:id", async (c) => {
  const env = getEnv(c.env as any);
  const assetId = c.req.param("id");
  const url = new URL(c.req.url);
  const hard = url.searchParams.get("hard") === "1" || url.searchParams.get("hard") === "true";

  const asset = await env.DB.prepare(
    "SELECT id, key FROM assets WHERE id = ? AND deleted_at IS NULL"
  )
    .bind(assetId)
    .first<{ id: string; key: string }>();
  if (!asset) return c.json({ error: "Unknown asset" }, 404);

  const now = Date.now();

  if (!hard) {
    await env.DB.prepare("UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, assetId).run();
    return c.json({ ok: true, deleted: "soft" });
  }

  const objectKey = `i/${asset.key}`;
  await env.ASSETS_BUCKET.delete(objectKey);
  await env.DB.prepare("DELETE FROM assets WHERE id = ?").bind(assetId).run();
  return c.json({ ok: true, deleted: "hard" });
});

function BufferToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export default app;

