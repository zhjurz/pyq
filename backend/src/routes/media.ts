/**
 * 媒体库路由
 * 提供媒体文件的列表、上传、删除功能。
 * 上传时根据又拍云配置自动选择存储方式（又拍云 / 本地）。
 * 所有上传的文件都会记录到 Media 表中，形成 WordPress 风格的媒体库。
 */
import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { param, validationResult } from "express-validator";
import { Media, User, Post, FriendLink, SiteSetting, getMediaCategory } from "../models";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";
import { getUpyunConfig } from "../services/upyun-service";
import { storeBuffer, deleteStoredFile, createPresignedUpload, isR2Ready } from "../services/storage-service";

const router = Router();

// 上传目录（本地存储回退，仅非 Serverless 部署使用）。
// Vercel 上文件系统只读，此处必须判断 !isServerless 再 mkdir，
// 否则模块加载时就会抛 EROFS 导致整个应用启动失败。
const isServerless = !!process.env.VERCEL;
const uploadDir = path.join(__dirname, "../../public/uploads");
if (!isServerless && !fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// memoryStorage：文件暂存内存，由路由处理器决定存到又拍云还是本地
const mediaStorage = multer.memoryStorage();

// 通用上传：图片 5MB / 音频 20MB / 视频 50MB / 其他文件 50MB
const mediaUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // 允许所有常见文件类型
    const blocked = [
      "text/html",
      "application/javascript",
      "application/xhtml+xml",
    ];
    if (blocked.includes(file.mimetype)) {
      cb(new Error("不支持此文件类型"));
      return;
    }
    cb(null, true);
  },
});

/** 格式化媒体记录为 API 响应 */
function formatMedia(media: any) {
  return {
    id: media.id,
    filename: media.filename,
    url: media.url,
    storageType: media.storageType,
    mimeType: media.mimeType,
    size: Number(media.size),
    category: getMediaCategory(media.mimeType),
    uploaderId: media.uploaderId,
    uploaderName: media.uploader?.nickname || media.uploader?.username || "",
    livePhotoVideo: media.livePhotoVideo || null,
    livePhotoImage: media.livePhotoImage || null,
    createdAt: media.createdAt,
  };
}

// GET /api/media — 媒体列表（分页 + 类型筛选）
router.get(
  "/",
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
    const offset = (page - 1) * limit;
    const category = req.query.category as string | undefined;

    const where: any = {};
    // 隐藏实况图的视频组件（已被合并到对应图片条目中）
    const { Op } = require("sequelize");
    if (category && ["image", "video", "audio", "file"].includes(category)) {
      // 根据类型筛选 MIME 前缀
      const mimeMap: Record<string, string[]> = {
        image: ["image/%"],
        video: ["video/%"],
        audio: ["audio/%"],
        file: [],
      };
      const patterns = mimeMap[category];
      if (patterns.length > 0) {
        where.mimeType = { [Op.or]: patterns.map((p: string) => ({ [Op.like]: p })) };
      } else {
        // file 类型：非 image/video/audio
        where.mimeType = {
          [Op.notLike]: "image/%",
          [Op.and]: [
            { [Op.notLike]: "video/%" },
            { [Op.notLike]: "audio/%" },
          ],
        };
      }
    }
    // 实况图视频组件（livePhotoImage 非空）始终从网格中隐藏——实况图入口已在对应图片条目中
    where.livePhotoImage = { [Op.is]: null };

    const { count, rows: media } = await Media.findAndCountAll({
      where,
      include: [
        { model: User, as: "uploader", attributes: ["id", "username", "nickname"] },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
      distinct: true,
    });

    res.json({
      data: media.map(formatMedia),
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
        hasMore: page < Math.ceil(count / limit),
      },
    });
  }
);

// POST /api/media/upload — 上传媒体文件（图片/音频/视频/其他文件）
router.post(
  "/upload",
  authenticate,
  requireAdmin,
  mediaUpload.single("file"),
  async (req: AuthRequest, res: Response) => {
    if (!req.file) {
      res.status(400).json({ message: "没有上传文件" });
      return;
    }

    const file = req.file;
    const mimeType = file.mimetype;
    const originalName = file.originalname;

    let url: string;
    let storageType: "r2" | "upyun" | "local";

    try {
      const stored = await storeBuffer(file.buffer, originalName, mimeType, "media");
      url = stored.url;
      storageType = stored.storageType;
    } catch (err: any) {
      res.status(500).json({ message: err.message || "文件上传失败" });
      return;
    }

    // 记录到 Media 表
    const media = await Media.create({
      filename: originalName,
      url,
      storageType,
      mimeType,
      size: file.size,
      uploaderId: req.user!.id,
    });

    const full = await Media.findByPk(media.id, {
      include: [
        { model: User, as: "uploader", attributes: ["id", "username", "nickname"] },
      ],
    });

    res.status(201).json(formatMedia(full));
  }
);

