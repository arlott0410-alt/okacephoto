export function makePublicUrl(baseUrl: string, objectKey: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const key = objectKey.replace(/^\/+/, "");
  return `${base}/${key}`;
}

