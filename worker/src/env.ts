export type Env = {
  // Bindings
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;

  // Non-secret vars
  COOKIE_NAME: string;
  COOKIE_DOMAIN: string;
  CORS_ALLOW_ORIGIN: string;
  R2_PUBLIC_BASE_URL: string;
  MAX_FILE_SIZE_BYTES: string;
  ALLOWED_MIME: string;

  LOGIN_RATE_MAX_ATTEMPTS: string;
  LOGIN_RATE_WINDOW_SECONDS: string;
  LOGIN_RATE_BLOCK_SECONDS: string;

  // Secrets
  AUTH_SHARED_PASSWORD: string;
  COOKIE_SIGNING_SECRET: string;
};

export function getEnv(env: Record<string, unknown>): Env {
  // Cloudflare Workers inject bindings + env vars into `env` as a plain object.
  const required = [
    "DB",
    "ASSETS_BUCKET",
    "COOKIE_NAME",
    "COOKIE_DOMAIN",
    "CORS_ALLOW_ORIGIN",
    "R2_PUBLIC_BASE_URL",
    "MAX_FILE_SIZE_BYTES",
    "ALLOWED_MIME",
    "LOGIN_RATE_MAX_ATTEMPTS",
    "LOGIN_RATE_WINDOW_SECONDS",
    "LOGIN_RATE_BLOCK_SECONDS",
    "AUTH_SHARED_PASSWORD",
    "COOKIE_SIGNING_SECRET"
  ] as const;

  for (const k of required) {
    if (env[k] === undefined || env[k] === null) {
      throw new Error(`Missing required env var: ${k}`);
    }
  }

  return env as unknown as Env;
}

