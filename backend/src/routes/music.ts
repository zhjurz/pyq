/**
 * 音乐路由
 * 基于 MusicFree 插件系统（music-sources/mf-* 模块）。
 * 由后台安装的 MusicFree 插件提供搜索/播放/歌词/歌单/详情等能力；
 * 播放地址由 /stream 端点代理转发，并支持插件返回的防盗链请求头。
 */
import { Router, Request, Response } from "express";
import http from "http";
import https from "https";
import { SiteSetting } from "../models";
import { siteSettingTextDefaults } from "../models/SiteSetting";
import { authenticate, AuthRequest } from "../middleware/auth";
import { getSource, listSources, normalizePlatform } from "../music-sources";
import { ensurePluginsFresh } from "../music-sources/mf-manager";
import type { MusicItem, Quality } from "../music-sources/types";

const router = Router();

// 每个请求前确保插件注册表未超过 TTL 地陈旧（见 mf-manager.ts 顶部注释）。
// 同一函数实例在 TTL 窗口内直接复用内存缓存，不会每个请求都查数据库。
router.use(async (_req, _res, next) => {
  try {
    await ensurePluginsFresh();
  } catch (err) {
    console.error("[music] ensurePluginsFresh failed:", (err as Error).message);
  }
  next();
});

/**
 * 解析 LRC 歌词字符串为 {timeMs, text} 列表。
 * 供前端 TopBar 同步显示用。
 */
export function parseLyric(lrc: string): { timeMs: number; text: string }[] | null {
  if (!lrc) return null;
  const lines = lrc.split("\n");
  const parsed: { timeMs: number; text: string }[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

  for (const line of lines) {
    const times: number[] = [];
    let match;
    while ((match = timeRegex.exec(line)) !== null) {
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const msRaw = match[3];
      const ms = msRaw.length === 2 ? Number(msRaw) * 10 : Number(msRaw);
      times.push(min * 60 * 1000 + sec * 1000 + ms);
    }
    if (times.length === 0) continue;
    const text = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, "").trim();
    for (const timeMs of times) {
      parsed.push({ timeMs, text });
    }
  }

  if (parsed.length === 0) return null;
  parsed.sort((a, b) => a.timeMs - b.timeMs);
  return parsed;
}

async function ensureSetting() {
  const [setting] = await SiteSetting.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1, ...siteSettingTextDefaults },
  });
  return setting;
}

/** 简单 URL 安全校验：仅允许 http/https，禁止 file/ftp/internal metadata */
function isSafeUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 预留的查询参数名，不会被当作音源字段透传。
 * 其余 query 参数全部视为音源特定字段（songmid/hash/bvid/cid ...），
 * 透传给音源 getStreamUrl/getLyric/getInfo。
 */
const RESERVED_QUERY = new Set(["platform", "id", "quality", "url"]);

/**
 * 从请求 query 构造 MusicItem，透传所有音源特定字段。
 */
function buildMusicItem(
  platform: string,
  id: string,
  query: Record<string, any>
): MusicItem {
  const item: MusicItem = { id: String(id), platform };
  for (const [k, v] of Object.entries(query)) {
    if (RESERVED_QUERY.has(k)) continue;
    if (typeof v === "string" && v) {
      item[k] = v;
    }
  }
  return item;
}

/** IMusicItem 上的标准字段（非音源特定）。其余字段视为音源特定，需透传。 */
const STANDARD_FIELDS = new Set([
  "id",
  "platform",
  "title",
  "artist",
  "album",
  "artwork",
  "url",
  "lrc",
  "rawLrc",
  "duration",
]);

/** 从 MusicItem 提取所有音源特定字段（songmid/hash/bvid/cid 等）。
 *  只保留原始类型（string/number/boolean），跳过对象/数组，避免 URL 中出现 [object Object]。 */
function extractExtraFields(track: MusicItem): Record<string, any> {
  const extra: Record<string, any> = {};
  for (const [k, v] of Object.entries(track)) {
    if (STANDARD_FIELDS.has(k)) continue;
    if (v == null || v === "") continue;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") {
      extra[k] = v;
    }
  }
  return extra;
}

