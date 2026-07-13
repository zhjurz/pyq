"use client";

import { Cloud, ExternalLink, ShieldCheck } from "lucide-react";

export default function AdminStorage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-adm-text">Cloudflare R2 存储</h2>
        <p className="mt-1 text-sm text-adm-text-secondary">
          网站所有图片、视频、音频和文件均通过 Cloudflare R2 存储。
        </p>
      </div>

      <section className="rounded-xl border border-adm-border bg-adm-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
            <Cloud className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-adm-text">Cloudflare R2</h3>
            <p className="mt-1 text-sm leading-6 text-adm-text-secondary">
              R2 凭据仅保存在后端 Vercel 项目的环境变量中，不会显示、保存或修改到网站数据库。
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-lg bg-adm-input p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-adm-text">
            <ShieldCheck className="h-4 w-4 text-green-500" />
            后端必需环境变量
          </p>
          <code className="mt-3 block whitespace-pre-wrap text-xs leading-6 text-adm-text-secondary">
{`R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_URL
R2_ENDPOINT（可选）`}
          </code>
        </div>

        <p className="mt-4 text-xs leading-5 text-adm-text-tertiary">
          文件上传会由浏览器取得受控的短期上传地址后直接传入 R2，不经过 Vercel 函数，因此不受函数请求体大小限制。
          请同时在 R2 Bucket 配置允许本站域名 PUT 的 CORS 规则。
        </p>
        <a
          href="https://developers.cloudflare.com/r2/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-adm-primary hover:underline"
        >
          查看 Cloudflare R2 配置文档 <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </section>
    </div>
  );
}
