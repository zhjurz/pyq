"use client";

import { useEffect, useState } from "react";
import CommentSection from "@/components/CommentSection";

export default function AboutClient({ initialContent }: { initialContent: string }) {
  const [content, setContent] = useState(initialContent);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => { if (d.aboutContent) setContent(d.aboutContent); })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-wechat-white md:bg-wechat-bg">
      <div className="mx-auto max-w-[600px] px-4 py-8 md:py-12">
        <h1 className="text-2xl font-bold text-wechat-text">关于</h1>
        {content ? (
          <div className="mt-6">
            <div
              className="rich-content text-[16px] leading-[1.8] text-wechat-text md:text-[18px] md:leading-[1.9]"
              dangerouslySetInnerHTML={{ __html: content }}
            />
            <hr className="my-10 border-t border-wechat-divider dark:border-white/10" />
            <CommentSection
              postId="about"
              postContent="关于页面"
              authorEmail=""
              commentsDisabled={false}
              initialComments={[]}
            />
          </div>
        ) : (
          <div className="py-20 text-center text-sm text-wechat-time">主人还没写关于页面</div>
        )}
      </div>
    </div>
  );
}
