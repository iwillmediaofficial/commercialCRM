import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { MAX_FILE_MB, deleteFile, fileUrl, formatBytes, openFile, uploadFile, useFileUrl, type EntityType, type FileRow } from "../lib/files";
import { useWorkspace } from "../lib/workspace";
import { Alert, Button } from "./ui";

const ACCEPT = "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,video/*,audio/*";

// Files attached to one record (a work item, client, lead, invoice...), with
// upload, image thumbnails, open and delete.
export function Attachments({
  workspaceId,
  entityType,
  entityId,
  canUpload,
  canDelete,
  title = "Files",
}: {
  workspaceId: string;
  entityType: EntityType;
  entityId: string;
  canUpload: boolean;
  canDelete: (f: FileRow) => boolean;
  title?: string;
}) {
  const { workspace } = useWorkspace();
  const uploadsOn = !!workspace.attachments_enabled;
  const showUpload = canUpload && uploadsOn;
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("files")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    setFiles(data ?? []);
  }, [workspaceId, entityType, entityId]);
  useEffect(() => {
    load();
  }, [load]);

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError("");
    for (const file of Array.from(list)) {
      const r = await uploadFile({ workspaceId, entityType, entityId, file });
      if (!r.ok) setError(`${file.name}: ${r.message}`);
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    load();
  }

  async function remove(f: FileRow) {
    if (!window.confirm(`Delete ${f.file_name}?`)) return;
    const r = await deleteFile(f.id);
    if (!r.ok) setError(r.message);
    load();
  }

  // With uploads off, the section only appears for files added before.
  if (!uploadsOn && !files?.length) return null;
  const list = files ?? [];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}{list.length > 0 && ` (${list.length})`}</h3>
        {showUpload && (
          <>
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => add(e.target.files)} />
            <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </>
        )}
      </div>
      {error && <div className="mb-2"><Alert>{error}</Alert></div>}
      {!uploadsOn && <p className="mb-2 text-xs text-slate-500">Uploads are turned off for this company.</p>}
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">{showUpload ? `No files yet. Up to ${MAX_FILE_MB} MB each.` : "No files."}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {list.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-md p-2 ring-1 ring-slate-200">
              <Thumb file={f} />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openFile(f.id)}>
                <div className="truncate text-sm text-indigo-700 hover:underline">{f.file_name}</div>
                <div className="text-xs text-slate-500">{formatBytes(f.size_bytes)} · {new Date(f.created_at).toLocaleDateString()}</div>
              </button>
              {canDelete(f) && (
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => remove(f)}>Delete</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Thumb({ file }: { file: FileRow }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = file.mime_type?.startsWith("image/");
  useEffect(() => {
    if (isImage) fileUrl({ fileId: file.id }).then(setUrl);
  }, [file.id, isImage]);
  if (isImage && url) return <img src={url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />;
  const ext = file.file_name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "FILE";
  return <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-500">{ext}</div>;
}

// Shows an image stored by R2 key (a logo, avatar or banner).
export function StoredImage({ storageKey, className, alt = "" }: { storageKey: string | null | undefined; className?: string; alt?: string }) {
  const url = useFileUrl(storageKey);
  return url ? <img src={url} alt={alt} className={className} /> : null;
}

// Pick an image, upload it, and hand back its R2 key so the caller saves it
// into a column such as workspace_settings.logo_path.
export function ImagePicker({
  workspaceId,
  entityType,
  entityId,
  value,
  onChange,
  disabled,
  label = "Logo",
  shape = "square",
  maxSize = shape === "wide" ? 1600 : 512,
}: {
  workspaceId: string;
  entityType: EntityType;
  entityId?: string | null;
  value: string | null | undefined;
  onChange: (key: string | null) => void | Promise<void>;
  disabled?: boolean;
  label?: string;
  shape?: "square" | "round" | "wide";
  maxSize?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = shape === "wide" ? "h-20 w-48" : "h-20 w-20";
  const round = shape === "round" ? "rounded-full" : "rounded-md";

  async function pick(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose an image (PNG, JPG or WebP).");
    setBusy(true);
    setError("");
    const r = await uploadFile({ workspaceId, entityType, entityId, file, maxSize });
    setBusy(false);
    if (input.current) input.current.value = "";
    if (!r.ok) return setError(r.message);
    await onChange(r.file.r2_key);
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <div className="flex items-center gap-3">
        <div className={`${box} ${round} flex shrink-0 items-center justify-center overflow-hidden bg-slate-100 ring-1 ring-slate-200`}>
          {value ? <StoredImage storageKey={value} className="h-full w-full object-cover" /> : <span className="text-xs text-slate-400">None</span>}
        </div>
        {!disabled && (
          <div className="flex flex-col items-start gap-1">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => pick(e.target.files)} />
            <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? "Uploading…" : value ? "Change" : "Upload"}
            </Button>
            {value && (
              <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onChange(null)}>Remove</button>
            )}
          </div>
        )}
      </div>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </div>
  );
}
