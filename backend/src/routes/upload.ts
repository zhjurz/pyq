/**
 * 上传路由
 * 图片/音频/视频上传，自动选择存储方式：R2（环境变量配置） > 又拍云（后台配置） > 本地磁盘（仅非 Serverless）。
 * 所有上传的文件都会记录到 Media 表（媒体库）。
 *
 * Vercel Serverless 函数请求体上限约 4.5MB（平台硬限制，无法通过配置提高），
 * 因此除了原有的"直接上传到后端"接口（仅适合小文件），本文件还提供了
 * presign / confirm 两个接口，用于大文件（尤其是视频、动态照片）从浏览器
 * 直接 PUT 到 R2，完全绕开后端函数。详见 VERCEL_DEPLOYMENT.md。
 */
import { Router } from "express";
import path from "path";
import multer from "multer";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";
import { Media } from "../models";
import {
  storeFileAndRecordMedia,
  createPresignedUpload,
  isR2Ready,
} from "../services/storage-service";
import { downloadFromR2, deleteFromR2 } from "../services/r2-service";
import { extractMotionPhoto } from "../services/motion-photo";

const router = Router();

// memoryStorage：由路由处理器决定存储位置（R2 / 又拍云 / 本地）
const storage = multer.memoryStorage();

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/jpg"];
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const VIDEO_MIMES = ["video/quicktime", "video/mp4", "video/webm", "video/3gpp", "video/3gp", "video/x-m4v"];
const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".3gp", ".m4v"];
const AUDIO_MIMES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/aac"];

const imageUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (IMAGE_MIMES.includes(file.mimetype) || IMAGE_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("仅支持 jpg/png/gif/webp 图片"));
    }
  },
});

const audioUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (AUDIO_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("仅支持 mp3/wav/ogg/aac 音频"));
    }
  },
});

const videoUpload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (VIDEO_MIMES.includes(file.mimetype) || VIDEO_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("仅支持 mov/mp4/webm 视频"));
    }
  },
});

// 动态照片（Motion Photo）：单个 JPEG 内嵌 MP4，文件可能较大
const motionPhotoUpload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const isImage = IMAGE_MIMES.includes(file.mimetype) || IMAGE_EXTS.includes(ext);
    if (isImage) {
      cb(null, true);
    } else {
      cb(new Error("动态照片需为 JPEG 格式"));
    }
  },
});

// POST /api/upload - upload an image (admin only)
router.post("/", authenticate, requireAdmin, imageUpload.single("image"), async (req: AuthRequest, res) => {
  if (!req.file) {
    res.status(400).json({ message: "没有上传文件" });
    return;
  }
  try {
    const { url } = await storeFileAndRecordMedia(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      req.user!.id
    );
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ message: err.message || "上传失败" });
  }
});

// POST /api/upload/audio - upload an audio file (admin only)
router.post("/audio", authenticate, requireAdmin, audioUpload.single("audio"), async (req: AuthRequest, res) => {
  if (!req.file) {
    res.status(400).json({ message: "没有上传文件" });
    return;
  }
  try {
    const { url } = await storeFileAndRecordMedia(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      req.user!.id
    );
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ message: err.message || "上传失败" });
  }
});

// POST /api/upload/video - upload a video file (admin only)
// 注意：Vercel Serverless 函数请求体上限约 4.5MB，超过该大小的视频
// 在部署到 Vercel 后会在到达这里之前就被平台拒绝（413）。
// 大文件请改用 POST /api/upload/presign + PUT 到 R2 + POST /api/upload/confirm。
router.post("/video", authenticate, requireAdmin, videoUpload.single("video"), async (req: AuthRequest, res) => {
  if (!req.file) {
    res.status(400).json({ message: "没有上传文件" });
    return;
  }
  try {
    const { url } = await storeFileAndRecordMedia(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      req.user!.id
    );
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ message: err.message || "上传失败" });
  }
});

// POST /api/upload/motion-photo - upload a motion photo (single JPEG with embedded MP4)
// 自动拆分为图片+视频，返回配对 URL。如果文件不含嵌入视频则降级为普通图片。
router.post(
  "/motion-photo",
  authenticate,
  requireAdmin,
  motionPhotoUpload.single("file"),
  async (req: AuthRequest, res) => {
    if (!req.file) {
      res.status(400).json({ message: "没有上传文件" });
      return;
    }
    try {
      const extracted = extractMotionPhoto(req.file.buffer);

      if (extracted) {
        const imageName = `${path.basename(req.file.originalname, path.extname(req.file.originalname))}.jpg`;
        const videoName = `${path.basename(req.file.originalname, path.extname(req.file.originalname))}.mp4`;

        const [imageResult, videoResult] = await Promise.all([
          storeFileAndRecordMedia(extracted.image, imageName, extracted.imageMime, req.user!.id),
          storeFileAndRecordMedia(extracted.video, videoName, extracted.videoMime, req.user!.id),
        ]);

        res.json({ image: imageResult.url, video: videoResult.url, isLivePhoto: true });
      } else {
        const { url } = await storeFileAndRecordMedia(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          req.user!.id
        );
        res.json({ image: url, video: null, isLivePhoto: false });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message || "动态照片处理失败" });
    }
  }
);

