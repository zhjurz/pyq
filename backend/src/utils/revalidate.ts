/**
 * 触发 Next.js 按需重验证（revalidatePath）。
 * fire-and-forget：不阻塞 API 响应，错误静默处理。
 * 后端写操作（发动态/点赞/评论等）后调用，使所有用户刷新即可看到最新数据。
 */
export async function triggerRevalidate(): Promise<void> {
  try {
    const clientUrl = (process.env.FRONTEND_REVALIDATE_URL || process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim();
    const secret = process.env.REVALIDATE_SECRET;
    if (!secret) {
      console.warn("Revalidation skipped: REVALIDATE_SECRET is not configured.");
      return;
    }
    await fetch(`${clientUrl}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
  } catch {
    // 静默失败：重验证失败不影响 API 正常响应
  }
}
