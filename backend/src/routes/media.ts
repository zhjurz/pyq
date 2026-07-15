/**
 * 媒体库路由
 * 提供媒体文件的列表、上传、删除功能。
 * 上传通过受控 R2 直传完成，并自动登记到 Media 表。
 */
import { Router, Request, Response } from "express";
import path from "path";
import { Op } from "sequelize";
import { param, validationResult } from "express-validator";
import { Media, MusicTrack, Post, UploadIntent, User, getMediaCategory } from "../models";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";
import { deleteStoredFile, isR2Ready } from "../services/storage-service";
import {
  buildObjectKey,
  buildStagingKey,
  createPresignedUploadForKey,
  promoteR2Object,
  statR2Object,
} from "../services/r2-service";

const router = Router();

const DIRECT_UPLOAD_RULES = {
  image: {
    mimes: new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]),
    extensions: new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]),
    maxSize: 20 * 1024 * 1024,
  },
  video: {
    mimes: new Set(["video/quicktime", "video/mp4", "video/webm", "video/3gpp", "video/3gp", "video/x-m4v"]),
    extensions: new Set([".mp4", ".mov", ".webm", ".3gp", ".m4v"]),
    maxSize: 100 * 1024 * 1024,
  },
  audio: {
    mimes: new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/aac"]),
    extensions: new Set([".mp3", ".wav", ".ogg", ".aac"]),
    maxSize: 50 * 1024 * 1024,
  },
  file: {
    mimes: new Set<string>(),
    extensions: new Set<string>(),
    maxSize: 50 * 1024 * 1024,
  },
} as const;

type DirectUploadKind = keyof typeof DIRECT_UPLOAD_RULES;

function getDirectUploadRule(kind: unknown, filename: string, mimeType: unknown) {
  if (typeof kind !== "string" || !(kind in DIRECT_UPLOAD_RULES)) {
    throw new Error("不支持的上传类型");
  }
  if (typeof filename !== "string" || !filename.trim() || filename.length > 255) {
    throw new Error("文件名无效");
  }
  if (typeof mimeType !== "string" || !mimeType) {
    throw new Error("文件类型无效");
  }

  const rule = DIRECT_UPLOAD_RULES[kind as DirectUploadKind];
  const ext = path.extname(filename).toLowerCase();
  if (kind === "file") {
    const blocked = new Set(["text/html", "application/javascript", "application/xhtml+xml", "image/svg+xml"]);
    if (blocked.has(mimeType)) throw new Error("不支持此文件类型");
  } else if (!rule.mimes.has(mimeType) || !rule.extensions.has(ext)) {
    throw new Error("文件扩展名或 MIME 类型不被允许");
  }
  return { kind: kind as DirectUploadKind, rule };
}

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

// POST /api/media/presign — 创建受控的 R2 暂存上传（仅管理员）
// body: { filename: string, mimeType: string, kind: "image"|"video"|"audio"|"file" }
router.post("/presign", authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { filename, mimeType, kind } = req.body || {};
  if (!isR2Ready()) {
    res.status(400).json({ message: "R2 存储未配置" });
    return;
  }

  try {
    const { kind: approvedKind, rule } = getDirectUploadRule(kind, filename, mimeType);
    const intent = await UploadIntent.create({
      uploaderId: req.user!.id,
      kind: approvedKind,
      filename: path.basename(filename),
      mimeType,
      maxSize: rule.maxSize,
      stagingKey: "pending",
      finalKey: "pending",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const stagingKey = buildStagingKey(intent.id, intent.filename);
    const finalKey = buildObjectKey("media", intent.filename);
    await intent.update({ stagingKey, finalKey });
    const { uploadUrl } = await createPresignedUploadForKey(stagingKey, intent.mimeType);
    res.json({ intentId: intent.id, uploadUrl, expiresIn: 600, maxSize: rule.maxSize });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "获取直传地址失败" });
  }
});

