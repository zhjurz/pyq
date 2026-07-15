"use client";

import { useEffect, useRef } from "react";
import { getGlobalAudio } from "@/lib/global-audio";
import { useMusicPlayer, type LyricLine, type PlaylistTrack } from "@/lib/music-player-store";
import { useSiteSettings } from "@/lib/site-settings-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";
const AUDIO_BASE = API_URL.replace(/\/api$/, "");

function toAbsolute(url: string): string {
  if (!url || typeof url !== "string") return "";
  return url.startsWith("http") ? url : `${AUDIO_BASE}${url}`;
}

function parseLyric(lrc: string): LyricLine[] | null {
  if (!lrc) return null;
  const parsed: LyricLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
  for (const line of lrc.split("\n")) {
    const times: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = timeRegex.exec(line)) !== null) {
      const ms = match[3].length === 2 ? Number(match[3]) * 10 : Number(match[3]);
      times.push(Number(match[1]) * 60_000 + Number(match[2]) * 1_000 + ms);
    }
    const text = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, "").trim();
    times.forEach((timeMs) => parsed.push({ timeMs, text }));
  }
  return parsed.length ? parsed.sort((a, b) => a.timeMs - b.timeMs) : null;
}

/** Owns the shared R2 audio element and site-wide static playlist state. */
export default function GlobalMusicManager() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    Promise.all([
      fetch(`${API_URL}/music`).then((response) => (response.ok ? response.json() : {})),
      useSiteSettings.getState().fetchSettings(),
    ])
      .then(([data]: [{ mp3url?: string; name?: string; id?: string; lyric?: string; playlist?: PlaylistTrack[]; currentIndex?: number; musicAutoplay?: boolean }, void]) => {
        const playlist = Array.isArray(data.playlist)
          ? data.playlist.map((track) => ({ ...track, mp3url: toAbsolute(track.mp3url) }))
          : [];
        const first = playlist[data.currentIndex || 0];
        const musicUrl = toAbsolute(data.mp3url || first?.mp3url || "");
        if (!musicUrl && playlist.length === 0) {
          useMusicPlayer.setState({ musicLoaded: true, switching: false });
          return;
        }
        useMusicPlayer.getState().initMusic({
          mp3url: musicUrl,
          name: data.name || first?.name || "",
          id: data.id || first?.id || "",
          lyric: parseLyric(data.lyric || first?.lyric || first?.lrc || ""),
          playlist,
          currentIndex: data.currentIndex || 0,
        });
        if ((data.musicAutoplay ?? useSiteSettings.getState().musicAutoplay) && musicUrl) {
          const audio = getGlobalAudio();
          if (audio) {
            audio.src = musicUrl;
            audio.play().catch(() => undefined);
          }
        }
      })
      .catch(() => useMusicPlayer.setState({ musicLoaded: true, switching: false }));
  }, []);

  useEffect(() => {
    const audio = getGlobalAudio();
    if (!audio) return;
    const onLoadStart = () => {
      const state = useMusicPlayer.getState();
      state.setSwitching(true);
      state.setLoading(true);
      state.setAudioError(false);
    };
    const onCanPlay = () => {
      const state = useMusicPlayer.getState();
      state.setSwitching(false);
      state.setLoading(false);
    };
    const onPlay = () => {
      const state = useMusicPlayer.getState();
      state.setPlaying(true);
      state.setLoading(false);
      state.setSwitching(false);
      state.setAudioError(false);
    };
    const onPause = () => useMusicPlayer.getState().setPlaying(false);
    const playTrack = (index: number, shouldPlay: boolean) => {
      const prepared = useMusicPlayer.getState().prepareTrack(index);
      if (!prepared) return false;
      audio.src = prepared.url;
      if (shouldPlay) audio.play().catch(() => useMusicPlayer.getState().setAudioError(true, "R2 音频文件无法播放，请稍后重试。"));
      else audio.load();
      return true;
    };
    const onEnded = () => {
      const state = useMusicPlayer.getState();
      if (state.activePostMusic) {
        state.clear();
        if (state.playlist.length) playTrack(state.currentIndex, false);
        return;
      }
      if (state.playlist.length) playTrack((state.currentIndex + 1) % state.playlist.length, true);
    };
    const onError = () => {
      const state = useMusicPlayer.getState();
      state.setSwitching(false);
      state.setLoading(false);
      state.setPlaying(false);
      state.setAudioError(true, "R2 音频文件无法播放，请确认文件未被删除。");
    };
    const onWaiting = () => useMusicPlayer.getState().setLoading(true);
    const onPlaying = () => useMusicPlayer.getState().setLoading(false);
    const onTimeUpdate = () => {
      const state = useMusicPlayer.getState();
      const lines = state.lyric;
      if (!lines?.length) return;
      const time = audio.currentTime * 1000;
      let currentIndex = -1;
      for (let index = lines.length - 1; index >= 0; index--) {
        if (lines[index].timeMs <= time) { currentIndex = index; break; }
      }
      const current = currentIndex >= 0 ? lines[currentIndex].text : "";
      if (state.currentLyric !== current) state.setCurrentLyric(current);
      if (state.currentLyricIndex !== currentIndex) state.setCurrentLyricIndex(currentIndex);
    };
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, []);

  const activePostMusic = useMusicPlayer((state) => state.activePostMusic);
  const playlist = useMusicPlayer((state) => state.playlist);
  const currentIndex = useMusicPlayer((state) => state.currentIndex);
  useEffect(() => {
    const track = activePostMusic || playlist[currentIndex];
    const state = useMusicPlayer.getState();
    state.setLyric(parseLyric(track?.lrc || track?.lyric || ""));
    state.setCurrentLyric("");
    state.setCurrentLyricIndex(-1);
  }, [activePostMusic, playlist, currentIndex]);

  return null;
}
