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
  maxSize?: number;
}): Promise<{ ok: true; file: FileRow } | { ok: false; message: string }> {
  const file = await shrinkImage(input.file, input.maxSize ?? 1600);
  if (file.size > MAX_FILE_MB * 1024 * 1024) return { ok: false, message: `Files can be up to ${MAX_FILE_MB} MB.` };
  const body = new FormData();
  body.append("workspace_id", input.workspaceId);
  body.append("entity_type", input.entityType);
  if (input.entityId) body.append("entity_id", input.entityId);
  body.append("file", file);
  const { data, error } = await supabase.functions.invoke("files", { body });
  if (data?.ok) return { ok: true, file: data.file as FileRow };
  return { ok: false, message: data?.message ?? (await errorMessage(error, "The upload didn't go through. Try again.")) };
}

// Photos are scaled so the longest side is at most maxSize and saved as WebP.
// GIFs (may be animated), HEIC and anything that isn't smaller stay as they are.
const SHRINKABLE = ["image/jpeg", "image/png", "image/webp"];

export async function shrinkImage(file: File, maxSize: number): Promise<File> {
  if (!SHRINKABLE.includes(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    let blob: Blob | null;
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
      blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    }
    bitmap.close();
    // Browsers that can't write WebP fall back to PNG; keep the original then.
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^./]+$/, "") + ".webp";
    return new File([blob], name, { type: "image/webp", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

// Signed links last 10 minutes. Reuse them for 8 so a page full of images
// doesn't call the Edge Function again on every render or reload.
const LINK_TTL_MS = 8 * 60 * 1000;
const LINK_STORE = "file-links";
type CachedLink = { url: string; at: number };
const links = new Map<string, CachedLink>(readStoredLinks());
const pending = new Map<string, Promise<string | null>>();

function readStoredLinks(): [string, CachedLink][] {
  try {
    const raw = sessionStorage.getItem(LINK_STORE);
    const now = Date.now();
    return raw ? (Object.entries(JSON.parse(raw)) as [string, CachedLink][]).filter(([, l]) => now - l.at < LINK_TTL_MS) : [];
  } catch {
    return [];
  }
}

function storeLinks() {
  try {
    const now = Date.now();
    const fresh = Object.fromEntries([...links].filter(([, l]) => now - l.at < LINK_TTL_MS));
    sessionStorage.setItem(LINK_STORE, JSON.stringify(fresh));
  } catch {
    /* storage full or blocked */
  }
}

function linkKey(ref: { fileId?: string; key?: string }) {
  return ref.fileId ? `id:${ref.fileId}` : ref.key ? `key:${ref.key}` : null;
}

function cachedLink(ref: { fileId?: string; key?: string }) {
  const hit = links.get(linkKey(ref) ?? "");
  return hit && Date.now() - hit.at < LINK_TTL_MS ? hit.url : null;
}

function forgetLink(cacheKey: string) {
  if (links.delete(cacheKey)) storeLinks();
}

// A short-lived link to open or show a file. Pass a file id or an R2 key.
export async function fileUrl(ref: { fileId?: string; key?: string }): Promise<string | null> {
  const cacheKey = linkKey(ref);
  if (!cacheKey) return null;
  const hit = cachedLink(ref);
  if (hit) return hit;
  const inFlight = pending.get(cacheKey);
  if (inFlight) return inFlight;
  const at = Date.now();
  const request = supabase.functions
    .invoke("files", { body: { action: "url", file_id: ref.fileId, key: ref.key } })
    .then(({ data }) => {
      const url = data?.ok ? (data.url as string) : null;
      if (url) {
        links.set(cacheKey, { url, at });
        storeLinks();
      }
      return url;
    })
    .finally(() => pending.delete(cacheKey));
  pending.set(cacheKey, request);
  return request;
}

export async function deleteFile(fileId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.functions.invoke("files", { body: { action: "delete", file_id: fileId } });
  if (data?.ok) {
    forgetLink(`id:${fileId}`);
    return { ok: true };
  }
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
  const [url, setUrl] = useState<string | null>(() => (key ? cachedLink({ key }) : null));
  useEffect(() => {
    let cancelled = false;
    setUrl(key ? cachedLink({ key }) : null);
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
