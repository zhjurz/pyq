import { create } from "zustand";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export type MusicResolutionReason = "headers-required" | "no-url" | "unsafe-url" | "request-failed";

export class MusicResolutionError extends Error {
  constructor(public readonly reason: MusicResolutionReason) {
    super(
      reason === "headers-required"
        ? "该音源需要 Referer、Cookie 或 User-Agent 等防盗链请求头，浏览器直连播放无法安全附加这些请求头；请切换音源或上传音频。"
        : "无法获取可直连的播放地址，可能受版权或音源限制。"
    );
    this.name = "MusicResolutionError";
  }
}

export interface SourceMusicIdentity {
  url?: string;
  mp3url?: string;
  source?: string;
  platform?: string;
  id?: string;
  musicId?: string;
  neteaseId?: string;
  songmid?: string;
  extra?: Record<string, unknown>;
}

function appendExtra(params: URLSearchParams, extra?: Record<string, unknown>) {
  if (!extra) return;
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || value === "") continue;
    const valueType = typeof value;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") {
      params.set(key, String(value));
    }
  }
}

/**
 * Resolve one MusicFree item only when it is about to play. Direct URLs are short-lived,
 * and browser <audio> elements cannot attach an upstream source's anti-hotlink headers.
 */
export async function resolveMusicUrl(music: SourceMusicIdentity, refresh = false): Promise<string> {
  const id = music.musicId || music.id || music.neteaseId;
  const platform = music.platform || (music.source === "netease" ? "wy" : "");
  if (platform && id && (music.source === "musicfree" || music.source === "netease" || !music.url && !music.mp3url)) {
    const params = new URLSearchParams({
      platform,
      id: String(id),
      quality: "standard",
    });
    if (refresh) params.set("refresh", "1");
    const extra = { ...(music.extra || {}) };
    if (music.songmid && !extra.songmid) extra.songmid = music.songmid;
    appendExtra(params, extra);

    let response: Response;
    try {
      response = await fetch(`${API_URL}/music/resolve?${params.toString()}`);
    } catch {
      throw new MusicResolutionError("request-failed");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.playable || !data?.url) {
      throw new MusicResolutionError(
        data?.reason === "headers-required" || data?.reason === "unsafe-url" || data?.reason === "no-url"
          ? data.reason
          : "request-failed"
      );
    }
    return data.url;
  }

  const rawUrl = music.url || music.mp3url || "";
  if (!rawUrl) return "";
  if (rawUrl.startsWith("http")) return rawUrl;
  return `${API_URL.replace(/\/api$/, "")}${rawUrl}`;
}

/** 保留旧导出名，供动态/文章音乐卡片复用。 */
export async function resolvePostMusicUrl(music: SourceMusicIdentity, refresh = false): Promise<string> {
  return resolveMusicUrl(music, refresh);
}

/** 动态音乐信息——点击动态音乐卡片后，由顶栏播放器接管播放 */
export interface PostMusicInfo {
  postId: string;
  /** 可直接用于 <audio> src 的 URL（上传音乐或按需解析后的直链） */
  url: string;
  name: string;
  artist: string;
  cover: string;
  /** 网易云歌曲 ID，用于顶栏异步获取歌词 */
  neteaseId: string;
  /** Musicfree 插件 platform（新动态） */
  platform?: string;
  /** Musicfree 歌曲 ID（新动态） */
  musicId?: string;
  /** @deprecated 已并入 extra，保留以兼容旧数据 */
  songmid?: string;
  /** 插件特定字段对象（songmid/hash/bvid 等），透传给后端 /api/music/lyric。 */
  extra?: Record<string, any>;
  /** LRC 歌词文本（上传歌曲透传，顶栏直接解析） */
  lrc?: string;
}

/** 歌单曲目类型。mp3url 为空代表仍需在播放时按需解析。 */
export interface PlaylistTrack {
  id: string;
  name: string;
  artist: string;
  cover: string;
  mp3url: string;
  lyric: string;
  platform?: string;
  /** 插件特定字段（songmid/hash/bvid ...），透传给后端获取歌词/播放地址 */
  extra?: Record<string, any>;
}

/** 解析后的歌词行 */
export interface LyricLine {
  timeMs: number;
  text: string;
}

let trackRequestId = 0;

interface MusicPlayerState {
  activePostId: string | null;
  activePostMusic: PostMusicInfo | null;
  bgMusic: PostMusicInfo | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentLyric: string;

