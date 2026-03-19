import React, { useEffect, useState } from "react";
import { ApiFolder, apiCreateFolder, apiGetFolders, apiRenameFolder } from "../api/client";

export default function FoldersPage() {
  const [folders, setFolders] = useState<ApiFolder[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGetFolders()
      .then((r) => setFolders(r.folders))
      .catch(() => setFolders([]));
  }, []);

  async function refresh() {
    const r = await apiGetFolders();
    setFolders(r.folders);
  }

  return (
    <div className="card">
      <div className="card-inner">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Folders</div>
            <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
              Create and rename folders. Move assets from the Gallery.
            </div>
          </div>
          <div className="pill">Manage metadata</div>
        </div>

        <div style={{ height: 12 }} />

        <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <label>Create folder</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Laos 2026" />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
            <button
              className="btn btn-accent"
              type="button"
              disabled={busy || !newName.trim()}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await apiCreateFolder(newName.trim());
                  setNewName("");
                  await refresh();
                } catch (e: any) {
                  setError(e?.body?.error ? String(e.body.error) : "Failed to create folder");
                } finally {
                  setBusy(false);
                }
              }}
              style={{ width: "100%" }}
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>

        {error ? <div style={{ marginTop: 12, color: "var(--danger)" }}>{error}</div> : null}

        <div className="hr" />

        <div className="filelist">
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              onRenamed={async (name) => {
                await apiRenameFolder(f.id, name);
                await refresh();
              }}
            />
          ))}
          {!folders.length && !busy ? <div className="muted">No folders yet.</div> : null}
        </div>
      </div>
    </div>
  );
}

function FolderRow({ folder, onRenamed }: { folder: ApiFolder; onRenamed: (name: string) => Promise<void> }) {
  const [name, setName] = useState(folder.name);
  const [saving, setSaving] = useState(false);

  return (
    <div className="fileitem">
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="btn"
          type="button"
          disabled={saving || !name.trim() || name.trim() === folder.name.trim()}
          onClick={async () => {
            setSaving(true);
            try {
              await onRenamed(name.trim());
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Rename"}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        ID: {folder.id}
      </div>
    </div>
  );
}

