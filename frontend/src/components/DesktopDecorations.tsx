"use client";

import { useSiteSettings } from "@/lib/site-settings-store";
import { toAbsoluteUrl } from "@/lib/upload";

export default function DesktopDecorations() {
  const decorationImage = useSiteSettings((s) => s.decorationImage);
  const loaded = useSiteSettings((s) => s.loaded);

  if (!loaded || !decorationImage) return null;

  return (
    <div className="pointer-events-none fixed inset-0 hidden overflow-hidden md:block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={toAbsoluteUrl(decorationImage)}
        alt=""
        className="h-full w-full object-cover opacity-[0.15] dark:opacity-[0.08]"
      />
    </div>
  );
}