  playlist: PlaylistTrack[];
  currentIndex: number;
  musicUrl: string;
  musicName: string;
  musicId: string;
  lyric: LyricLine[] | null;
  currentLyricIndex: number;
  showLyricPanel: boolean;
  muted: boolean;
  audioError: boolean;
  audioErrorMessage: string;
  musicLoaded: boolean;
  switching: boolean;

  setActive: (postId: string, music: PostMusicInfo) => void;
  clear: () => void;
  setBgMusic: (music: PostMusicInfo | null) => void;
  setPlaying: (playing: boolean) => void;
  setLoading: (loading: boolean) => void;
  setCurrentLyric: (lyric: string) => void;
  initMusic: (data: {
    mp3url: string;
    name: string;
    id: string;
    lyric: LyricLine[] | null;
    playlist: PlaylistTrack[];
    currentIndex: number;
  }) => void;
  /** Resolves a playlist source only when selected, and caches the result on the track. */
  prepareTrack: (index: number) => Promise<{ track: PlaylistTrack; url: string } | null>;
  setLyric: (lyric: LyricLine[] | null) => void;
  setCurrentLyricIndex: (index: number) => void;
  setShowLyricPanel: (show: boolean) => void;
  setMuted: (muted: boolean) => void;
  setAudioError: (error: boolean, message?: string) => void;
  setSwitching: (switching: boolean) => void;
}

export const useMusicPlayer = create<MusicPlayerState>((set, get) => ({
  activePostId: null,
  activePostMusic: null,
  bgMusic: null,
  isPlaying: false,
  isLoading: false,
  currentLyric: "",

  playlist: [],
  currentIndex: 0,
  musicUrl: "",
  musicName: "",
  musicId: "",
  lyric: null,
  currentLyricIndex: -1,
  showLyricPanel: false,
  muted: false,
  audioError: false,
  audioErrorMessage: "",
  musicLoaded: false,
  switching: false,

  setActive: (postId, music) =>
    set({ activePostId: postId, activePostMusic: music, switching: true, audioError: false, audioErrorMessage: "", currentLyric: "", currentLyricIndex: -1 }),
  clear: () =>
    set({
      activePostId: null,
      activePostMusic: null,
      isPlaying: false,
      isLoading: false,
      switching: false,
      audioError: false,
      audioErrorMessage: "",
      currentLyric: "",
      currentLyricIndex: -1,
    }),
  setBgMusic: (music) => set({ bgMusic: music, currentLyric: "" }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setLoading: (loading) => set({ isLoading: loading }),
  setCurrentLyric: (lyric) => set({ currentLyric: lyric }),

  initMusic: (data) => {
    if (get().musicLoaded) return;
    const hasActivePost = !!get().activePostMusic;
    set({
      musicUrl: data.mp3url,
      musicName: data.name,
      musicId: data.id,
      lyric: hasActivePost ? get().lyric : data.lyric,
      playlist: data.playlist,
      currentIndex: data.currentIndex,
      musicLoaded: true,
      switching: false,
    });
  },
  prepareTrack: async (index) => {
    const requestId = ++trackRequestId;
    const track = get().playlist[index];
    if (!track) return null;
    set({ switching: true, isLoading: true, audioError: false, audioErrorMessage: "" });

    try {
      const url = await resolveMusicUrl({
        mp3url: track.mp3url,
        id: track.id,
        platform: track.platform,
        extra: track.extra,
      });
      if (!url) throw new MusicResolutionError("no-url");
      if (requestId !== trackRequestId) return null;

      const resolvedTrack = { ...track, mp3url: url };
      set((state) => ({
        playlist: state.playlist.map((item, itemIndex) => itemIndex === index ? resolvedTrack : item),
        currentIndex: index,
        musicUrl: url,
        musicName: resolvedTrack.name,
        musicId: resolvedTrack.id,
        lyric: null,
        currentLyric: "",
        currentLyricIndex: -1,
        audioError: false,
        audioErrorMessage: "",
      }));
      return { track: resolvedTrack, url };
    } catch (error) {
      if (requestId === trackRequestId) {
        const message = error instanceof Error ? error.message : "无法获取可直连的播放地址。";
        set({ switching: false, isLoading: false, audioError: true, audioErrorMessage: message });
      }
      return null;
    }
  },
  setLyric: (lyric) => set({ lyric }),
  setCurrentLyricIndex: (index) => set({ currentLyricIndex: index }),
  setShowLyricPanel: (show) => set({ showLyricPanel: show }),
  setMuted: (muted) => set({ muted }),
  setAudioError: (error, message = "") => set({ audioError: error, audioErrorMessage: error ? message : "" }),
  setSwitching: (switching) => set({ switching }),
}));
