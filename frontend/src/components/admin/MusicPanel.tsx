"use client";

import { useEffect, useState } from "react";
import { Loader2, X, Music, Upload, ImagePlus } from "lucide-react";
import type { PostMusic } from "@/lib/mock-data";
import { uploadAudio, uploadImage, toAbsoluteUrl } from "@/lib/upload";
import LyricEditor from "@/components/LyricEditor";
import AdminModal from "./AdminModal";

interface MusicPanelProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (music: PostMusic) => void;
  initial?: PostMusic | null;
  token: string;
}

/** R2-uploaded audio picker for posts and articles. External sources and URLs are intentionally unsupported. */
export default function MusicPanel({ open, onClose, onConfirm, initial, token }: MusicPanelProps) {
  const [name, setName] = useState("");
  const [artist, setArtist] = useState("");
  const [cover, setCover] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioName, setAudioName] = useState("");
  const [lrc, setLrc] = useState("");
  const [showLyric, setShowLyric] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initial?.name || "");
    setArtist(initial?.artist || "");
    setCover(initial?.cover || "");
    setAudioUrl(initial?.url || "");
    setAudioName(initial?.name || "");
    setLrc(initial?.lrc || "");
    setAutoplay(initial?.autoplay || false);
    setError("");
  }, [open, initial]);

  const handleUploadAudio = async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    setUploadingAudio(true);
    setError("");
    try {
      const url = await uploadAudio(file, token);
      setAudioUrl(url);
      setAudioName(file.name);
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "音频上传失败");
    } finally {
      setUploadingAudio(false);
    }
  };

  const handleUploadCover = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingCover(true);
    setError("");
    try {
      setCover(await uploadImage(files[0], token));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "封面上传失败");
    } finally {
      setUploadingCover(false);
    }
  };

  const confirm = () => {
    if (!audioUrl) {
      setError("请先上传 R2 音频文件");
      return;
    }
    onConfirm({
      name: name.trim() || audioName.replace(/\.[^.]+$/, "") || "未命名歌曲",
      artist: artist.trim(),
      cover,
      url: audioUrl,
      source: "upload",
      lrc: lrc || undefined,
      autoplay,
    });
  };

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={initial ? "编辑 R2 音频" : "添加 R2 音频"}
      footer={<>
        <button type="button" onClick={onClose} className="rounded-lg border border-adm-border px-4 py-2 text-sm text-adm-text-secondary transition-colors hover:bg-adm-card-hover">取消</button>
        <button type="button" onClick={confirm} disabled={!audioUrl} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40 dark:bg-white dark:text-gray-900">确认</button>
      </>}
    >
      {error && <p className="mb-3 text-xs text-red-500">{error}</p>}
      <div className="mb-4 flex cursor-pointer items-center justify-between rounded-lg bg-adm-input px-3 py-2" onClick={() => setAutoplay((value) => !value)}>
        <span className="text-xs font-medium text-adm-text-secondary">进入文章自动播放</span>
        <span role="switch" aria-checked={autoplay} className={`relative h-5 w-9 rounded-full ${autoplay ? "bg-gray-900 dark:bg-white" : "bg-gray-300 dark:bg-gray-600"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${autoplay ? "translate-x-4" : "translate-x-0.5"}`} /></span>
      </div>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-adm-text-secondary">R2 音频文件</label>
          {audioUrl ? (
            <div className="flex items-center justify-between rounded-lg border border-adm-border bg-adm-input px-3 py-2.5"><div className="flex min-w-0 items-center gap-2"><Music className="h-4 w-4 shrink-0 text-adm-text-tertiary" /><span className="truncate text-sm text-adm-text">{audioName || name || "R2 音频已上传"}</span></div><label className="cursor-pointer text-xs text-adm-text-secondary hover:text-adm-text">重新上传<input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac" className="hidden" onChange={(event) => { void handleUploadAudio(event.target.files); event.target.value = ""; }} /></label></div>
          ) : <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-adm-border py-6 transition-colors hover:border-gray-400"><input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac" className="hidden" onChange={(event) => { void handleUploadAudio(event.target.files); event.target.value = ""; }} />{uploadingAudio ? <Loader2 className="h-8 w-8 animate-spin text-adm-text-tertiary" /> : <><Upload className="h-7 w-7 text-adm-text-tertiary" /><p className="mt-1.5 text-sm text-adm-text-tertiary">点击上传 R2 音频文件</p><p className="mt-0.5 text-[11px] text-adm-text-tertiary">支持 MP3/WAV/OGG/AAC，最大 50MB</p></>}</label>}
        </div>
        <div><label className="mb-1.5 block text-xs font-medium text-adm-text-secondary">歌曲名称</label><input value={name} onChange={(event) => setName(event.target.value)} placeholder="歌曲名称" className="w-full rounded-lg border border-adm-border bg-adm-input px-3 py-2 text-sm text-adm-text focus:border-gray-400 focus:outline-none" /></div>
        <div><label className="mb-1.5 block text-xs font-medium text-adm-text-secondary">艺术家</label><input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="歌手名（可选）" className="w-full rounded-lg border border-adm-border bg-adm-input px-3 py-2 text-sm text-adm-text focus:border-gray-400 focus:outline-none" /></div>
        <div><label className="mb-1.5 block text-xs font-medium text-adm-text-secondary">歌曲封面（可选）</label>{cover ? <div className="relative inline-block"><img src={toAbsoluteUrl(cover)} alt="封面预览" className="h-24 w-24 rounded-lg object-cover" /><button type="button" onClick={() => setCover("")} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"><X className="h-3 w-3" /></button></div> : <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-adm-border"><input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(event) => { void handleUploadCover(event.target.files); event.target.value = ""; }} />{uploadingCover ? <Loader2 className="h-6 w-6 animate-spin" /> : <><ImagePlus className="h-6 w-6 text-adm-text-tertiary" /><span className="mt-1 text-[10px] text-adm-text-tertiary">上传封面</span></>}</label>}</div>
        <div><button type="button" onClick={() => setShowLyric((value) => !value)} className="flex w-full items-center justify-between rounded-lg bg-adm-input px-3 py-2 text-xs font-medium text-adm-text-secondary"><span>手动编辑 LRC 歌词{lrc ? "（已编辑）" : ""}</span><span>{showLyric ? "收起" : "展开"}</span></button>{showLyric && <div className="mt-2"><LyricEditor audioUrl={audioUrl} value={lrc} onChange={setLrc} /></div>}</div>
      </div>
    </AdminModal>
  );
}
