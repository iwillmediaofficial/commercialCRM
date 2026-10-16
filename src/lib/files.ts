import { useEffect, useState } from "react";
import { supabase, type Tables } from "./supabase";

// Talks to the `files` Edge Function, which holds the R2 keys. The browser never
// sees them; it only gets short-lived links.

export type FileRow = Tables<"files">;
export type EntityType = "work_item" | "client" | "lead" | "invoice" | "workspace" | "profile" | "renewal" | "lead_form";

export const MAX_FILE_MB = 20;

async function errorMessage(error: unknown, fallback: string) {
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.message) return String(body.message);
    } catch {
      /* fall through */
    }
  }
  return fallback;
}

export async function uploadFile(input: {
  workspaceId: string;
  entityType: EntityType;
  entityId?: string | null;
  file: File;
}): Promise<{ ok: true; file: FileRow } | { ok: false; message: string }> {
  if (input.file.size > MAX_FILE_MB * 1024 * 1024) return { ok: false, message: `Files can be up to ${MAX_FILE_MB} MB.` };
  const body = new FormData();
  body.append("workspace_id", input.workspaceId);
  body.append("entity_type", input.entityType);
  if (input.entityId) body.append("entity_id", input.entityId);
  body.append("file", input.file);
  const { data, error } = await supabase.functions.invoke("files", { body });
  if (data?.ok) return { ok: true, file: data.file as FileRow };
  return { ok: false, message: data?.message ?? (await errorMessage(error, "The upload didn't go through. Try again.")) };
}

// A short-lived (10 minute) link to open or show a file. Pass a file id or an R2 key.
export async function fileUrl(ref: { fileId?: string; key?: string }): Promise<string | null> {
  const { data } = await supabase.functions.invoke("files", {
    body: { action: "url", file_id: ref.fileId, key: ref.key },
  });
  return data?.ok ? (data.url as string) : null;
}

export async function deleteFile(fileId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.functions.invoke("files", { body: { action: "delete", file_id: fileId } });
  if (data?.ok) return { ok: true };
  return { ok: false, message: data?.message ?? (await errorMessage(error, "Couldn't delete the file.")) };
}

export async function openFile(fileId: string) {
  // Open the tab first so pop-up blockers allow it, then point it at the link.
  const tab = window.open("", "_blank");
  const url = await fileUrl({ fileId });
  if (url && tab) tab.location.href = url;
  else tab?.close();
  return !!url;
}

// Signed link for an image stored by key (logos, avatars, banners). Null while loading or if missing.
export function useFileUrl(key: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (key) fileUrl({ key }).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [key]);
  return url;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