/** 流式代理 URL（仅非 Vercel 且显式开启 ALLOW_AUDIO_PROXY 时的兼容路径）。 */
function toStreamUrl(
  platform: string,
  id: string,
  extra?: Record<string, any>
): string {
  const params = new URLSearchParams({
    platform: String(platform),
    id: String(id),
  });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v != null && v !== "") {
        params.set(k, String(v));
      }
    }
  }
  return `/api/music/stream?${params.toString()}`;
}

interface DirectResolution {
  playable: boolean;
  mode: "direct" | "unsupported";
  url?: string;
  reason?: "no-url" | "headers-required" | "unsafe-url";
}

interface CacheEntry {
  resolution: DirectResolution;
  expireAt: number;
}
const mediaCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;

function getResolutionCache(key: string): DirectResolution | null {
  const entry = mediaCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expireAt) {
    mediaCache.delete(key);
    return null;
  }
  return entry.resolution;
}

function setResolutionCache(key: string, resolution: DirectResolution): void {
  mediaCache.set(key, { resolution, expireAt: Date.now() + CACHE_TTL });
}

function directUrl(url: string): string | null {
  if (!isSafeUrl(url)) return null;
  try {
    const parsed = new URL(url);
    // HTTPS 页面不可播放 HTTP 混合内容；常见音源域名支持 HTTPS 时优先升级。
    if (parsed.protocol === "http:") parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
}

async function resolveDirectMedia(
  source: ReturnType<typeof getSource>,
  item: MusicItem,
  quality: Quality,
  refresh = false
): Promise<DirectResolution> {
  if (!source) return { playable: false, mode: "unsupported", reason: "no-url" };
  const extras = extractExtraFields(item);
  const cacheKey = `${source.code}:${item.id}:${quality}:${JSON.stringify(extras)}`;
  if (!refresh) {
    const cached = getResolutionCache(cacheKey);
    if (cached) return cached;
  }

  try {
    const result = await source.getStreamUrl(item, quality);
    const hasHeaders = !!result?.userAgent || Object.keys(result?.headers || {}).length > 0;
    const url = result?.url ? directUrl(result.url) : null;
    const resolution: DirectResolution = hasHeaders
      ? { playable: false, mode: "unsupported", reason: "headers-required" }
      : url
        ? { playable: true, mode: "direct", url }
        : { playable: false, mode: "unsupported", reason: result?.url ? "unsafe-url" : "no-url" };
    setResolutionCache(cacheKey, resolution);
    return resolution;
  } catch (err) {
    console.error("[music] direct resolve error:", err);
    return { playable: false, mode: "unsupported", reason: "no-url" };
  }
}

// GET /api/music/sources — 列出所有内嵌音源（前端 PublishModal 用）
router.get("/sources", async (_req: Request, res: Response) => {
  res.json(
    listSources().map((s) => ({
      platform: s.code,
      name: s.name,
      primaryKey: s.primaryKey,
    }))
  );
});

// GET /api/music/search — 搜索歌曲（需登录）
router.get("/search", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const platform = String(req.query.platform || "");
    const keyword = String(req.query.keyword || "");
    const page = Math.max(1, Number(req.query.page) || 1);
    const type = String(req.query.type || "music");

    if (!platform || !keyword) {
      res.status(400).json({ message: "请提供 platform 和 keyword 参数" });
      return;
    }

    const source = getSource(platform);
    if (!source) {
      res.status(404).json({ message: "未找到对应音源" });
      return;
    }

    const result = await source.search(keyword, page, type);
    const data = (result?.data || []).map((m) => ({
      ...m,
      platform: source.code,
    }));
    res.json({ isEnd: result?.isEnd ?? true, data });
  } catch (err) {
    console.error("[music] search error:", err);
    res.status(500).json({ message: "搜索失败" });
  }
});

