"use client";

import { useCallback, useEffect, useState } from "react";
import { GripVertical, Music, Plus, Save, Trash2, Upload } from "lucide-react";
import { apiFetch, getToken } from "@/lib/api-fetch";
import { uploadDirect, type UploadedMedia } from "@/lib/upload";
import LyricEditor from "@/components/LyricEditor";
import MediaPicker, { type PickerMediaItem } from "@/components/MediaPicker";

interface Track {
  id: string;
  audioMediaId: string;
  coverMediaId: string | null;
  name: string;
  artist: string;
  mp3url: string;
  cover: string;
  lrc: string;
}

export default function AdminMusic() {
  const [name, setName] = useState("网站歌单");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoplay, setAutoplay] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [picker, setPicker] = useState<"audio" | "cover" | null>(null);
  const [draft, setDraft] = useState({ audio: null as PickerMediaItem | UploadedMedia | null, cover: null as PickerMediaItem | UploadedMedia | null, title: "", artist: "", lrc: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch("/music/admin");
      if (!response.ok) throw new Error("加载歌单失败");
      const data = await response.json();
      setName(data.name || "网站歌单");
      setTracks(data.tracks || []);
      setAutoplay(data.musicAutoplay || false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载歌单失败");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File, kind: "audio" | "image") => {
    const token = getToken();
    if (!token) throw new Error("登录状态已失效");
    return uploadDirect(file, token, kind);
  };
  const addTrack = async () => {
    if (!draft.audio) { setMessage("请先上传或选择 R2 音频文件"); return; }
    setSaving(true); setMessage("");
    try {
      const response = await apiFetch("/music/admin/tracks", { method: "POST", body: JSON.stringify({ audioMediaId: draft.audio.id, coverMediaId: draft.cover?.id || null, title: draft.title, artist: draft.artist, lrc: draft.lrc }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "添加歌曲失败");
      setTracks((current) => [...current, data]);
      setDraft({ audio: null, cover: null, title: "", artist: "", lrc: "" });
    } catch (error) { setMessage(error instanceof Error ? error.message : "添加歌曲失败"); }
    finally { setSaving(false); }
  };
  const removeTrack = async (id: string) => {
    if (!confirm("仅从歌单移除此歌曲，不会删除 R2 文件。继续吗？")) return;
    const response = await apiFetch(`/music/admin/tracks/${id}`, { method: "DELETE" });
    if (!response.ok) { const data = await response.json().catch(() => null); setMessage(data?.message || "移除歌曲失败"); return; }
    setTracks((current) => current.filter((track) => track.id !== id));
  };
  const move = async (index: number, direction: -1 | 1) => {
    const next = [...tracks]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setTracks(next);
    const response = await apiFetch("/music/admin/order", { method: "PUT", body: JSON.stringify({ trackIds: next.map((track) => track.id) }) });
    if (!response.ok) { setMessage("保存排序失败，已重新加载歌单"); void load(); }
  };
  const saveName = async () => {
    setSaving(true);
    try { const response = await apiFetch("/music/admin", { method: "PUT", body: JSON.stringify({ name, musicAutoplay: autoplay }) }); if (!response.ok) throw new Error("保存歌单名称失败"); setMessage("歌单已保存"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  };

  return <div className="mx-auto max-w-4xl p-4 sm:p-6">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold text-adm-text">R2 音乐歌单</h1><p className="mt-1 text-sm text-adm-text-tertiary">只播放媒体库中已上传到 Cloudflare R2 的音频文件。</p></div><button onClick={() => void saveName()} disabled={saving} className="flex items-center gap-2 rounded-lg bg-adm-primary px-4 py-2 text-sm font-medium text-adm-primary-text disabled:opacity-50"><Save className="h-4 w-4" />保存歌单</button></div>
    {message && <p className="mb-4 rounded-lg bg-adm-input px-3 py-2 text-sm text-adm-text-secondary">{message}</p>}
    <section className="mb-6 rounded-xl border border-adm-border bg-adm-card p-4"><label className="mb-1.5 block text-sm font-medium text-adm-text">歌单名称</label><input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-adm-border bg-adm-input px-3 py-2 text-sm text-adm-text" /><label className="mt-4 flex cursor-pointer items-center justify-between rounded-lg bg-adm-input px-3 py-2 text-sm text-adm-text"><span>进入网站自动播放</span><input type="checkbox" checked={autoplay} onChange={(event) => setAutoplay(event.target.checked)} className="h-4 w-4 accent-adm-primary" /></label></section>
    <section className="mb-6 rounded-xl border border-adm-border bg-adm-card p-4"><h2 className="mb-4 flex items-center gap-2 font-semibold text-adm-text"><Plus className="h-4 w-4" />添加 R2 音频</h2><div className="grid gap-3 sm:grid-cols-2"><label className="rounded-lg border border-dashed border-adm-border p-3 text-sm text-adm-text-secondary"><span className="mb-2 flex items-center gap-2"><Upload className="h-4 w-4" />上传音频到 R2</span><input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file, "audio").then((audio) => setDraft((current) => ({ ...current, audio, title: current.title || audio.filename.replace(/\.[^.]+$/, "") }))).catch((error) => setMessage(error.message)); }} /></label><button onClick={() => setPicker("audio")} className="rounded-lg border border-adm-border p-3 text-left text-sm text-adm-text-secondary">从 R2 媒体库选择音频</button></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="歌曲名称" className="rounded-lg border border-adm-border bg-adm-input px-3 py-2 text-sm text-adm-text" /><input value={draft.artist} onChange={(event) => setDraft((current) => ({ ...current, artist: event.target.value }))} placeholder="艺术家（可选）" className="rounded-lg border border-adm-border bg-adm-input px-3 py-2 text-sm text-adm-text" /></div><div className="mt-3"><button onClick={() => setPicker("cover")} className="rounded-lg border border-adm-border px-3 py-2 text-sm text-adm-text-secondary">{draft.cover ? "已选择 R2 封面，重新选择" : "选择 R2 封面（可选）"}</button></div><div className="mt-3"><LyricEditor audioUrl={draft.audio?.url || ""} value={draft.lrc} onChange={(lrc) => setDraft((current) => ({ ...current, lrc }))} /></div><button onClick={() => void addTrack()} disabled={saving || !draft.audio} className="mt-3 rounded-lg bg-adm-primary px-4 py-2 text-sm font-medium text-adm-primary-text disabled:opacity-50">添加到歌单</button></section>
    <section className="rounded-xl border border-adm-border bg-adm-card p-4"><h2 className="mb-3 font-semibold text-adm-text">歌曲列表</h2>{loading ? <p className="text-sm text-adm-text-tertiary">加载中...</p> : tracks.length === 0 ? <p className="py-8 text-center text-sm text-adm-text-tertiary">歌单为空，请添加 R2 音频文件。</p> : <div className="space-y-2">{tracks.map((track, index) => <div key={track.id} className="flex items-center gap-3 rounded-lg bg-adm-input p-2"><GripVertical className="h-4 w-4 text-adm-text-tertiary" />{track.cover ? <img src={track.cover} alt="" className="h-10 w-10 rounded object-cover" /> : <Music className="h-8 w-8 p-2 text-adm-text-tertiary" />}<div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-adm-text">{track.name}</p><p className="truncate text-xs text-adm-text-tertiary">{track.artist || "未知艺术家"}</p></div><div className="flex gap-1"><button onClick={() => void move(index, -1)} disabled={index === 0} className="px-2 text-adm-text-secondary disabled:opacity-30">↑</button><button onClick={() => void move(index, 1)} disabled={index === tracks.length - 1} className="px-2 text-adm-text-secondary disabled:opacity-30">↓</button><button onClick={() => void removeTrack(track.id)} className="rounded p-1 text-adm-danger"><Trash2 className="h-4 w-4" /></button></div></div>)}</div>}</section>
    <MediaPicker open={picker === "audio"} onClose={() => setPicker(null)} category="audio" title="选择 R2 音频" onSelect={(audio) => { setDraft((current) => ({ ...current, audio, title: current.title || audio.filename.replace(/\.[^.]+$/, "") })); setPicker(null); }} />
    <MediaPicker open={picker === "cover"} onClose={() => setPicker(null)} category="image" title="选择 R2 封面" onSelect={(cover) => { setDraft((current) => ({ ...current, cover })); setPicker(null); }} />
  </div>;
}
