export type ApiAsset = {
  id: string;
  key: string;
  publicUrl: string;
  filename_original: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  folder_id: string | null;
  tags: string[];
  alt_text: string | null;
  title: string | null;
  note: string | null;
  created_at: number;
};

export type ApiFolder = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;

function fullUrl(path: string) {
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, message: string, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetchJson<T>(
  path: string,
  init?: RequestInit & { json?: any }
): Promise<T> {
  const res = await fetch(fullUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers ?? {})
    },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body
  });

  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const message = (body && body.error) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

export async function apiLogin(password: string) {
  return apiFetchJson<{ ok: true } | { error: string }>("/api/auth/login", {
    method: "POST",
    json: { password }
  });
}

export async function apiLogout() {
  return apiFetchJson<{ ok: true } | { error: string }>("/api/auth/logout", { method: "POST" });
}

export async function apiMe() {
  return apiFetchJson<{ loggedIn: boolean; adminLabel?: string }>("/api/auth/me", { method: "GET" });
}

export async function apiGetFolders() {
  return apiFetchJson<{ ok: true; folders: ApiFolder[] }>("/api/folders", { method: "GET" });
}

export async function apiCreateFolder(name: string) {
  return apiFetchJson<{ ok: true; folder: ApiFolder }>("/api/folders", {
    method: "POST",
    json: { name }
  });
}

export async function apiRenameFolder(folderId: string, name: string) {
  return apiFetchJson<{ ok: true }>(`/api/folders/${folderId}`, {
    method: "PATCH",
    json: { name }
  });
}

export async function apiSearch(params: {
  q?: string;
  tag?: string;
  folderId?: string;
  sort?: "newest" | "oldest" | "size" | "name";
  page?: number;
  pageSize?: number;
}) {
  const url = new URL(fullUrl("/api/search"));
  if (params.q) url.searchParams.set("q", params.q);
  if (params.tag) url.searchParams.set("tag", params.tag);
  if (params.folderId) url.searchParams.set("folderId", params.folderId);
  if (params.sort) url.searchParams.set("sort", params.sort);
  url.searchParams.set("page", String(params.page ?? 1));
  url.searchParams.set("pageSize", String(params.pageSize ?? 24));
  return apiFetchJson<{ ok: true; assets: ApiAsset[]; page: number; pageSize: number; hasMore: boolean }>(
    url.pathname + url.search,
    { method: "GET" }
  );
}

export async function apiPatchAsset(assetId: string, patch: { folderId: string | null }) {
  return apiFetchJson<{ ok: true } | { error: string }>(`/api/assets/${assetId}`, {
    method: "PATCH",
    json: patch
  });
}

export async function apiDeleteAsset(assetId: string, hard: boolean) {
  const url = `/api/assets/${assetId}?hard=${hard ? "1" : "0"}`;
  return apiFetchJson<{ ok: true } | { error: string }>(url, { method: "DELETE" });
}

