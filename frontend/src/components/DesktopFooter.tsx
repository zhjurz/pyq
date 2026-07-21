"use client";

import { useEffect } from "react";
import { useSiteSettings } from "@/lib/site-settings-store";

/** Desktop footer: fixed bottom-left corner with editable HTML copyright + beian */
export default function DesktopFooter() {
  const beian = useSiteSettings((s) => s.beian);
  const beianUrl = useSiteSettings((s) => s.beianUrl);
  const footerHtml = useSiteSettings((s) => s.footerHtml);
  const loaded = useSiteSettings((s) => s.loaded);
  const fetchSettings = useSiteSettings((s) => s.fetchSettings);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  if (!loaded) return null;
  if (!footerHtml && !beian) return null;

  const beianHref = beianUrl || "https://beian.miit.gov.cn";

  return (
    <div className="fixed bottom-4 left-12 z-10 hidden max-w-[280px] md:block">
      <div className="rounded-2xl border border-black/[0.04] bg-white/80 px-3.5 py-2.5 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] backdrop-blur-md dark:border-white/[0.06] dark:bg-[#232328]/80 dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.45)]">
        <div className="space-y-0.5 text-left">
          {footerHtml && (
            <div
              className="footer-html text-[11px] leading-relaxed text-wechat-time [&_a]:font-medium [&_a]:transition-colors hover:[&_a]:text-wechat-text-secondary"
              dangerouslySetInnerHTML={{ __html: footerHtml }}
            />
          )}
          {beian && (
            <a
              href={beianHref}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[11px] leading-relaxed text-wechat-time transition-colors hover:text-wechat-text-secondary"
            >
              {beian}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
