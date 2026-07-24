"use client";

import { useState, useEffect, useCallback } from "react";
import { getToken } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import ArticleEditor from "@/components/ArticleEditor";

export default function AboutSettingsSection() {
  const token = getToken();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setContent(d.aboutContent || ""))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const handleSave = useCallback(async () => {
    if (!token) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ aboutContent: content }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {} finally { setSaving(false); }
  }, [token, content]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-adm-text-tertiary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-adm-text">关于页面</h2>
          <p className="mt-1 text-sm text-adm-text-secondary">编辑关于页面的正文内容，支持富文本。</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-white dark:text-gray-900"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? "已保存" : "保存"}
        </button>
      </div>
      <div className="rounded-xl border border-adm-border bg-adm-card p-4">
        <ArticleEditor value={content} onChange={setContent} token={token || ""} placeholder="开始撰写关于页面…" />
      </div>
    </div>
  );
}