// POST /api/media/presign — 获取预签名直传 URL（大文件绕开 Vercel 函数体积上限，仅 R2 支持）
// body: { filename: string, mimeType: string }
router.post("/presign", authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
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

// POST /api/media/confirm — 直传完成后登记到媒体库
// body: { key: string, filename: string, mimeType: string, size?: number }
router.post("/confirm", authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
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
    const publicUrl = (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");
    const url = `${publicUrl}/${key}`;
    const media = await Media.create({
      filename: filename || key,
      url,
      storageType: "r2",
      mimeType: mimeType || "application/octet-stream",
      size: Number(size) || 0,
      uploaderId: req.user!.id,
    });
    const full = await Media.findByPk(media.id, {
      include: [{ model: User, as: "uploader", attributes: ["id", "username", "nickname"] }],
    });
    res.status(201).json(formatMedia(full));
  } catch (err: any) {
    res.status(500).json({ message: err.message || "登记媒体记录失败" });
  }
});

// DELETE /api/media/:id — 删除媒体文件
router.delete(
  "/:id",
  authenticate,
  requireAdmin,
  [param("id").isUUID()],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const media = await Media.findByPk(req.params.id as string);
    if (!media) {
      res.status(404).json({ message: "媒体文件不存在" });
      return;
    }

    // 删除远端文件（R2 / 又拍云 / 本地，失败不阻塞记录删除）
    try {
      await deleteStoredFile(media.url, media.storageType as "r2" | "upyun" | "local");
    } catch {
      console.log(`[media] 远端文件删除失败: ${media.url}`);
    }

    await media.destroy();
    res.status(204).send();
  }
);

/**
 * 扩展名 → MIME 类型映射表，用于导入本地已存在但未登记到 media 表的文件。
 */
const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".txt": "text/plain",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** 递归扫描本地 uploads 目录，返回所有文件的绝对路径 */
function scanUploadDir(dir: string, baseDir: string): Array<{ fullPath: string; relPath: string }> {
  const results: Array<{ fullPath: string; relPath: string }> = [];
  if (!fs.existsSync(dir)) return results;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanUploadDir(full, baseDir));
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, full).split(path.sep).join("/");
      results.push({ fullPath: full, relPath: rel });
    }
  }
  return results;
}

/**
 * 从 URL 提取文件名（含扩展名）。
 * 例：https://cdn.example.com/media/2026/01/abc.jpg → abc.jpg
 *     /uploads/2026/01/abc.jpg → abc.jpg
 */
function extractFilename(url: string): string {
  try {
    const clean = url.split("?")[0].split("#")[0];
    const parts = clean.split("/");
    return parts[parts.length - 1] || clean;
  } catch {
    return url;
  }
}

/** 从 URL 扩展名推断 MIME 类型 */
function mimeFromUrl(url: string): string {
  const clean = url.split("?")[0].split("#")[0];
  const ext = path.extname(clean).toLowerCase();
  return EXT_TO_MIME[ext] || "application/octet-stream";
}

/** 判断 URL 是否为本地 /uploads/ 路径 */
function isLocalUploadUrl(url: string): boolean {
  return url.startsWith("/uploads/") || url.startsWith("uploads/");
}

/**
 * POST /api/media/import — 导入已存在但未登记的文件到媒体库。
 *
 * 导入流程：
 * 1. 扫描本地 /uploads/ 目录递归所有文件
 * 2. 对每个文件，按 url 查重；已存在则跳过
 * 3. 扫描数据库（posts/users/friend_links/site_settings）中引用的又拍云 URL
 *    为未登记的又拍云文件创建 Media 记录
 * 4. 扫描 posts.images 中所有 {src, video} 配对，回填 livePhotoVideo / livePhotoImage
 *
 * 默认 uploader 使用第一个管理员用户。
 */
