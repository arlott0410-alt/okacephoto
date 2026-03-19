import { Env } from "./env";

type SessionPayload = {
  sub: "admin";
  iat: number;
  exp: number;
};

// Signed (tamper-evident) HttpOnly cookie session.
// No server-side session storage is required, keeping the system low-maintenance.

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (let i = 0; i < u8.length; i++) str += String.fromCharCode(u8[i]);
  const b64 = btoa(str);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let ok = 0;
  for (let i = 0; i < a.length; i++) ok |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ok === 0;
}

async function hmacSha256Base64Url(message: string, secret: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return base64UrlEncode(sig);
}

function parseCookies(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return new Map<string, string>();
  const out = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out.set(key, decodeURIComponent(val));
  }
  return out;
}

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function issueSessionCookie(env: Env, ttlSeconds?: number) {
  const resolvedTtlSeconds = ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: "admin",
    iat: now,
    exp: now + resolvedTtlSeconds
  };

  const tokenPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSha256Base64Url(tokenPayload, env.COOKIE_SIGNING_SECRET);
  const cookieValue = `${tokenPayload}.${sig}`;

  const domain = env.COOKIE_DOMAIN;
  return [
    `${env.COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
    `Path=/`,
    domain ? `Domain=${domain}` : null,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Max-Age=${resolvedTtlSeconds}`
  ]
    .filter(Boolean)
    .join("; ");
}

export async function logoutCookie(env: Env) {
  const domain = env.COOKIE_DOMAIN;
  return [
    `${env.COOKIE_NAME}=`,
    `Path=/`,
    domain ? `Domain=${domain}` : null,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Max-Age=0`,
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  ]
    .filter(Boolean)
    .join("; ");
}

export async function verifySession(env: Env, cookieHeader: string | null) {
  const cookies = parseCookies(cookieHeader);
  const raw = cookies.get(env.COOKIE_NAME);
  if (!raw) return { ok: false as const, reason: "no_cookie" };

  const parts = raw.split(".");
  if (parts.length !== 2) return { ok: false as const, reason: "bad_format" };
  const [tokenPart, sigPart] = parts;

  const expectedSig = await hmacSha256Base64Url(tokenPart, env.COOKIE_SIGNING_SECRET);
  if (!timingSafeEqual(sigPart, expectedSig)) return { ok: false as const, reason: "bad_sig" };

  let payload: SessionPayload;
  try {
    const jsonBytes = base64UrlDecode(tokenPart);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    payload = JSON.parse(jsonStr) as SessionPayload;
  } catch {
    return { ok: false as const, reason: "bad_payload" };
  }

  if (payload.sub !== "admin") return { ok: false as const, reason: "bad_sub" };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return { ok: false as const, reason: "expired" };

  return { ok: true as const, payload };
}

export const requireAuth = async (c: any, next: any) => {
  const env = c.env as Env;
  const auth = await verifySession(env, c.req.header("Cookie"));
  if (!auth.ok) return c.json({ error: "Unauthorized" }, 401);
  return next();
};

// Rate limiting for login attempts using D1.
export async function checkAndBumpLoginRateLimit(env: Env, ip: string) {
  const maxAttempts = Number(env.LOGIN_RATE_MAX_ATTEMPTS);
  const windowSeconds = Number(env.LOGIN_RATE_WINDOW_SECONDS);
  const blockSeconds = Number(env.LOGIN_RATE_BLOCK_SECONDS);

  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const windowStart = now - windowSeconds;

  // Single-row approach: ip is PRIMARY KEY.
  // If blocked_until is in the future => block.
  const existing = await env.DB.prepare(
    "SELECT ip, attempts, window_start, blocked_until FROM login_attempts WHERE ip = ?"
  )
    .bind(ip)
    .first<{ ip: string; attempts: number; window_start: number; blocked_until: number | null }>();

  if (existing?.blocked_until && existing.blocked_until > now) {
    return { ok: false as const, retryAfterSeconds: existing.blocked_until - now };
  }

  let attempts = existing?.attempts ?? 0;
  let window_start = existing?.window_start ?? 0;
  if (!existing || window_start < windowStart) {
    attempts = 0;
    window_start = windowStart;
  }

  attempts += 1;
  let blocked_until: number | null = null;
  if (attempts >= maxAttempts) {
    blocked_until = now + blockSeconds;
  }

  await env.DB.prepare(
    "INSERT INTO login_attempts (ip, attempts, window_start, blocked_until) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(ip) DO UPDATE SET attempts = excluded.attempts, window_start = excluded.window_start, blocked_until = excluded.blocked_until"
  )
    .bind(ip, attempts, window_start, blocked_until)
    .run();

  if (blocked_until && blocked_until > now) {
    return { ok: false as const, retryAfterSeconds: blockSeconds };
  }

  return { ok: true as const };
}

