import React, { useEffect, useMemo, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { apiGetFolders, ApiFolder, ApiAsset } from "../api/client";
import { formatBytes, safeAltText } from "../utils/format";
import { copyToClipboard, htmlImgTag, markdownEmbed } from "../utils/copy";

type UploadItem = {
  id: string;
  fileName: string;
  size: number;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  asset?: ApiAsset;
};
type CompressionMode = "original" | "compress-webp";

const API_UPLOAD_PATH = "/api/assets";

function apiBase() {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return base?.replace(/\/+$/, "") ?? "";
}

async function readImageDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (blob.type === "image/svg+xml") return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to read image"));
      img.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function withNewExtension(filename: string, ext: string) {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) return `${filename}.${ext}`;
  return `${filename.slice(0, idx)}.${ext}`;
}

async function maybeCompressImage(input: File, opts: { mode: CompressionMode; preserveQuality: boolean }) {
  if (opts.mode === "original") return input;

  const maxWidthOrHeight = opts.preserveQuality ? 2800 : 1600;
  const quality = opts.preserveQuality ? 0.92 : 0.78;
  const isImageForCompression = input.type === "image/jpeg" || input.type === "image/png" || input.type === "image/webp";
  if (!isImageForCompression) return input;

  const targetFileType = opts.mode === "compress-webp" ? "image/webp" : input.type;

  const compressed = await imageCompression(input, {
    maxWidthOrHeight: maxWidthOrHeight,
    initialQuality: quality,
    useWebWorker: true,
    fileType: targetFileType as any
  });

  const outType = (compressed as any).type ?? targetFileType ?? input.type;
  const outName = outType === "image/webp" ? withNewExtension(input.name, "webp") : input.name;
  const out = new File([compressed], outName, { type: outType });
  return out;
}

