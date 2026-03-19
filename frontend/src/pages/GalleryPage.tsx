import React, { useEffect, useMemo, useState } from "react";
import { ApiAsset, apiDeleteAsset, apiPatchAsset, apiSearch, apiGetFolders, ApiFolder } from "../api/client";
import { copyToClipboard, htmlImgTag, markdownEmbed } from "../utils/copy";
import { formatBytes, safeAltText } from "../utils/format";

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export default function GalleryPage() {
  const [folders, setFolders] = useState<ApiFolder[]>([]);
  const [qDraft, setQDraft] = useState("");
  const q = useDebouncedValue(qDraft, 350);
  const [tagDraft, setTagDraft] = useState("");
  const tag = useDebouncedValue(tagDraft, 350);

  const [folderId, setFolderId] = useState<string | "">("");
  const [sort, setSort] = useState<"newest" | "oldest" | "size" | "name">("newest");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(24);
  const [assets, setAssets] = useState<ApiAsset[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ApiAsset | null>(null);

  useEffect(() => {
    apiGetFolders()
      .then((r) => setFolders(r.folders))
      .catch(() => setFolders([]));
  }, []);

  async function loadPage(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await apiSearch({
        q: q.trim() || undefined,
        tag: tag.trim() || undefined,
        folderId: folderId || undefined,
        sort,
        page: reset ? 1 : page,
        pageSize
      });
      if (reset) setAssets(res.assets);
      else setAssets((prev) => [...prev, ...res.assets]);
      setHasMore(res.hasMore);
    } catch (e: any) {
      setError(e?.body?.error ? String(e.body.error) : "Failed to load gallery");
    } finally {
      setLoading(false);
    }
  }

  // Reload when filters change.
  useEffect(() => {
    setPage(1);
    void loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tag, folderId, sort]);

  function requestMore() {
    const next = page + 1;
    setPage(next);
    void (async () => {
      setLoading(true);
      try {
        const res = await apiSearch({
          q: q.trim() || undefined,
          tag: tag.trim() || undefined,
          folderId: folderId || undefined,
          sort,
          page: next,
          pageSize
        });
        setAssets((prev) => [...prev, ...res.assets]);
        setHasMore(res.hasMore);
      } catch (e: any) {
        setError(e?.body?.error ? String(e.body.error) : "Failed to load more");
      } finally {
        setLoading(false);
      }
    })();
  }

  return (
    <div>
      <div className="card">
        <div className="card-inner">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Gallery</div>
              <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                Search by filename, folder, and tags.
              </div>
            </div>
            <div className="pill">Public: embed-ready</div>
          </div>

          <div style={{ height: 12 }} />

          <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Search filename</label>
              <input value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="e.g. wedding, img_2026" />
            </div>
            <div className="field">
              <label>Tag</label>
              <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="e.g. portrait" />
            </div>

            <div className="field">
              <label>Folder</label>
              <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                <option value="">All folders</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Sort</label>
              <select value={sort} onChange={(e) => setSort(e.target.value as any)}>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="size">Size</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>

          {error ? <div style={{ marginTop: 12, color: "var(--danger)" }}>{error}</div> : null}

          <div style={{ height: 12 }} />

          <div className="gallery">
            {assets.map((a) => (
              <div key={a.id} className="thumb" onClick={() => setSelected(a)} role="button" tabIndex={0}>
                <img src={a.publicUrl} alt={safeAltText(a.alt_text ?? a.title ?? a.filename_original)} loading="lazy" />
                <div className="thumbmeta">
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.filename_original}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {formatBytes(a.size)} • {a.tags.slice(0, 2).join(", ")}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyToClipboard(a.publicUrl);
                      }}
                      style={{ padding: "8px 10px" }}
                    >
                      Copy link
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {assets.length === 0 && !loading ? (
            <div className="muted" style={{ marginTop: 18 }}>
              No assets found.
            </div>
          ) : null}

          <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
            {hasMore ? (
              <button className="btn btn-accent" type="button" disabled={loading} onClick={requestMore}>
                {loading ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)}>
        {selected ? (
          <div className="modal-inner">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{selected.title || selected.filename_original}</div>
                <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                  {selected.mime} • {formatBytes(selected.size)}
                </div>
              </div>
              <button className="btn" type="button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>

            <div style={{ height: 14 }} />

            <img className="img-preview" src={selected.publicUrl} alt={safeAltText(selected.alt_text ?? selected.title ?? selected.filename_original)} />

            <div style={{ height: 14 }} />
            <div className="field">
              <label>Public URL</label>
              <div style={{ wordBreak: "break-all", fontSize: 13, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "rgba(255,255,255,0.05)" }}>
                {selected.publicUrl}
              </div>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" type="button" onClick={() => void copyToClipboard(selected.publicUrl)}>
                Copy link
              </button>
              <button
                className="btn"
                type="button"
                onClick={() =>
                  void copyToClipboard(markdownEmbed(selected.publicUrl, safeAltText(selected.alt_text ?? selected.title ?? selected.filename_original)))
                }
              >
                Copy Markdown
              </button>
              <button
                className="btn"
                type="button"
                onClick={() =>
                  void copyToClipboard(htmlImgTag(selected.publicUrl, safeAltText(selected.alt_text ?? selected.title ?? selected.filename_original)))
                }
              >
                Copy HTML
              </button>
            </div>

            <div className="hr" />

            <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div className="field">
                  <label>Move to folder</label>
                  <select
                    value={selected.folder_id ?? ""}
                    onChange={(e) => {
                      const folderId = e.target.value || null;
                      void (async () => {
                        await apiPatchAsset(selected.id, { folderId });
                        setSelected((prev) => (prev ? { ...prev, folder_id: folderId } : prev));
                        setAssets([]);
                        setPage(1);
                        await loadPage(true);
                      })();
                    }}
                  >
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <div className="field">
                  <label>Tags</label>
                  <div style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "rgba(255,255,255,0.05)" }}>
                    {selected.tags.length ? selected.tags.join(", ") : "—"}
                  </div>
                </div>
              </div>
            </div>

            {selected.alt_text || selected.note ? (
              <div style={{ marginTop: 10 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  Metadata
                </div>
                <div className="card" style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, boxShadow: "none" }}>
                  <div className="card-inner" style={{ padding: 12 }}>
                    {selected.alt_text ? (
                      <div style={{ marginBottom: 6 }}>
                        <span className="muted" style={{ fontSize: 12 }}>
                          Alt:
                        </span>{" "}
                        <span style={{ fontSize: 13 }}>{selected.alt_text}</span>
                      </div>
                    ) : null}
                    {selected.note ? (
                      <div>
                        <span className="muted" style={{ fontSize: 12 }}>
                          Note:
                        </span>{" "}
                        <span style={{ fontSize: 13 }}>{selected.note}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button
                className="btn btn-danger"
                type="button"
                onClick={async () => {
                  if (!confirm("Soft delete this image? It will be hidden from the gallery.")) return;
                  await apiDeleteAsset(selected.id, false);
                  setSelected(null);
                  setAssets([]);
                  setPage(1);
                  await loadPage(true);
                }}
              >
                Soft delete
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={async () => {
                  if (!confirm("Hard delete? This removes it from R2 permanently.")) return;
                  await apiDeleteAsset(selected.id, true);
                  setSelected(null);
                  setAssets([]);
                  setPage(1);
                  await loadPage(true);
                }}
                style={{ borderColor: "rgba(255,106,106,0.75)" }}
              >
                Hard delete
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