// ===== 大文件直传（presign / confirm）=====
// 仅 R2 支持预签名直传。流程：
//   1. 前端调用 /presign 拿到 uploadUrl + key
//   2. 前端用 fetch(uploadUrl, { method: "PUT", body: file }) 直接传给 R2
//   3. 前端调用 /confirm，后端登记 Media 记录并返回最终 URL

// POST /api/upload/presign — 获取预签名直传 URL（admin only）
// body: { filename: string, mimeType: string, kind?: "image"|"audio"|"video" }
router.post("/presign", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const { filename, mimeType } = req.body || {};
  if (!filename || typeof filename !== "string") {
    res.status(400).json({ message: "缺少 filename 参数" });
    return;
  }
  try {
    const { uploadUrl, publicUrl, key } = await createPresignedUpload(
      filename,
      typeof mimeType === "string" ? mimeType : "application/octet-stream",
      "media"
    );
    res.json({ uploadUrl, publicUrl, key, expiresIn: 600 });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "获取直传地址失败" });
  }
});

// POST /api/upload/confirm — 直传完成后登记到媒体库（admin only）
// body: { key: string, filename: string, mimeType: string, size?: number }
router.post("/confirm", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const { key, filename, mimeType, size } = req.body || {};
  if (!key || typeof key !== "string") {
    res.status(400).json({ message: "缺少 key 参数" });
    return;
  }
  if (!isR2Ready()) {
    res.status(400).json({ message: "R2 存储未配置" });
    return;
  }
  try {
    const { R2_PUBLIC_URL } = process.env as Record<string, string>;
    const url = `${(R2_PUBLIC_URL || "").replace(/\/+$/, "")}/${key}`;
    const media = await Media.create({
      filename: filename || key,
      url,
      storageType: "r2",
      mimeType: mimeType || "application/octet-stream",
      size: Number(size) || 0,
      uploaderId: req.user!.id,
    });
    res.status(201).json({ url, mediaId: media.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message || "登记媒体记录失败" });
  }
});

// POST /api/upload/motion-photo/confirm — 动态照片走预签名直传后，通知后端拉回并拆分
// body: { key: string, filename: string }
router.post("/motion-photo/confirm", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const { key, filename } = req.body || {};
  if (!key || typeof key !== "string") {
    res.status(400).json({ message: "缺少 key 参数" });
    return;
  }
  if (!isR2Ready()) {
    res.status(400).json({ message: "R2 存储未配置" });
    return;
  }
  try {
    const buffer = await downloadFromR2(key);
    const extracted = extractMotionPhoto(buffer);
    const baseName = path.basename(filename || key, path.extname(filename || key));

    if (extracted) {
      const [imageResult, videoResult] = await Promise.all([
        storeFileAndRecordMedia(extracted.image, `${baseName}.jpg`, extracted.imageMime, req.user!.id),
        storeFileAndRecordMedia(extracted.video, `${baseName}.mp4`, extracted.videoMime, req.user!.id),
      ]);
      // 原始合并文件不再需要，清理掉避免占用存储空间
      deleteFromR2(key).catch(() => {});
      res.json({ image: imageResult.url, video: videoResult.url, isLivePhoto: true });
    } else {
      // 非动态照片：直接把已上传的原文件登记为普通图片
      const { R2_PUBLIC_URL } = process.env as Record<string, string>;
      const url = `${(R2_PUBLIC_URL || "").replace(/\/+$/, "")}/${key}`;
      const media = await Media.create({
        filename: filename || key,
        url,
        storageType: "r2",
        mimeType: "image/jpeg",
        size: buffer.length,
        uploaderId: req.user!.id,
      });
      res.json({ image: url, video: null, isLivePhoto: false, mediaId: media.id });
    }
  } catch (err: any) {
    res.status(500).json({ message: err.message || "动态照片处理失败" });
  }
});

// POST /api/upload/test-upyun - test Upyun connection (admin only)
router.post("/test-upyun", authenticate, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const { isUpyunReady, getUpyunConfig, uploadToUpyun } = await import("../services/upyun-service");
    const ready = await isUpyunReady();
    if (!ready) {
      res.status(400).json({
        success: false,
        message: "又拍云未启用或配置不完整（需要启用 + bucket + 操作员 + 密码 + 域名）",
      });
      return;
    }
    const cfg = await getUpyunConfig();
    const testBuffer = Buffer.from("upyun-connection-test");
    const testPath = `test/conn-${Date.now()}.txt`;
    const url = await uploadToUpyun(testBuffer, testPath, "text/plain");
    res.json({
      success: true,
      message: "连接成功，文件已上传到又拍云",
      url,
      https: url.startsWith("https://"),
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message || "又拍云连接失败" });
  }
});

// POST /api/upload/migrate-to-upyun - 迁移本地文件到又拍云（管理员）
// 注意：该接口扫描本地磁盘 public/uploads 目录，仅在传统部署（VPS/Docker）
// 下有意义；Vercel Serverless 部署没有本地磁盘文件可迁移，调用会返回
// totalFiles: 0。
router.post("/migrate-to-upyun", authenticate, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const { migrateLocalToUpyun } = await import("../services/migrate-service");
    const result = await migrateLocalToUpyun();
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "迁移失败" });
  }
});

export default router;