// POST /api/media/confirm — 验证暂存对象、提升到公开路径并登记媒体库
// body: { intentId: string }
router.post("/confirm", authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { intentId } = req.body || {};
  if (typeof intentId !== "string") {
    res.status(400).json({ message: "缺少 intentId 参数" });
    return;
  }

  try {
    const intent = await UploadIntent.findOne({ where: { id: intentId, uploaderId: req.user!.id } });
    if (!intent) {
      res.status(404).json({ message: "上传请求不存在" });
      return;
    }
    if (intent.status === "confirmed") {
      res.status(409).json({ message: "文件已经确认上传" });
      return;
    }
    if (intent.expiresAt.getTime() <= Date.now()) {
      await intent.update({ status: "expired" });
      res.status(410).json({ message: "上传请求已过期，请重新选择文件" });
      return;
    }

    const object = await statR2Object(intent.stagingKey);
    if (!object || object.size <= 0) {
      res.status(400).json({ message: "未找到已上传的文件，请重新上传" });
      return;
    }
    if (object.size > Number(intent.maxSize) || object.contentType !== intent.mimeType) {
      res.status(400).json({ message: "上传文件与已批准的类型或大小不匹配" });
      return;
    }

    const url = await promoteR2Object(intent.stagingKey, intent.finalKey, intent.mimeType);
    const media = await Media.create({
      filename: intent.filename,
      url,
      storageType: "r2",
      mimeType: intent.mimeType,
      size: object.size,
      uploaderId: intent.uploaderId,
    });
    await intent.update({ status: "confirmed", confirmedAt: new Date() });
    const full = await Media.findByPk(media.id, {
      include: [{ model: User, as: "uploader", attributes: ["id", "username", "nickname"] }],
    });
    res.status(201).json(formatMedia(full));
  } catch (err: any) {
    res.status(500).json({ message: err.message || "登记媒体记录失败" });
  }
});

// POST /api/media/live-photo — 将同一管理员上传的图片和视频登记为实况图配对
// body: { imageMediaId: string, videoMediaId: string }
router.post("/live-photo", authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { imageMediaId, videoMediaId } = req.body || {};
  if (typeof imageMediaId !== "string" || typeof videoMediaId !== "string") {
    res.status(400).json({ message: "缺少图片或视频媒体 ID" });
    return;
  }

  const [image, video] = await Promise.all([
    Media.findOne({ where: { id: imageMediaId, uploaderId: req.user!.id } }),
    Media.findOne({ where: { id: videoMediaId, uploaderId: req.user!.id } }),
  ]);
  if (!image || !video || !image.mimeType.startsWith("image/") || !video.mimeType.startsWith("video/")) {
    res.status(400).json({ message: "实况图配对必须使用本人上传的图片和视频" });
    return;
  }

  await Promise.all([
    image.update({ livePhotoVideo: video.url }),
    video.update({ livePhotoImage: image.url }),
  ]);
  res.json({ image: image.url, video: video.url, isLivePhoto: true });
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

    const playlistReference = await MusicTrack.findOne({
      where: { [Op.or]: [{ audioMediaId: media.id }, { coverMediaId: media.id }] },
      attributes: ["id"],
    });
    if (playlistReference) {
      res.status(409).json({ message: "该媒体正在被网站歌单使用，请先从歌单中移除或替换它" });
      return;
    }
    const postReference = await Post.findOne({
      where: { music: { [Op.ne]: null } },
      attributes: ["id", "music"],
    });
    if (postReference) {
      const posts = await Post.findAll({ where: { music: { [Op.ne]: null } }, attributes: ["id", "music"] });
      const usedByPost = posts.some((post) => {
        const music = post.music as any;
        return music?.url === media.url || music?.cover === media.url;
      });
      if (usedByPost) {
        res.status(409).json({ message: "该媒体正在被动态或文章音乐引用，请先移除对应音乐卡片" });
        return;
      }
    }

    // 删除 R2 对象失败不阻塞记录删除
    try {
      await deleteStoredFile(media.url, "r2");
    } catch {
      console.log(`[media] 远端文件删除失败: ${media.url}`);
    }

    await media.destroy();
    res.status(204).send();
  }
);

export default router;
