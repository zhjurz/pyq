import { Media } from "../models";
import {
  buildObjectKey,
  createPresignedUpload as createR2PresignedUpload,
  deleteFromR2,
  extractR2Key,
  isR2Ready,
  uploadToR2,
} from "./r2-service";

export type StorageType = "r2";

function requireR2() {
  if (!isR2Ready()) {
    throw new Error(
      "Cloudflare R2 未配置。请设置 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、R2_BUCKET 和 R2_PUBLIC_URL。"
    );
  }
}

/**
 * 服务端小文件写入 R2。生产大文件应使用 media/presign + 直传流程，
 * 不经过 Vercel Serverless 函数。
 */
export async function storeBuffer(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  prefix = "media"
): Promise<{ url: string; storageType: StorageType }> {
  requireR2();
  const key = buildObjectKey(prefix, originalName);
  const url = await uploadToR2(buffer, key, mimeType);
  return { url, storageType: "r2" };
}

export async function storeFileAndRecordMedia(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  uploaderId: string,
  prefix = "media"
): Promise<{ url: string; storageType: StorageType; mediaId: string }> {
  const { url, storageType } = await storeBuffer(buffer, originalName, mimeType, prefix);
  const media = await Media.create({
    filename: originalName,
    url,
    storageType,
    mimeType,
    size: buffer.length,
    uploaderId,
  });
  return { url, storageType, mediaId: media.id };
}

export async function createPresignedUpload(
  originalName: string,
  mimeType: string,
  prefix = "media"
): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  requireR2();
  return createR2PresignedUpload(originalName, mimeType, prefix);
}
export async function deleteStoredFile(url: string, storageType: StorageType): Promise<void> {
  if (storageType !== "r2") return;
  const key = extractR2Key(url);
  if (key) await deleteFromR2(key);
}

export { isR2Ready };