export default function UploadPage() {
  const [folders, setFolders] = useState<ApiFolder[]>([]);
  const [folderId, setFolderId] = useState<string | "">("");
  const [tagsInput, setTagsInput] = useState("");
  const [altText, setAltText] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  const [compressionMode, setCompressionMode] = useState<CompressionMode>("compress-webp");
  const [preserveQuality, setPreserveQuality] = useState(true);

  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    apiGetFolders()
      .then((r) => setFolders(r.folders))
      .catch(() => setFolders([]));
  }, []);

  const canUpload = queuedFiles.length > 0;

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files);
    setQueuedFiles(next);
    setItems(
      next.map((f) => ({
        id: crypto.randomUUID(),
        fileName: f.name,
        size: f.size,
        progress: 0,
        status: "queued"
      }))
    );
  }

  async function uploadOne(file: File, meta: { folderId: string | null; tagsInput: string; altText: string; title: string; note: string; onProgress: (p: number) => void; itemId: string }) {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("folderId", meta.folderId ?? "");
    form.append("tags", meta.tagsInput ?? "");
    form.append("altText", meta.altText ?? "");
    form.append("title", meta.title ?? "");
    form.append("note", meta.note ?? "");
    // width/height computed after compression

    const dims = await readImageDimensions(file);
    if (dims) {
      form.append("width", String(dims.width));
      form.append("height", String(dims.height));
    }

    const xhr = new XMLHttpRequest();
    const uploadUrl = `${apiBase()}${API_UPLOAD_PATH}`;
    xhr.open("POST", uploadUrl);
    xhr.withCredentials = true;

    return new Promise<ApiAsset>((resolve, reject) => {
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const p = Math.round((ev.loaded / ev.total) * 100);
          meta.onProgress(p);
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          let msg = `Upload failed (${xhr.status})`;
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed?.error) msg = parsed.error;
          } catch {}
          reject(new Error(msg));
          return;
        }
        try {
          const parsed = JSON.parse(xhr.responseText);
          resolve(parsed.asset as ApiAsset);
        } catch {
          reject(new Error("Invalid server response"));
        }
      };

      xhr.send(form);
    });
  }

  async function handleUpload() {
    const currentFiles = queuedFiles;
    if (!currentFiles.length) return;

    const folder = folderId || null;
    const tagsStr = tagsInput;
    const metaBase = { folderId: folder, tagsInput: tagsStr, altText, title, note };

    // Concurrency-limited uploads for better UX.
    const concurrency = Math.min(3, currentFiles.length);
    let idx = 0;

    async function worker() {
      while (idx < currentFiles.length) {
        const myIndex = idx++;
        const file = currentFiles[myIndex];
        const itemId = items[myIndex]?.id;
        if (!itemId) continue;

        setItems((prev) =>
          prev.map((it) => (it.id === itemId ? { ...it, status: "uploading", progress: 0, error: undefined } : it))
        );

        try {
          const compressed = await maybeCompressImage(file, { mode: compressionMode, preserveQuality });
          const asset = await uploadOne(compressed, {
            ...metaBase,
            itemId,
            onProgress: (p) => setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, progress: p } : it)))
          });

          setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, status: "done", progress: 100, asset } : it)));
        } catch (e: any) {
          const msg = e?.message ? String(e.message) : "Upload failed";
          setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, status: "error", error: msg } : it)));
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  return (
    <div>
      <div className="card">
        <div className="card-inner">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Upload</div>
              <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                Drag, drop, upload, then copy links instantly.
              </div>
            </div>
            <div className="pill">Public URLs: no login</div>
          </div>

          <div style={{ height: 14 }} />

          <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 12 }}>
            <div>
              <div
                className="dropzone"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
                }}
              >
                <div style={{ fontWeight: 700 }}>Drop images here</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                  JPG, PNG, WEBP, GIF, SVG (safe). Max size enforced server-side.
                </div>
                <div style={{ marginTop: 12 }}>
                  <button className="btn btn-accent" type="button" onClick={() => fileInputRef.current?.click()}>
                    Select files
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => addFiles(e.target.files)}
                  />
                </div>
              </div>

              {items.length ? (
                <div className="filelist">
                  {items.map((it) => (
                    <div className="fileitem" key={it.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {it.fileName}
                          </div>
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                            {formatBytes(it.size)} • {it.status === "queued" ? "Ready" : it.status === "uploading" ? "Uploading…" : it.status === "done" ? "Uploaded" : "Error"}
                          </div>
                        </div>
                        <div style={{ width: 90, textAlign: "right" }} className="muted">
                          {it.status === "uploading" || it.status === "done" ? `${it.progress}%` : ""}
                        </div>
                      </div>
                      <div className="progressbar" aria-label="Upload progress">
                        <div style={{ width: `${it.progress}%` }} />
                      </div>
                      {it.status === "error" ? (
                        <div style={{ marginTop: 8, color: "var(--danger)", fontSize: 13 }}>{it.error}</div>
                      ) : null}

                      {it.asset ? (
                        <div style={{ marginTop: 12 }}>
                          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                            Public URL
                          </div>
                          <div style={{ wordBreak: "break-all", fontSize: 13, marginBottom: 10 }}>{it.asset.publicUrl}</div>
                          <div className="row">
                            <button className="btn" type="button" onClick={async () => copyToClipboard(it.asset!.publicUrl)}>
                              Copy link
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={async () => copyToClipboard(markdownEmbed(it.asset!.publicUrl, it.asset!.alt_text ?? it.asset!.title ?? it.asset!.filename_original))}
                            >
                              Copy Markdown
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={async () => copyToClipboard(htmlImgTag(it.asset!.publicUrl, safeAltText(it.asset!.alt_text ?? it.asset!.title ?? it.asset!.filename_original)))}
                            >
                              Copy HTML
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div>
              <div className="field">
                <label>Folder (optional)</label>
                <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                  <option value="">No folder</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Tags (optional)</label>
                <input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="e.g. wedding, portrait, 2026"
                />
              </div>

              <div className="field">
                <label>Alt text (optional)</label>
                <input value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="Short description for accessibility" />
              </div>

              <div className="field">
                <label>Title (optional)</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional display title" />
              </div>

              <div className="field">
                <label>Note (optional)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note (kept in metadata)" />
              </div>

              <div className="hr" />

              <div className="field">
                <label>Upload mode</label>
                <select value={compressionMode} onChange={(e) => setCompressionMode(e.target.value as CompressionMode)}>
                  <option value="original">Keep original file</option>
                  <option value="compress-webp">Compress + convert to WebP</option>
                </select>
              </div>

              <div className="field" style={{ marginTop: -6 }}>
                <label>Preserve quality (higher quality)</label>
                <select
                  value={preserveQuality ? "yes" : "no"}
                  onChange={(e) => setPreserveQuality(e.target.value === "yes")}
                  disabled={compressionMode === "original"}
                >
                  <option value="yes">Yes</option>
                  <option value="no">More compression</option>
                </select>
              </div>

              <div style={{ height: 10 }} />

              <button
                className="btn btn-accent"
                type="button"
                disabled={!canUpload}
                onClick={() => void handleUpload()}
                style={{ width: "100%", textAlign: "center" }}
              >
                Upload {queuedFiles.length ? `(${queuedFiles.length})` : ""}
              </button>

              <div style={{ marginTop: 10 }} className="muted">
                After upload, public URLs are immutable and available globally.
              </div>

              <div style={{ height: 14 }} />

              <button
                className="btn btn-danger"
                type="button"
                onClick={() => {
                  setQueuedFiles([]);
                  setItems([]);
                  setTagsInput("");
                  setAltText("");
                  setTitle("");
                  setNote("");
                }}
                style={{ width: "100%" }}
              >
                Clear
              </button>

              <div style={{ marginTop: 10 }} className="muted">
                <span style={{ opacity: 0.85 }}>Tip:</span> keep alt/title concise for best embed UX.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

