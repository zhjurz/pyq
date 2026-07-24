"use client";

import { useEffect } from "react";
import { useSiteSettings } from "@/lib/site-settings-store";

/** Feature card nav below the social/login card in the desktop sidebar */
export default function FeatureCards() {
  const fetchSettings = useSiteSettings((s) => s.fetchSettings);
  const loaded = useSiteSettings((s) => s.loaded);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  if (!loaded) return null;

  const items = [
    { label: "关于", href: "/about", key: "about" },
    { label: "装备", href: "/equipment", key: "equipment" },
    { label: "Labs", href: "/labs", key: "labs" },
  ];

  return (
    <div className="rounded-2xl bg-wechat-white p-4 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.4)]">
      <h3 className="mb-2 text-xs font-semibold text-wechat-time">功能卡片</h3>
      <div className="divide-y divide-wechat-divider dark:divide-white/5">
        {items.map((item) => (
          <a
            key={item.key}
            href={item.href}
            className="flex items-center rounded-lg px-2 py-2.5 text-[13px] text-wechat-text transition-colors hover:bg-wechat-hover dark:hover:bg-white/5"
          >
            {item.label}
          </a>
        ))}
      </div>
    </div>
  );
}
