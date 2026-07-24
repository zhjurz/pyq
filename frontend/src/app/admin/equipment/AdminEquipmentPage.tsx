"use client";

import { useState, useEffect } from "react";
import { getToken } from "@/lib/auth";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface EquipItem {
  id?: string;
  category: string;
  categoryDesc: string;
  name: string;
  spec: string;
  intro: string;
  image: string;
  link: string;
  sortOrder: number;
}

export default function AdminEquipmentPage() {
  const router = useRouter();
  const token = getToken();
  const [items, setItems] = useState<EquipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) { router.replace("/"); return; }
    fetch("/api/equipment")
      .then((r) => r.ok ? r.json() : [])
      .then((cats: { category: string; desc: string; items: EquipItem[] }[]) => {
        const flat: EquipItem[] = [];
        cats.forEach((c) => c.items.forEach((item) => flat.push(item)));
        setItems(flat);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, router]);

  const updateItem = (i: number, patch: Partial<EquipItem>) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    setItems(next);
  };

  const removeItem = (i: number) => {
    setItems(items.filter((_, j) => j !== i));
  };

  const addItem = () => {
    setItems([...items, { category: "", categoryDesc: "", name: "", spec: "", intro: "", image: "", link: "", sortOrder: items.length }]);
  };

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/equipment", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ equipment: items.filter((x) => x.name.trim()) }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {} finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-adm-text-tertiary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-adm-text">装备 / Labs 管理</h2>
          <p className="mt-1 text-sm text-adm-text-secondary">分类名称相同的条目会自动合并为一个分组。保存会替换全部数据。</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={addItem} className="flex items-center gap-1.5 rounded-lg border border-adm-border bg-adm-card px-3 py-2 text-xs text-adm-text-secondary hover:bg-adm-card-hover"><Plus className="h-3.5 w-3.5" />添加条目</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-white dark:text-gray-900">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? "已保存" : "保存全部"}</button>
        </div>
      </div>

      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-xl border border-adm-border bg-adm-card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-adm-text-secondary">#{i + 1}</span>
              <button onClick={() => removeItem(i)} className="text-adm-text-tertiary hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-adm-text-tertiary">分类名称</label>
                <input value={item.category} onChange={(e) => updateItem(i, { category: e.target.value })} placeholder="例如：电脑 / 外设" className="w-full rounded-lg border border-adm-border bg-adm-input px-2.5 py-1.5 text-sm text-adm-text mt-1" />
              </div>
              <div>
                <label className="text-[11px] text-adm-text-tertiary">分类简介</label>
                <input value={item.categoryDesc} onChange={(e) => updateItem(i, { categoryDesc: e.target.value })} placeholder="一句话描述这个分类" className="w-full rounded-lg border border-adm-border bg-adm-input px-2.5 py-1.5 text-sm text-adm-text mt-1" />
              </div>
              <div>
                <label className="text-[11px] text-adm-text-tertiary">设备名称</label>
                <input value={item.name} onChange={(e) => updateItem(i, { name: e.target.value })} placeholder="必填" className="w-full rounded-lg border border-adm-border bg-adm-input px-2.5 py-1.5 text-sm text-adm-text mt-1" />
              </div>
              <div>
                <label className="text-[11px] text-adm-text-tertiary">配置 / 型号</label>
                <input value={item.spec} onChange={(e) => updateItem(i, { spec: e.target.value })} placeholder="例如：M4 Pro / 24GB+512GB" className="w-full rounded-lg border border-adm-border bg-adm-input px-2.5 py-1.5 text-sm text-adm-text mt-1" />
              </div>
              <div className="col-span-2">
                <label className="text-[11px] text-adm-text-tertiary">简介</label>
                <textarea value={item.intro} onChange={(e) => updateItem(i, { intro: e.target.value })} rows={2} placeholder="2~3 句简短介绍" className="w-full rounded-lg border border-adm-border bg-adm-input px-2.5 py-1.5 text-sm text-adm-text mt-1 resize-y" />
              </div>
              <div>
                <label className="text-[11px] text-adm-text-tertiary">图片 URL</label>
                <input value={item.image} onChange={(e) => updateItem(i, { image: e.target.value })} placeholder="https://..." className="w-full rounded-lg border border-adm-border bg-adm-input px-2.5 py-1.5 text-sm text-adm-text mt-1" />
              </div>
              <div>
                <label className="text-[11px] text-adm-text-tertiary">链接（可选）</label>
                <input value={item.link} onChange={(e) => updateItem(i, { link: e.target.value })} placeholder="https://..." className="w-full rounded-lg border border-adm-border bg-adm-input px-2.5 py-1.5 text-sm text-adm-text mt-1" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