// GET /api/music/lyric — 获取歌词（公开，播放时调用）
router.get("/lyric", async (req: Request, res: Response) => {
  try {
    const platform = String(req.query.platform || "");
    const id = String(req.query.id || "");
    if (!platform || !id) {
      res.status(400).json({ message: "请提供 platform 和 id 参数" });
      return;
    }

    const source = getSource(platform);
    if (!source) {
      res.status(404).json({ message: "未找到对应音源" });
      return;
    }

    const musicItem = buildMusicItem(source.code, id, req.query);
    const result = await source.getLyric(musicItem);
    res.json({
      rawLrc: result?.rawLrc || "",
      translation: result?.translation || "",
    });
  } catch (err) {
    // 歌词失败不阻断播放
    console.error("[music] lyric error:", err);
    res.json({ rawLrc: "", translation: "" });
  }
});

// POST /api/music/import-sheet — 导入歌单（需登录）
router.post("/import-sheet", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { url, platform } = req.body;
    if (!url || !platform) {
      res.status(400).json({ message: "请提供 url 和 platform" });
      return;
    }

    const source = getSource(String(platform));
    if (!source) {
      res.status(404).json({ message: "未找到对应音源" });
      return;
    }

    const tracks = await source.importPlaylist(String(url));
    const data = (tracks || []).map((m) => ({ ...m, platform: source.code }));
    res.json({ data });
  } catch (err) {
    console.error("[music] import-sheet error:", err);
    res.status(500).json({ message: "导入歌单失败" });
  }
});

// GET /api/music/resolve — 仅解析直连播放地址，不代理任何音频字节
router.get("/resolve", async (req: Request, res: Response) => {
  const platform = String(req.query.platform || "");
  const id = String(req.query.id || "");
  const quality = String(req.query.quality || "standard") as Quality;
  if (!platform || !id) {
    res.status(400).json({ message: "请提供 platform 和 id 参数" });
    return;
  }
  const source = getSource(platform);
  if (!source) {
    res.status(404).json({ message: "未找到对应音源" });
    return;
  }
  const item = buildMusicItem(source.code, id, req.query);
  const resolution = await resolveDirectMedia(source, item, quality, req.query.refresh === "1");
  res.json({ ...resolution, platform: source.code, id });
});

// GET /api/music/stream — 仅供非 Vercel 的显式兼容部署使用。
// Vercel 生产环境严禁音频经过函数，前端应使用 /api/music/resolve 返回的直链。
router.get("/stream", async (req: Request, res: Response) => {
  if (process.env.VERCEL || process.env.ALLOW_AUDIO_PROXY !== "true") {
    res.status(410).json({ message: "当前部署禁止音频代理，请使用直连音源" });
    return;
  }
  const platform = String(req.query.platform || "");
  const id = String(req.query.id || "");
  const quality: Quality = (String(req.query.quality || "standard") as Quality);
  const directUrl = String(req.query.url || "");

  let targetUrl = "";
  let headers: Record<string, string> = {};

  if (platform && id) {
    const source = getSource(platform);
    if (!source) {
      res.status(404).json({ message: "未找到对应音源" });
      return;
    }

    const musicItem = buildMusicItem(source.code, id, req.query);
    const resolution = await resolveDirectMedia(source, musicItem, quality);
    if (!resolution.playable || !resolution.url) {
      res.status(404).json({ message: "该音源无法通过直连方式播放" });
      return;
    }
    targetUrl = resolution.url;
  } else if (directUrl) {
    targetUrl = directUrl;
    headers["User-Agent"] =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  } else {
    res.status(400).json({ message: "缺少 platform+id 或 url 参数" });
    return;
  }

  if (!isSafeUrl(targetUrl)) {
    res.status(403).json({ message: "不允许的目标地址" });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.status(400).json({ message: "无效的 URL" });
    return;
  }

  const requestModule = parsed.protocol === "https:" ? https : http;
  if (req.headers.range) {
    headers["Range"] = req.headers.range;
  }

  const proxyReq = requestModule.request(
    parsed,
    { method: "GET", headers },
    (proxyRes) => {
      res.status(proxyRes.statusCode || 200);
      const headersToForward = [
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control",
      ];
      for (const h of headersToForward) {
        const val = proxyRes.headers[h];
        if (val) res.setHeader(h, val);
      }
      // 上游可能返回非音频 content-type（如 application/x-www-form-urlencoded），
      // 浏览器 <audio> 会拒绝播放。强制设为 audio/mpeg。
      const ct = proxyRes.headers["content-type"];
      if (ct && (ct.startsWith("audio/") || ct.startsWith("video/"))) {
        res.setHeader("content-type", ct);
      } else {
        res.setHeader("content-type", "audio/mpeg");
      }
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    console.error("[music] stream proxy error:", err);
    if (!res.headersSent) {
      res.status(502).json({ message: "音频代理失败" });
    }
  });

  proxyReq.end();
});

