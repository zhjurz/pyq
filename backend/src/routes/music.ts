import { Router, Request, Response } from "express";
import { Op } from "sequelize";
import { Media, MusicPlaylist, MusicTrack, SiteSetting, sequelize } from "../models";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";

const router = Router();
const DEFAULT_PLAYLIST_SLUG = "site-default";

async function getDefaultPlaylist() {
  const [playlist] = await MusicPlaylist.findOrCreate({
    where: { slug: DEFAULT_PLAYLIST_SLUG },
    defaults: { slug: DEFAULT_PLAYLIST_SLUG, name: "网站歌单" },
  });
  return playlist;
}

function serializeTrack(track: MusicTrack & { audio?: Media; cover?: Media }) {
  const audio = track.audio;
  const cover = track.cover;
  return {
    id: track.id,
    audioMediaId: track.audioMediaId,
    coverMediaId: track.coverMediaId,
    name: track.title,
    title: track.title,
    artist: track.artist,
    mp3url: audio?.url || "",
    audioUrl: audio?.url || "",
    cover: cover?.url || "",
    lrc: track.lrc,
    lyric: track.lrc,
    sortOrder: track.sortOrder,
  };
}

async function loadDefaultPlaylist() {
  const playlist = await getDefaultPlaylist();
  const tracks = await MusicTrack.findAll({
    where: { playlistId: playlist.id },
    include: [
      { model: Media, as: "audio", required: true },
      { model: Media, as: "cover", required: false },
    ],
    order: [["sortOrder", "ASC"], ["createdAt", "ASC"]],
  });
  return { playlist, tracks: tracks as Array<MusicTrack & { audio?: Media; cover?: Media }> };
}

async function getOwnedMedia(id: unknown, userId: string, category: "audio" | "image") {
  if (typeof id !== "string") return null;
  const media = await Media.findOne({ where: { id, uploaderId: userId, storageType: "r2" } });
  if (!media || !media.mimeType.startsWith(`${category}/`)) return null;
  return media;
}

function readText(value: unknown, field: string, maxLength: number, required = false) {
  if (value == null && !required) return undefined;
  if (typeof value !== "string") throw new Error(`${field} 格式无效`);
  const text = value.trim();
  if (required && !text) throw new Error(`${field} 不能为空`);
  if (text.length > maxLength) throw new Error(`${field} 过长`);
  return text;
}

// GET /api/music — public R2-only background playlist.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const { playlist, tracks } = await loadDefaultPlaylist();
    const data = tracks.map(serializeTrack).filter((track) => track.mp3url);
    const first = data[0];
    const [setting] = await SiteSetting.findOrCreate({ where: { id: 1 }, defaults: { id: 1, backgroundImages: "[]", emailTemplate: "", socialLinks: "[]" } });
    res.json({
      id: playlist.id,
      name: first?.name || "",
      author: first?.artist || "",
      cover: first?.cover || "",
      mp3url: first?.mp3url || "",
      lyric: first?.lyric || "",
      playlist: data,
      currentIndex: 0,
      musicAutoplay: setting.musicAutoplay,
    });
  } catch (err) {
    console.error("[music] get playlist error:", err);
    res.status(500).json({ message: "获取歌单失败" });
  }
});

// GET /api/music/admin — full editable default playlist.
router.get("/admin", authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const [{ playlist, tracks }, setting] = await Promise.all([
      loadDefaultPlaylist(),
      SiteSetting.findOrCreate({ where: { id: 1 }, defaults: { id: 1, backgroundImages: "[]", emailTemplate: "", socialLinks: "[]" } }).then(([item]) => item),
    ]);
    res.json({ id: playlist.id, name: playlist.name, tracks: tracks.map(serializeTrack), musicAutoplay: setting.musicAutoplay });
  } catch (err) {
    console.error("[music] get admin playlist error:", err);
    res.status(500).json({ message: "获取歌单失败" });
  }
});

// PUT /api/music/admin — rename the default playlist or change autoplay.
router.put("/admin", authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const name = req.body?.name === undefined ? undefined : readText(req.body.name, "歌单名称", 100, true);
    if (req.body?.musicAutoplay !== undefined && typeof req.body.musicAutoplay !== "boolean") throw new Error("自动播放设置格式无效");
    const [playlist, setting] = await Promise.all([
      getDefaultPlaylist(),
      SiteSetting.findOrCreate({ where: { id: 1 }, defaults: { id: 1, backgroundImages: "[]", emailTemplate: "", socialLinks: "[]" } }).then(([item]) => item),
    ]);
    if (name !== undefined) await playlist.update({ name });
    if (req.body?.musicAutoplay !== undefined) await setting.update({ musicAutoplay: req.body.musicAutoplay });
    res.json({ id: playlist.id, name: playlist.name, musicAutoplay: setting.musicAutoplay });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "更新歌单失败" });
  }
});

