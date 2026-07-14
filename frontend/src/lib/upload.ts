import { getApiUrl } from "./api-fetch";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";
const BASE_URL = API_URL.replace(/\/api$/, "");

export type DirectUploadKind = "image" | "video" | "audio" | "file";
export type DirectUploadPhase = "presign" | "put" | "confirm" | "network";

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

/** A safe, user-displayable failure. It deliberately never retains a presigned URL. */
export class DirectUploadError extends Error {
  constructor(
    public readonly phase: DirectUploadPhase,
    message: string,
    public readonly status?: number,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "DirectUploadError";
  }
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
  const reported = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (reported) return reported;
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
  return typeof data?.message === "string" ? data.message : fallback;
}

async function readR2Error(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  const code = text.match(/<Code>([^<]+)<\/Code>/i)?.[1];
  const message = text.match(/<Message>([^<]+)<\/Message>/i)?.[1];
  if (code === "SignatureDoesNotMatch" || code === "RequestExpired") {
    return "R2 上传签名已失效或请求参数不匹配，请重新选择文件后重试。";
  }
  if (code === "AccessDenied") return "R2 拒绝了上传请求，请检查存储桶权限和上传签名。";
  if (message) return `R2 拒绝上传：${message}`;
  return `R2 直传失败（HTTP ${res.status}）。`;
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
  let presign: Response;
  try {
    presign = await fetch(`${apiUrl}/media/presign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ filename: file.name, mimeType, kind }),
      signal: options.signal,
    });
  } catch {
    throw new DirectUploadError("network", "无法连接上传服务，请检查网络后重试。");
  }
  if (!presign.ok) {
    throw new DirectUploadError("presign", await readError(presign, "获取上传地址失败"), presign.status);
  }

  const { intentId, uploadUrl } = await presign.json();
  if (!intentId || !uploadUrl) throw new DirectUploadError("presign", "上传服务返回了无效的上传地址。");

  options.onProgress?.(0);
  let put: Response;
  try {
    put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: file,
      signal: options.signal,
    });
  } catch {
    throw new DirectUploadError(
      "network",
      "浏览器无法连接 R2 上传地址。请检查 R2 存储桶 CORS 是否允许当前站点的 PUT 请求，以及网络连接。"
    );
  }
  if (!put.ok) {
    const requestId = put.headers.get("cf-ray") || put.headers.get("x-amz-request-id") || undefined;
    throw new DirectUploadError("put", await readR2Error(put), put.status, requestId);
  }
  options.onProgress?.(100);

  let confirm: Response;
  try {
    confirm = await fetch(`${apiUrl}/media/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ intentId }),
      signal: options.signal,
    });
  } catch {
    throw new DirectUploadError("network", "文件已上传到 R2，但无法连接确认服务；请检查网络后重试。");
  }
  if (!confirm.ok) {
    throw new DirectUploadError("confirm", await readError(confirm, "确认上传失败"), confirm.status);
  }
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
