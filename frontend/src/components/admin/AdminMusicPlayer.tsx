"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SkipBack, SkipForward, ListMusic, X } from "lucide-react";
import { getGlobalAudio } from "@/lib/global-audio";
import { useMusicPlayer } from "@/lib/music-player-store";

/** Admin header player. It shares the global playlist resolver so it never assumes
 * R2 tracks contain durable browser-playable URLs. */
export default function AdminMusicPlayer() {
  const activePostMusic = useMusicPlayer((s) => s.activePostMusic);
  const playlist = useMusicPlayer((s) => s.playlist);
  const currentIndex = useMusicPlayer((s) => s.currentIndex);
  const musicName = useMusicPlayer((s) => s.musicName);
  const musicUrl = useMusicPlayer((s) => s.musicUrl);
  const isPlaying = useMusicPlayer((s) => s.isPlaying);
  const isLoading = useMusicPlayer((s) => s.isLoading);
  const currentLyric = useMusicPlayer((s) => s.currentLyric);
  const clear = useMusicPlayer((s) => s.clear);
  const prepareTrack = useMusicPlayer((s) => s.prepareTrack);

  const [showPlaylist, setShowPlaylist] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isPostMusic = !!activePostMusic;
  const hasPlaylist = !isPostMusic && playlist.length > 1;
  const currentTrack = activePostMusic || playlist[currentIndex];

  useEffect(() => setMounted(true), []);

  const playTrack = async (index: number) => {
    const audio = getGlobalAudio();
    if (!audio || !playlist[index]) return;
    const prepared = await prepareTrack(index);
    if (!prepared) return;
    if (activePostMusic) clear();
    audio.src = prepared.url;
    audio.play().catch(() => useMusicPlayer.getState().setAudioError(true, "播放地址已失效或被音源拒绝，请重试或切换曲目。"));
    setShowPlaylist(false);
  };

  const togglePlay = async () => {
    const audio = getGlobalAudio();
    if (!audio || !currentTrack) return;
    if (audio.paused) {
      let targetUrl = activePostMusic?.url || musicUrl;
      if (!targetUrl && !activePostMusic) {
        const prepared = await prepareTrack(currentIndex);
        if (!prepared) return;
        targetUrl = prepared.url;
      }
      if (!audio.getAttribute("src") || !audio.src.includes(targetUrl)) audio.src = targetUrl;
      audio.play().catch(() => useMusicPlayer.getState().setAudioError(true, "播放地址已失效或被音源拒绝，请重试或切换曲目。"));
    } else {
      audio.pause();
    }
  };

  const skipNext = () => {
    if (playlist.length > 0) void playTrack((currentIndex + 1) % playlist.length);
  };
  const skipPrev = () => {
    if (playlist.length > 0) void playTrack((currentIndex - 1 + playlist.length) % playlist.length);
  };

  if (!currentTrack && !musicName) return null;
  const displayName = currentLyric || activePostMusic?.name || currentTrack?.name || musicName;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        onClick={() => void togglePlay()}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-adm-primary text-adm-primary-text"
        aria-label={isPlaying ? "暂停" : "播放"}
      >
        {isLoading ? (
          <span className="h-3 w-3 rounded-full border-[1.5px] border-adm-primary-text border-t-transparent animate-spin" />
        ) : isPlaying ? (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg className="ml-0.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>

      {hasPlaylist && (
        <button onClick={skipPrev} className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-adm-text-secondary transition-colors hover:text-adm-text md:flex" aria-label="上一首">
          <SkipBack className="h-3.5 w-3.5" />
        </button>
      )}
      {hasPlaylist && (
        <button onClick={skipNext} className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-adm-text-secondary transition-colors hover:text-adm-text md:flex" aria-label="下一首">
          <SkipForward className="h-3.5 w-3.5" />
        </button>
      )}

      <span className="min-w-0 max-w-[100px] truncate text-xs text-adm-text-secondary md:max-w-[200px]">{displayName}</span>

      {!isPostMusic && playlist.length > 0 && (
        <button onClick={() => setShowPlaylist(!showPlaylist)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-adm-text-secondary transition-colors hover:text-adm-text" aria-label="歌单">
          <ListMusic className="h-3.5 w-3.5" />
        </button>
      )}

      {showPlaylist && mounted && createPortal(
        <div className="fixed inset-0 z-50" onClick={() => setShowPlaylist(false)}>
          <div className="absolute right-4 top-14 max-h-80 w-72 overflow-y-auto rounded-xl border border-adm-border bg-adm-card shadow-lg md:right-6 md:top-16" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-adm-border px-4 py-2.5">
              <span className="text-sm font-semibold text-adm-text">播放列表</span>
              <button onClick={() => setShowPlaylist(false)} className="text-adm-text-tertiary transition-colors hover:text-adm-text"><X className="h-4 w-4" /></button>
            </div>
            <div className="py-1">
              {playlist.map((track, index) => (
                <button key={`track-${track.id}-${index}`} onClick={() => void playTrack(index)} className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-adm-card-hover ${index === currentIndex && !isPostMusic ? "text-adm-primary" : "text-adm-text-secondary"}`}>
                  <span className="w-4 shrink-0 text-center text-xs">{index === currentIndex && !isPostMusic && isPlaying ? "♪" : index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{track.name}</span>
                  {track.artist && <span className="shrink-0 text-xs text-adm-text-tertiary">{track.artist}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
