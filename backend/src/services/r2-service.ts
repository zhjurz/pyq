/**
 * Cloudflare R2 存储服务（S3 兼容 API）
 *
 * R2 是本项目在 Vercel Serverless 部署下的默认/推荐存储后端：
 * Vercel Serverless 函数的文件系统只读且不持久（除 /tmp，且不同实例间
 * 不共享），因此媒体文件不能再像传统部署那样写入本地 public/uploads
 * 目录，必须存到对象存储。
 *
 * 配置通过环境变量提供（而非像又拍云那样存在数据库 SiteSetting 里）：
 * 这是 Vercel 上管理密钥的推荐方式（Project Settings → Environment
 * Variables），避免把云存储密钥明文存进数据库。
 *
 *   R2_ACCOUNT_ID          Cloudflare 账户 ID
 *   R2_ACCESS_KEY_ID       R2 API Token 的 Access Key ID
 *   R2_SECRET_ACCESS_KEY   R2 API Token 的 Secret Access Key
 *   R2_BUCKET              Bucket 名称
 *   R2_PUBLIC_URL          Bucket 绑定的公开访问域名（自定义域名或 r2.dev
 *                          开发域名），不带末尾斜杠，如
 *                          https://media.yourdomain.com
 *   R2_ENDPOINT            可选，默认根据 R2_ACCOUNT_ID 自动生成
 */
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import path from "path";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
  endpoint: string;
}

function readR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
  const bucket = process.env.R2_BUCKET || "";
  const publicUrl = (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    return null;
  }

  const endpoint = process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;

  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl, endpoint };
}

/** R2 是否已通过环境变量完整配置 */
export function isR2Ready(): boolean {
  return readR2Config() !== null;
}

let cachedClient: { client: S3Client; cfg: R2Config } | null = null;

/** 惰性创建并复用 S3Client（同一函数实例内跨请求复用，减少握手开销） */
function getClient(): { client: S3Client; cfg: R2Config } {
  const cfg = readR2Config();
  if (!cfg) {
    throw new Error("R2 存储未配置（缺少 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_URL）");
  }
  if (cachedClient && cachedClient.cfg.endpoint === cfg.endpoint && cachedClient.cfg.accessKeyId === cfg.accessKeyId) {
    return cachedClient;
  }
  const client = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  cachedClient = { client, cfg };
  return cachedClient;
}

/** 按日期生成对象 key：{prefix}/{year}/{month}/{uuid}.{ext} */
export function buildObjectKey(prefix: string, originalName: string): string {
  const ext = path.extname(originalName) || "";
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const fileName = `${uuidv4()}${ext}`;
  return cleanPrefix ? `${cleanPrefix}/${year}/${month}/${fileName}` : `${year}/${month}/${fileName}`;
}

function publicUrlFor(cfg: R2Config, key: string): string {
  return `${cfg.publicUrl}/${key.replace(/^\/+/, "")}`;
}

/**
 * 直接从服务端上传文件内容到 R2（适合较小的文件，如从 multer memoryStorage
 * 拿到的 buffer）。大文件建议使用 createPresignedUpload() 走客户端直传，
 * 避免 Vercel Serverless 函数 4.5MB 请求体上限。
 */
export async function uploadToR2(
  buffer: Buffer,
  key: string,
  mimeType: string
): Promise<string> {
  const { client, cfg } = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType || "application/octet-stream",
    })
  );
  return publicUrlFor(cfg, key);
}

/**
 * 读取 R2 中对象的完整内容为 Buffer。
 * 用于需要服务端二次处理的场景：文件先通过预签名 URL 直传到 R2
 * （绕开 Vercel 函数体积限制），confirm 阶段再由后端拉回来处理
 * （如动态照片拆分图片/视频），处理完成后原始合并文件通常会被删除。
 */
export async function downloadFromR2(key: string): Promise<Buffer> {
  const { client, cfg } = getClient();
  const resp = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  const body = resp.Body;
  if (!body) throw new Error("R2 对象为空");
  const chunks: Buffer[] = [];
  // @ts-ignore - Node 环境下 Body 是可迭代的 Readable 流
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** 删除 R2 中的对象 */
export async function deleteFromR2(key: string): Promise<boolean> {
  try {
    const { client, cfg } = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** 确认对象确实已上传到 R2（presigned 直传确认流程中使用），返回实际大小 */
export async function statR2Object(key: string): Promise<{ size: number; contentType?: string } | null> {
  try {
    const { client, cfg } = getClient();
    const resp = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return { size: Number(resp.ContentLength || 0), contentType: resp.ContentType };
  } catch {
    return null;
  }
}

/**
 * 生成预签名 PUT URL，供浏览器直接把文件上传到 R2，完全绕开后端
 * Serverless 函数（不受 Vercel ~4.5MB 请求体上限影响，视频/大图上传
 * 必须走这条路径）。
 */
export async function createPresignedUpload(
  originalName: string,
  mimeType: string,
  prefix: string,
  expiresSeconds = 600
): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  const { client, cfg } = getClient();
  const key = buildObjectKey(prefix, originalName);
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: mimeType || "application/octet-stream",
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: expiresSeconds });
  return { uploadUrl, publicUrl: publicUrlFor(cfg, key), key };
}

/** 从 R2 公开访问 URL 中提取对象 key（用于删除） */
export function extractR2Key(url: string): string {
  const cfg = readR2Config();
  if (cfg && url.startsWith(cfg.publicUrl + "/")) {
    return url.slice(cfg.publicUrl.length + 1);
  }
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, "");
  } catch {
    return "";
  }
}
