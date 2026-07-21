"use client";

import { useEffect } from "react";
import { useSiteSettings } from "@/lib/site-settings-store";

/** Mobile footer: editable copyright HTML + beian at bottom of main content */
export default function Footer() {
  const beian = useSiteSettings((s) => s.beian);
  const beianUrl = useSiteSettings((s) => s.beianUrl);
  const footerHtml = useSiteSettings((s) => s.footerHtml);
  const loaded = useSiteSettings((s) => s.loaded);
  const fetchSettings = useSiteSettings((s) => s.fetchSettings);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  if (!loaded || (!footerHtml && !beian)) return null;

  const href = beianUrl || "https://beian.miit.gov.cn";

  return (
    <footer className="px-4 pb-6 pt-2 md:hidden">
      <div className="mx-auto max-w-[320px] rounded-2xl border border-black/[0.04] bg-[#f7f7f7]/90 px-3.5 py-2.5 text-center shadow-[0_4px_20px_-10px_rgba(0,0,0,0.08)] dark:border-white/[0.06] dark:bg-white/[0.04] dark:shadow-none">
        {footerHtml && (
          <div
            className="footer-html text-[11px] leading-relaxed text-wechat-time [&_a]:font-medium [&_a]:transition-colors hover:[&_a]:text-wechat-text-secondary"
            dangerouslySetInnerHTML={{ __html: footerHtml }}
          />
        )}
        {beian && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${footerHtml ? "mt-0.5 " : ""}block text-[11px] text-wechat-time transition-colors hover:text-wechat-text-secondary`}
          >
            {beian}
          </a>
        )}
      </div>
    </footer>
  );
}