// GET /api/music — 顶栏背景音乐
// 优先级：playlistId(importPlaylist) > musicId(getStreamUrl+元数据) > musicUrl(直链)
router.get("/", async (_req: Request, res: Response) => {
  try {
    const setting = await ensureSetting();
    const category = setting.musicSource || "wy";
    const source = getSource(category);

    // 无可用音源时回退到自定义 URL
    if (!source) {
      if (setting.musicUrl) {
        res.json({
          name: "音乐",
          mp3url: setting.musicUrl,
          cover: "",
          author: "",
          lyric: "",
        });
        return;
      }
      res.json({ name: "", mp3url: "", cover: "", author: "", lyric: "" });
      return;
    }

    // 优先级 1：playlistId — 导入歌单
    if (setting.playlistId) {
      try {
        const tracks = await source.importPlaylist(setting.playlistId);
        if (tracks && tracks.length > 0) {
          const first = tracks[0];
          const playlist = await Promise.all(tracks.map(async (t) => {
            const extra = extractExtraFields(t);
            const item: MusicItem = { ...t, id: String(t.id || ""), platform: source.code };
            const resolution = await resolveDirectMedia(source, item, "standard");
            return {
              id: String(t.id || ""),
              name: t.title || "音乐",
              artist: t.artist || "",
              cover: t.artwork || "",
              mp3url: resolution.url || "",
              playable: resolution.playable,
              reason: resolution.reason,
              lyric: t.rawLrc || t.lrc || "",
              platform: source.code,
              extra,
            };
          }));
          const firstExtra = extractExtraFields(first);
          const firstResolution = await resolveDirectMedia(
            source,
            { ...first, id: String(first.id || ""), platform: source.code },
            "standard"
          );
          res.json({
            name: first.title || "音乐",
            mp3url: firstResolution.url || "",
            playable: firstResolution.playable,
            reason: firstResolution.reason,
            cover: first.artwork || "",
            author: first.artist || "",
            lyric: first.rawLrc || first.lrc || "",
            id: String(first.id),
            platform: source.code,
            extra: firstExtra,
            playlist,
            currentIndex: 0,
          });
          return;
        }
      } catch (err) {
        console.error("[music] importPlaylist error:", err);
        // fall through to musicId
      }
    }

    // 优先级 2：musicId — 单曲
    if (setting.musicId) {
      try {
        const musicItem: MusicItem = { id: setting.musicId, platform: source.code };
        const [, info, lyricResult] = await Promise.all([
          resolveDirectMedia(source, musicItem, "standard"),
          source.getInfo(musicItem).catch(() => ({})),
          source.getLyric(musicItem).catch(() => ({ rawLrc: "" })),
        ]);

        const resolution = await resolveDirectMedia(source, musicItem, "standard");
        if (resolution.playable && resolution.url) {
          res.json({
            name: (info as any)?.title || "",
            mp3url: resolution.url,
            playable: true,
            cover: (info as any)?.artwork || "",
            author: (info as any)?.artist || "",
            lyric: (lyricResult as any)?.rawLrc || "",
            id: setting.musicId,
          });
          return;
        }
      } catch (err) {
        console.error("[music] musicId resolve error:", err);
        // fall through to musicUrl
      }
    }

    // 优先级 3：自定义 URL
    if (setting.musicUrl) {
      res.json({
        name: "音乐",
        mp3url: setting.musicUrl,
        cover: "",
        author: "",
        lyric: "",
      });
      return;
    }

    res.json({ name: "", mp3url: "", cover: "", author: "", lyric: "" });
  } catch (err) {
    console.error("[music] GET / error:", err);
    try {
      const setting = await ensureSetting();
      if (setting.musicUrl) {
        res.json({
          name: "音乐",
          mp3url: setting.musicUrl,
          cover: "",
          author: "",
          lyric: "",
        });
        return;
      }
    } catch {
      // ignore
    }
    res.status(500).json({ message: "获取音乐失败" });
  }
});