router.post(
  "/import",
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      // 1. 找一个管理员作为默认 uploader
      const admin = await User.findOne({
        where: { role: "admin" },
        attributes: ["id", "username", "nickname"],
      });
      if (!admin) {
        res.status(400).json({ message: "未找到管理员账号，无法导入" });
        return;
      }

      let imported = 0;
      let skipped = 0;
      let failed = 0;
      let cloudImported = 0;

      // 2. 扫描本地 uploads 目录
      const scanned = scanUploadDir(uploadDir, uploadDir);
      for (const { fullPath, relPath } of scanned) {
        const url = `/uploads/${relPath}`;
        try {
          const existing = await Media.findOne({ where: { url }, attributes: ["id"] });
          if (existing) {
            skipped++;
            continue;
          }
          const ext = path.extname(relPath).toLowerCase();
          const mimeType = EXT_TO_MIME[ext] || "application/octet-stream";
          const stat = fs.statSync(fullPath);
          const filename = path.basename(relPath);
          await Media.create({
            filename,
            url,
            storageType: "local",
            mimeType,
            size: stat.size,
            uploaderId: admin.id,
            livePhotoVideo: null,
            livePhotoImage: null,
          });
          imported++;
        } catch {
          failed++;
        }
      }

      // 3. 扫描数据库引用的又拍云 URL
      const cfg = await getUpyunConfig();
      const cloudDomain = cfg.domain;
      if (cloudDomain) {
        const cloudUrls = new Set<string>();

        // 收集所有可能引用又拍云文件的 URL
        // posts.images (string[] | {src, video}[])
        const posts = await Post.findAll({ attributes: ["id", "images", "video", "music", "linkCard", "adAvatar"] });
        for (const post of posts) {
          // images
          const imgs = post.images as any;
          if (Array.isArray(imgs)) {
            for (const img of imgs) {
              if (typeof img === "string") {
                cloudUrls.add(img);
              } else if (img && typeof img === "object") {
                if (img.src) cloudUrls.add(img.src);
                if (img.video) cloudUrls.add(img.video);
              }
            }
          }
          // video JSON
          const vid = post.video as any;
          if (vid && typeof vid === "object") {
            if (vid.url) cloudUrls.add(vid.url);
            if (vid.cover) cloudUrls.add(vid.cover);
          }
          // music JSON（只导入 cover，url 是外部音乐源不导入）
          const music = post.music as any;
          if (music && typeof music === "object" && music.cover) {
            cloudUrls.add(music.cover);
          }
          // linkCard JSON
          const card = post.linkCard as any;
          if (card && typeof card === "object" && card.image) {
            cloudUrls.add(card.image);
          }
          // adAvatar
          if (post.adAvatar) cloudUrls.add(post.adAvatar);
        }

        // users.avatar, users.cover
        const users = await User.findAll({ attributes: ["id", "avatar", "cover"] });
        for (const u of users) {
          if (u.avatar) cloudUrls.add(u.avatar);
          if (u.cover) cloudUrls.add(u.cover);
        }

        // friend_links.avatar
        const friends = await FriendLink.findAll({ attributes: ["id", "avatar"] });
        for (const f of friends) {
          if (f.avatar) cloudUrls.add(f.avatar);
        }

        // site_settings (favicon_url, og_image, music_url, font_url)
        const setting = await SiteSetting.findByPk(1);
        if (setting) {
          const s = setting as any;
          if (s.faviconUrl) cloudUrls.add(s.faviconUrl);
          if (s.ogImage) cloudUrls.add(s.ogImage);
          if (s.musicUrl) cloudUrls.add(s.musicUrl);
          if (s.fontUrl) cloudUrls.add(s.fontUrl);
        }

        // 筛选出又拍云域名的 URL，排除本地 /uploads/ 和外部 URL
        for (const url of cloudUrls) {
          if (!url || typeof url !== "string") continue;
          if (isLocalUploadUrl(url)) continue; // 本地文件已在上面扫描
          if (!url.startsWith(cloudDomain)) continue; // 非又拍云域名跳过
          try {
            const existing = await Media.findOne({ where: { url }, attributes: ["id"] });
            if (existing) {
              skipped++;
              continue;
            }
            const filename = extractFilename(url);
            const mimeType = mimeFromUrl(url);
            await Media.create({
              filename,
              url,
              storageType: "upyun",
              mimeType,
              size: 0, // 又拍云文件无法直接获取大小
              uploaderId: admin.id,
              livePhotoVideo: null,
              livePhotoImage: null,
            });
            cloudImported++;
          } catch {
            failed++;
          }
        }
      }

      // 4. 扫描 posts.images 建立实况图配对关系
      let pairsLinked = 0;
      try {
        const allPosts = await Post.findAll({
          attributes: ["id", "images"],
          where: { images: { [require("sequelize").Op.ne]: null } },
        });
        for (const post of allPosts) {
          const imgs = post.images as any;
          if (!Array.isArray(imgs)) continue;
          for (const img of imgs) {
            // PostImage = string | { src: string; video?: string }
            if (typeof img !== "object" || !img || !img.src || !img.video) continue;
            const srcUrl: string = img.src;
            const videoUrl: string = img.video;
            // 更新图片 Media 记录：设置 livePhotoVideo
            try {
              const imgMedia = await Media.findOne({ where: { url: srcUrl } });
              if (imgMedia && !imgMedia.livePhotoVideo) {
                await imgMedia.update({ livePhotoVideo: videoUrl });
                pairsLinked++;
              }
            } catch { /* ignore */ }
            // 更新视频 Media 记录：设置 livePhotoImage
            try {
              const vidMedia = await Media.findOne({ where: { url: videoUrl } });
              if (vidMedia && !vidMedia.livePhotoImage) {
                await vidMedia.update({ livePhotoImage: srcUrl });
              }
            } catch { /* ignore */ }
          }
        }
      } catch (err) {
        console.log("[media/import] 扫描实况图配对失败:", err);
      }

      res.json({
        message: `导入完成：本地新增 ${imported} 个，又拍云新增 ${cloudImported} 个，跳过 ${skipped} 个已存在，失败 ${failed} 个，实况图配对 ${pairsLinked} 对`,
        stats: { imported, cloudImported, skipped, failed, pairsLinked, totalScanned: scanned.length },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "导入失败" });
    }
  }
);

export default router;
