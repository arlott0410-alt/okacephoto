export async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

export function escapeHtmlAttr(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function markdownEmbed(url: string, alt: string) {
  const safeAlt = alt.replace(/\]/g, "\\]");
  return `![${safeAlt}](${url})`;
}

export function htmlImgTag(url: string, alt: string) {
  return `<img src="${url}" alt="${escapeHtmlAttr(alt)}" />`;
}

