export type DetectedMime =
  | { ok: true; mime: "image/jpeg"; ext: "jpg" }
  | { ok: true; mime: "image/png"; ext: "png" }
  | { ok: true; mime: "image/webp"; ext: "webp" }
  | { ok: true; mime: "image/gif"; ext: "gif" }
  | { ok: true; mime: "image/svg+xml"; ext: "svg" }
  | { ok: true; mime: "image/avif"; ext: "avif" }
  | { ok: false; reason: string };

function bytesStartsWith(bytes: Uint8Array, prefix: number[]) {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

export function detectMimeFromMagicBytes(bytes: Uint8Array): DetectedMime {
  // JPEG: FF D8 FF
  if (bytesStartsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { ok: true, mime: "image/jpeg", ext: "jpg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytesStartsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return { ok: true, mime: "image/png", ext: "png" };
  }

  // WEBP: RIFF .... WEBP
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (riff === "RIFF" && webp === "WEBP") {
      return { ok: true, mime: "image/webp", ext: "webp" };
    }
  }

  // GIF: "GIF87a" or "GIF89a"
  if (bytes.length >= 6) {
    const sig = String.fromCharCode(...bytes.slice(0, 6));
    if (sig === "GIF87a" || sig === "GIF89a") {
      return { ok: true, mime: "image/gif", ext: "gif" };
    }
  }

  // AVIF: ISO BMFF box: contains 'ftyp' + 'avif' or 'avis'
  if (bytes.length >= 16) {
    // 'ftyp' at offset 4..7 typically.
    const ftyp = String.fromCharCode(...bytes.slice(4, 8));
    if (ftyp === "ftyp") {
      const brand = String.fromCharCode(...bytes.slice(8, 12));
      if (brand === "avif" || brand === "avis") {
        return { ok: true, mime: "image/avif", ext: "avif" };
      }
    }
  }

  // SVG: starts with <svg after optional BOM / whitespace
  // (SVG content is textual and can be validated more carefully than magic bytes.)
  if (bytes.length <= 1024 * 512) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // Allow leading BOM/whitespace.
    const trimmed = text.replace(/^\uFEFF?/, "").trimStart();
    if (/^<svg\b/i.test(trimmed)) {
      // Basic safety checks. This is not a full sanitizer; it prevents obvious active content.
      // (We intentionally reject inline scripts and JS URLs to reduce XSS risk.)
      if (/<\s*script\b/i.test(trimmed)) return { ok: false, reason: "unsafe_svg_script" };
      if (/\son\w+\s*=\s*["']/i.test(trimmed)) return { ok: false, reason: "unsafe_svg_event_handlers" };
      if (/javascript\s*:/i.test(trimmed)) return { ok: false, reason: "unsafe_svg_javascript_uri" };
      return { ok: true, mime: "image/svg+xml", ext: "svg" };
    }
  }

  return { ok: false, reason: "unknown_or_unsupported_file_type" };
}

export function normalizeAllowedMimeList(allowedMimeCsv: string) {
  const parts = allowedMimeCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

export function assertMimeIsAllowed(detected: DetectedMime, allowedMimeCsv: string) {
  if (!detected.ok) return detected;
  const allowed = normalizeAllowedMimeList(allowedMimeCsv);
  if (!allowed.includes(detected.mime)) {
    return { ok: false as const, reason: "mime_not_allowed" };
  }
  return detected;
}