// POST /api/music/preview — 预览歌曲（博主发动态/设置页用）
// body: { id, platform?, extra?, title?, artist?, artwork?, album? }
// 无 platform 时走 wy（旧数据兼容）
router.post("/preview", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id, platform, extra, title, artist, artwork, album } = req.body;
    if (!id) {
      res.status(400).json({ message: "请提供歌曲 ID" });
      return;
    }

    const code = platform ? normalizePlatform(String(platform)) : "wy";
    const source = getSource(code);
    if (!source) {
      res.status(404).json({ message: "未找到可用音源" });
      return;
    }

    // 透传所有音源特定字段 + 搜索结果元数据（title/artist/artwork 作为 getInfo 回退）
    const musicItem: MusicItem = {
      id: String(id),
      platform: source.code,
      ...(title ? { title: String(title) } : {}),
      ...(artist ? { artist: String(artist) } : {}),
      ...(artwork ? { artwork: String(artwork) } : {}),
      ...(album ? { album: String(album) } : {}),
      ...(extra && typeof extra === "object" ? extra : {}),
    };

    const [info, lyricResult, resolution] = await Promise.all([
      source.getInfo(musicItem).catch(() => ({})),
      source.getLyric(musicItem).catch(() => ({ rawLrc: "" })),
      resolveDirectMedia(source, musicItem, "standard"),
    ]);

    const resultExtra = extractExtraFields(musicItem);

    res.json({
      name: (info as any)?.title || title || "",
      author: (info as any)?.artist || artist || "",
      cover: (info as any)?.artwork || artwork || "",
      mp3url: resolution.url || "",
      lyric: (lyricResult as any)?.rawLrc || "",
      tlyric: (lyricResult as any)?.translation || "",
      playable: resolution.playable,
      playbackMode: resolution.mode,
      reason: resolution.reason,
      platform: source.code,
      musicId: String(id),
      extra: resultExtra,
    });
  } catch (err) {
    console.error("[music] preview error:", err);
    res.status(500).json({ message: "获取歌曲失败" });
  }
});

// GET /api/music/playlist — 通过音源导入歌单（旧前端调用兼容）
router.get("/playlist", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.query.id || "").trim();
    const platform = String(req.query.platform || "");
    if (!id) {
      res.status(400).json({ message: "请提供歌单 ID" });
      return;
    }

    const source = platform ? getSource(platform) : getSource("wy");
    if (!source) {
      res.status(404).json({ message: "未找到对应音源" });
      return;
    }

    const tracks = await source.importPlaylist(id);
    const data = await Promise.all((tracks || []).map(async (t) => {
      const extra = extractExtraFields(t);
      const item: MusicItem = { ...t, id: String(t.id || ""), platform: source.code };
      const resolution = await resolveDirectMedia(source, item, "standard");
      return {
        id: String(t.id || ""),
        name: t.title || "音乐",
        artist: t.artist || "",
        cover: t.artwork || "",
        mp3url: resolution.url || "",
        playable: resolution.playable,
        reason: resolution.reason,
        lyric: t.rawLrc || t.lrc || "",
        platform: source.code,
        extra,
      };
    }));
    res.json({ tracks: data });
  } catch (err) {
    console.error("[music] playlist error:", err);
    res.status(500).json({ message: "获取歌单失败" });
  }
});

export default router;
