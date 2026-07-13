/**
 * 统一存储服务：根据配置自动选择存储后端。
 *
 * 优先级：R2（环境变量配置） > 又拍云（数据库 SiteSetting 配置，历史功能）
 *        > 本地磁盘（仅限非 Serverless 部署下的开发/兜底）。
 *
 * 之所以保留又拍云，是为了不影响已经在用又拍云的现有部署；新的
 * Vercel Serverless 部署按 VERCEL_DEPLOYMENT.md 配置 R2 环境变量即可，
 * 无需再手动在后台管理里配置又拍云。
 *
 * 本地磁盘分支在 Serverless（process.env.VERCEL 存在）下会直接抛出
 * 明确的报错，而不是静默失败——Serverless 文件系统只读且不持久，
 * 写本地磁盘既不会报错也不会真正保存文件（下次冷启动就丢失），
 * 早失败比"看起来成功但文件其实没了"要安全得多。
 */
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { Media } from "../models";
import { isUpyunReady, uploadToUpyun, getUpyunConfig, deleteFromUpyun, extractRemotePath } from "./upyun-service";
import { isR2Ready, uploadToR2, buildObjectKey, deleteFromR2, extractR2Key, createPresignedUpload as r2CreatePresignedUpload } from "./r2-service";

export type StorageType = "r2" | "upyun" | "local";

const isServerless = !!process.env.VERCEL;

/** 本地磁盘上传目录（仅传统部署可用） */
const localUploadDir = path.join(__dirname, "../../public/uploads");

function ensureLocalDirExists(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function buildLocalPath(originalName: string): { url: string; fullPath: string } {
  const ext = path.extname(originalName) || "";
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const subdir = path.join(localUploadDir, year, month);
  ensureLocalDirExists(subdir);
  const filename = `${uuidv4()}${ext}`;
  return {
    url: `/uploads/${year}/${month}/${filename}`,
    fullPath: path.join(subdir, filename),
  };
}

/**
 * 存储一个文件 buffer，返回访问 URL + 实际使用的存储后端。
 * @param prefix 远程路径前缀（用于分类，如 "media"、"douban"）
 */
export async function storeBuffer(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  prefix = "media"
): Promise<{ url: string; storageType: StorageType }> {
  // 1) R2 优先
  if (isR2Ready()) {
    const key = buildObjectKey(prefix, originalName);
    const url = await uploadToR2(buffer, key, mimeType);
    return { url, storageType: "r2" };
  }

  // 2) 又拍云（历史部署兼容）
  if (await isUpyunReady()) {
    try {
      const cfg = await getUpyunConfig();
      const ext = path.extname(originalName) || "";
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const cleanPrefix = cfg.path.replace(/^\/+|\/+$/g, "");
      const fileName = `${uuidv4()}${ext}`;
      const remotePath = cleanPrefix
        ? `${cleanPrefix}/${year}/${month}/${fileName}`
        : `${year}/${month}/${fileName}`;
      const url = await uploadToUpyun(buffer, remotePath, mimeType);
      return { url, storageType: "upyun" };
    } catch (err) {
      if (isServerless) throw err; // Serverless 下没有本地磁盘可回退，直接抛出
      console.error(`[storage] 又拍云上传失败，回退本地磁盘:`, (err as Error).message);
    }
  }

  // 3) 本地磁盘（仅非 Serverless）
  if (isServerless) {
    throw new Error(
      "未配置任何可用的对象存储（R2 / 又拍云）。Vercel Serverless 部署下无法写本地磁盘，请配置 R2_* 环境变量，参见 VERCEL_DEPLOYMENT.md"
    );
  }
  const local = buildLocalPath(originalName);
  fs.writeFileSync(local.fullPath, buffer);
  return { url: local.url, storageType: "local" };
}

/** 存储文件并登记到 Media 表，返回值与旧版 storeFile() 保持一致，方便替换调用方 */
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

/**
 * 生成预签名直传 URL（仅 R2 支持）。用于绕开 Vercel Serverless 函数
 * ~4.5MB 请求体上限——视频/大图片应使用这条路径，由浏览器直接 PUT
 * 到 R2，不经过后端函数中转。
 */
export async function createPresignedUpload(
  originalName: string,
  mimeType: string,
  prefix = "media"
): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  if (!isR2Ready()) {
    throw new Error(
      "预签名直传仅支持 R2 存储，请先配置 R2_* 环境变量（参见 VERCEL_DEPLOYMENT.md）。小文件也可以继续使用原有的 /upload 接口。"
    );
  }
  return r2CreatePresignedUpload(originalName, mimeType, prefix);
}

/** 根据存储类型 + URL 删除对应的远端文件（本地磁盘 storageType 由调用方直接处理，此处只处理云存储） */
export async function deleteStoredFile(url: string, storageType: StorageType): Promise<void> {
  if (storageType === "r2") {
    const key = extractR2Key(url);
    if (key) await deleteFromR2(key);
    return;
  }
  if (storageType === "upyun") {
    try {
      const cfg = await getUpyunConfig();
      const remotePath = extractRemotePath(url, cfg.domain, cfg.path);
      if (remotePath) await deleteFromUpyun(remotePath);
    } catch {
      // 远端删除失败不阻塞主流程
    }
    return;
  }
  if (storageType === "local" && !isServerless) {
    try {
      const localPath = url.replace(/^\/uploads\//, "");
      const fullPath = path.join(localUploadDir, localPath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch {
      // ignore
    }
  }
}

export { isR2Ready };
