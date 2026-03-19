function normalizeWhitespace(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export function sanitizeText(input: unknown, { maxLen }: { maxLen: number }) {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") return null;
  const s = normalizeWhitespace(input);
  // Remove control characters to avoid header/body weirdness and basic injection.
  const cleaned = s.replace(/[\u0000-\u001F\u007F]/g, "");
  if (!cleaned) return null;
  if (cleaned.length > maxLen) return cleaned.slice(0, maxLen);
  return cleaned;
}

export function escapeHtmlAttr(value: string) {
  // Minimal escape for HTML attribute context.
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function splitTags(input: unknown) {
  if (input === undefined || input === null) return [];
  if (typeof input !== "string") return [];
  // Accept comma-separated or whitespace-separated.
  const raw = input
    .split(/[,\n\r\t ]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
  // Normalize: lowercase, remove dangerous characters, limit length.
  const normalized = raw
    .map((t) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "")
        .slice(0, 40)
    )
    .filter((t) => t.length >= 1);
  return Array.from(new Set(normalized));
}

