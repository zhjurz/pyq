import { getApiUrl } from "./api-fetch";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";
const BASE_URL = API_URL.replace(/\/api$/, "");

export type DirectUploadKind = "image" | "video" | "audio" | "file";

export interface DirectUploadOptions {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

export interface UploadedMedia {
  id: string;
  filename: string;
  url: string;
  storageType: "r2";
  mimeType: string;
  size: number;
  category: "image" | "video" | "audio" | "file";
}

export function toAbsoluteUrl(url: string) {
  if (!url || typeof url !== "string") return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("/uploads/") || url.startsWith("/api/")) return `${BASE_URL}${url}`;
  return url;
}

/** Upgrade http:// to https:// to avoid Mixed Content warnings on HTTPS pages */
export function toHttps(url: string): string {
  if (!url || typeof url !== "string") return url;
  if (url.startsWith("http://")) return "https://" + url.slice(7);
  return url;
}

function normalizedMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp", m4v: "video/x-m4v",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac",
  };
  return byExtension?.[extension || ""] || "application/octet-stream";
}

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return data?.message || fallback;
}

/**
 * Requests a backend-authorized upload intent, sends file bytes directly to R2,
 * then confirms the server-validated object. The JWT is never sent to R2.
 */
export async function uploadDirect(
  file: File,
  token: string,
  kind: DirectUploadKind,
  options: DirectUploadOptions = {}
): Promise<UploadedMedia> {
  const mimeType = normalizedMimeType(file);
  const apiUrl = getApiUrl();
  const presign = await fetch(`${apiUrl}/media/presign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ filename: file.name, mimeType, kind }),
    signal: options.signal,
  });
  if (!presign.ok) throw new Error(await readError(presign, "获取上传地址失败"));

  const { intentId, uploadUrl } = await presign.json();
  options.onProgress?.(0);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: file,
    signal: options.signal,
  });
  if (!put.ok) throw new Error("文件直传失败，请检查 R2 CORS 与网络配置");
  options.onProgress?.(100);

  const confirm = await fetch(`${apiUrl}/media/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ intentId }),
    signal: options.signal,
  });
  if (!confirm.ok) throw new Error(await readError(confirm, "确认上传失败"));
  return confirm.json();
}

export async function uploadImage(file: File, token: string, options?: DirectUploadOptions): Promise<string> {
  return toAbsoluteUrl((await uploadDirect(file, token, "image", options)).url);
}

export async function uploadVideo(file: File, token: string, options?: DirectUploadOptions): Promise<string> {
  return toAbsoluteUrl((await uploadDirect(file, token, "video", options)).url);
}

export async function uploadAudio(file: File, token: string, options?: DirectUploadOptions): Promise<string> {
  return toAbsoluteUrl((await uploadDirect(file, token, "audio", options)).url);
}
