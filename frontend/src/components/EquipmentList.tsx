"use client";

import { useEffect, useState } from "react";
import { toAbsoluteUrl, toHttps } from "@/lib/upload";
import LazyImage from "@/components/LazyImage";

interface EquipItem {
  id: string;
  category: string;
  categoryDesc: string;
  name: string;
  spec: string;
  intro: string;
  image: string;
  link: string;
}

interface EquipCategory {
  category: string;
  desc: string;
  items: EquipItem[];
}

export default function EquipmentList() {
  const [data, setData] = useState<EquipCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/equipment")
      .then((r) => (r.ok ? r.json() : []))
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <div className="h-6 w-20 animate-pulse rounded bg-wechat-bubble" />
            <div className="grid grid-cols-2 gap-3">
              {[1, 2].map((j) => (
                <div key={j} className="h-40 animate-pulse rounded-2xl bg-wechat-bubble" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {data.map((cat) => (
        <section key={cat.category}>
          <h2 className="text-xl font-bold text-wechat-text">{cat.category}</h2>
          {cat.desc && (
            <p className="mt-1 text-sm text-wechat-time">{cat.desc}</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            {cat.items.map((item) => {
              const href = item.link || undefined;
              const Card = (
                <div
                  key={item.id}
                  className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-[0_4px_20px_-6px_rgba(0,0,0,0.12)] dark:border-white/[0.06] dark:bg-[#232328] dark:shadow-none dark:hover:shadow-[0_4px_20px_-6px_rgba(0,0,0,0.4)]"
                >
                  {/* Image area */}
                  <div className="flex h-[140px] items-center justify-center bg-white p-4 dark:bg-[#1c1c20]">
                    {item.image ? (
                      <LazyImage
                        src={toHttps(toAbsoluteUrl(item.image))}
                        alt={item.name}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <div className="text-sm text-wechat-time">暂无图片</div>
                    )}
                  </div>
                  {/* Content */}
                  <div className="border-t border-black/[0.04] px-3.5 py-3 dark:border-white/[0.06]">
                    <p className="text-[14px] font-semibold text-wechat-text">{item.name}</p>
                    {item.spec && (
                      <p className="mt-0.5 text-[11px] text-wechat-time">{item.spec}</p>
                    )}
                    {item.intro && (
                      <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-wechat-text-secondary">
                        {item.intro}
                      </p>
                    )}
                  </div>
                </div>
              );
              return href ? (
                <a key={item.id} href={href} target="_blank" rel="noopener noreferrer" className="block">
                  {Card}
                </a>
              ) : (
                <div key={item.id}>{Card}</div>
              );
            })}
          </div>
        </section>
      ))}
      {data.length === 0 && (
        <div className="py-20 text-center text-sm text-wechat-time">暂无内容</div>
      )}
    </div>
  );
}