// POST /api/music/admin/tracks — attach existing R2 media as a playlist item.
router.post("/admin/tracks", authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const audio = await getOwnedMedia(req.body?.audioMediaId, req.user!.id, "audio");
    if (!audio) {
      res.status(400).json({ message: "请选择本人上传的 R2 音频文件" });
      return;
    }
    const coverMediaId = req.body?.coverMediaId;
    const cover = coverMediaId == null || coverMediaId === "" ? null : await getOwnedMedia(coverMediaId, req.user!.id, "image");
    if (coverMediaId && !cover) {
      res.status(400).json({ message: "封面必须是本人上传的 R2 图片" });
      return;
    }
    const title = readText(req.body?.title, "歌曲名称", 255, false) || audio.filename.replace(/\.[^.]+$/, "") || "未命名歌曲";
    const artist = readText(req.body?.artist, "歌手", 255, false) || "";
    const lrc = readText(req.body?.lrc, "歌词", 100_000, false) || "";
    const playlist = await getDefaultPlaylist();
    const maxOrder = await MusicTrack.max("sortOrder", { where: { playlistId: playlist.id } });
    const track = await MusicTrack.create({
      playlistId: playlist.id,
      audioMediaId: audio.id,
      coverMediaId: cover?.id || null,
      title,
      artist,
      lrc,
      sortOrder: Number.isFinite(maxOrder) ? Number(maxOrder) + 1 : 0,
    });
    const full = await MusicTrack.findByPk(track.id, {
      include: [{ model: Media, as: "audio" }, { model: Media, as: "cover", required: false }],
    });
    res.status(201).json(serializeTrack(full as MusicTrack & { audio?: Media; cover?: Media }));
  } catch (err: any) {
    res.status(400).json({ message: err.message || "添加歌曲失败" });
  }
});

// PATCH /api/music/admin/tracks/:id — update playlist metadata or replace owned R2 media.
router.patch("/admin/tracks/:id", authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const playlist = await getDefaultPlaylist();
    const track = await MusicTrack.findOne({ where: { id: String(req.params.id), playlistId: playlist.id } });
    if (!track) {
      res.status(404).json({ message: "歌曲不存在" });
      return;
    }
    const updates: Partial<Pick<MusicTrack, "audioMediaId" | "coverMediaId" | "title" | "artist" | "lrc">> = {};
    if (req.body?.audioMediaId !== undefined) {
      const audio = await getOwnedMedia(req.body.audioMediaId, req.user!.id, "audio");
      if (!audio) {
        res.status(400).json({ message: "请选择本人上传的 R2 音频文件" });
        return;
      }
      updates.audioMediaId = audio.id;
    }
    if (req.body?.coverMediaId !== undefined) {
      if (!req.body.coverMediaId) updates.coverMediaId = null;
      else {
        const cover = await getOwnedMedia(req.body.coverMediaId, req.user!.id, "image");
        if (!cover) {
          res.status(400).json({ message: "封面必须是本人上传的 R2 图片" });
          return;
        }
        updates.coverMediaId = cover.id;
      }
    }
    const title = readText(req.body?.title, "歌曲名称", 255);
    const artist = readText(req.body?.artist, "歌手", 255);
    const lrc = readText(req.body?.lrc, "歌词", 100_000);
    if (title !== undefined) updates.title = title || "未命名歌曲";
    if (artist !== undefined) updates.artist = artist;
    if (lrc !== undefined) updates.lrc = lrc;
    await track.update(updates);
    const full = await MusicTrack.findByPk(track.id, {
      include: [{ model: Media, as: "audio" }, { model: Media, as: "cover", required: false }],
    });
    res.json(serializeTrack(full as MusicTrack & { audio?: Media; cover?: Media }));
  } catch (err: any) {
    res.status(400).json({ message: err.message || "更新歌曲失败" });
  }
});

// PUT /api/music/admin/order — accept an exact ordered permutation of the current track IDs.
router.put("/admin/order", authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const ids = req.body?.trackIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    res.status(400).json({ message: "trackIds 必须是歌曲 ID 数组" });
    return;
  }
  const transaction = await sequelize.transaction();
  try {
    const playlist = await getDefaultPlaylist();
    const tracks = await MusicTrack.findAll({ where: { playlistId: playlist.id }, transaction, lock: transaction.LOCK.UPDATE });
    const existing = new Set(tracks.map((track) => track.id));
    if (ids.length !== tracks.length || new Set(ids).size !== ids.length || ids.some((id) => !existing.has(id))) {
      await transaction.rollback();
      res.status(400).json({ message: "排序列表必须包含当前歌单中的全部歌曲且不能重复" });
      return;
    }
    // Avoid the unique (playlist_id, sort_order) index while swapping positions.
    await Promise.all(tracks.map((track, index) => track.update({ sortOrder: -1 - index }, { transaction })));
    await Promise.all(ids.map((id, index) => MusicTrack.update({ sortOrder: index }, { where: { id }, transaction })));
    await transaction.commit();
    res.json({ success: true });
  } catch (err) {
    await transaction.rollback();
    console.error("[music] reorder error:", err);
    res.status(500).json({ message: "保存排序失败" });
  }
});

router.delete("/admin/tracks/:id", authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const playlist = await getDefaultPlaylist();
  const track = await MusicTrack.findOne({ where: { id: String(req.params.id), playlistId: playlist.id } });
  if (!track) {
    res.status(404).json({ message: "歌曲不存在" });
    return;
  }
  await track.destroy();
  res.status(204).send();
});

export async function isMediaUsedByPlaylist(mediaId: string) {
  return MusicTrack.findOne({
    where: { [Op.or]: [{ audioMediaId: mediaId }, { coverMediaId: mediaId }] },
    attributes: ["id"],
  });
}

export default router;
