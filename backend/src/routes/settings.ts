import { Router, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import { SiteSetting, User } from "../models";
import { siteSettingTextDefaults } from "../models/SiteSetting";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";
import { sendTestEmail, DEFAULT_EMAIL_TEMPLATE } from "../services/email-service";
import { triggerRevalidate } from "../utils/revalidate";

const fontFamilyPattern = /^[\p{L}\p{N} ._-]+$/u;

function isValidFontUrl(value: string): boolean {
  if (!value) return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

const router = Router();

/** Ensure a single row (id=1) exists; create with defaults if missing. */
async function ensureSetting() {
  const [setting, created] = await SiteSetting.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1, ...siteSettingTextDefaults },
  });
  return setting;
}

// GET /api/settings - public site settings (for SEO/metadata, no sensitive data)
router.get("/", async (_req: Request, res: Response) => {
  const setting = await ensureSetting();
  const admin = await User.findOne({ where: { role: "admin" }, attributes: ["cover"] });
  res.json({
    siteName: setting.siteName,
    description: setting.description,
    keywords: setting.keywords,
    domain: setting.domain,
    beian: setting.beian,
    beianUrl: setting.beianUrl,
    faviconUrl: setting.faviconUrl,
    ogImage: setting.ogImage,
    backgroundImages: setting.backgroundImages,
    socialLinks: setting.socialLinks,
    postCollapseLength: setting.postCollapseLength,
    fontUrl: setting.fontUrl,
    fontFamily: setting.fontFamily,
    darkModeEnabled: setting.darkModeEnabled,
    darkModeStartTime: setting.darkModeStartTime,
    darkModeEndTime: setting.darkModeEndTime,
    adOnArchives: setting.adOnArchives,
    rssEnabled: setting.rssEnabled,
    rssIncludeMoments: setting.rssIncludeMoments,
    doubanId: setting.doubanId,
    musicAutoplay: setting.musicAutoplay,
    defaultCover: admin?.cover || "",
  });
});

// PUT /api/admin/settings - update site settings (admin only)
router.put(
  "/",
  authenticate,
  requireAdmin,
  [
    body("siteName").optional().trim().isLength({ max: 100 }),
    body("description").optional().trim().isLength({ max: 500 }),
    body("keywords").optional().trim().isLength({ max: 255 }),
    body("domain").optional().trim().isLength({ max: 255 }),
    body("beian").optional().trim().isLength({ max: 100 }),
    body("beianUrl").optional().trim().isLength({ max: 500 }),
    body("faviconUrl").optional().trim().isLength({ max: 500 }),
    body("ogImage").optional().trim().isLength({ max: 500 }),
    body("backgroundImages").optional().isString(),
    body("socialLinks").optional().isString(),
    body("postCollapseLength").optional().isInt({ min: 0, max: 100000 }),
    body("fontUrl")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .custom(isValidFontUrl)
      .withMessage("自定义字体 CSS 链接必须是有效的 HTTPS URL"),
    body("fontFamily")
      .optional()
      .trim()
      .isLength({ max: 200 })
      .custom((value) => !value || fontFamilyPattern.test(value))
      .withMessage("字体名称只能包含文字、数字、空格、句点、连字符和下划线"),
    body("darkModeEnabled").optional().isBoolean(),
    body("darkModeStartTime").optional().matches(/^\d{2}:\d{2}$/),
    body("darkModeEndTime").optional().matches(/^\d{2}:\d{2}$/),
    body("adOnArchives").optional().isBoolean(),
    body("rssEnabled").optional().isBoolean(),
    body("rssIncludeMoments").optional().isBoolean(),
    body("doubanId").optional().trim().isLength({ max: 100 }),
    body("musicAutoplay").optional().isBoolean(),
    // Email config
    body("emailNotifyEnabled").optional().isBoolean(),
    body("notifyEmail").optional().trim().isLength({ max: 255 }),
    body("smtpHost").optional().trim().isLength({ max: 255 }),
    body("smtpPort").optional().isInt({ min: 1, max: 65535 }),
    body("smtpSecure").optional().isBoolean(),
    body("smtpUser").optional().trim().isLength({ max: 255 }),
    body("smtpPass").optional().trim().isLength({ max: 255 }),
    body("smtpFrom").optional().trim().isLength({ max: 255 }),
    body("emailTemplate").optional().isString(),
    // Amap config
    body("amapKey").optional().trim().isLength({ max: 255 }),
    body("amapJsKey").optional().trim().isLength({ max: 255 }),
    body("amapSecurityJsCode").optional().trim().isLength({ max: 255 }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const setting = await ensureSetting();
    const fontUrl = req.body.fontUrl ?? setting.fontUrl;
    const fontFamily = req.body.fontFamily ?? setting.fontFamily;
    if (Boolean(fontUrl) !== Boolean(fontFamily)) {
      res.status(400).json({ message: "自定义字体 CSS 链接和字体名称需同时填写或同时留空" });
      return;
    }

    const doubanIdChanged = req.body.doubanId !== undefined && req.body.doubanId !== setting.doubanId;
    await setting.update({
      siteName: req.body.siteName ?? setting.siteName,
      description: req.body.description ?? setting.description,
      keywords: req.body.keywords ?? setting.keywords,
      domain: req.body.domain ?? setting.domain,
      beian: req.body.beian ?? setting.beian,
      beianUrl: req.body.beianUrl ?? setting.beianUrl,
      faviconUrl: req.body.faviconUrl ?? setting.faviconUrl,
      ogImage: req.body.ogImage ?? setting.ogImage,
      backgroundImages: req.body.backgroundImages ?? setting.backgroundImages,
      socialLinks: req.body.socialLinks ?? setting.socialLinks,
      postCollapseLength: req.body.postCollapseLength ?? setting.postCollapseLength,
      fontUrl,
      fontFamily,
      darkModeEnabled: req.body.darkModeEnabled ?? setting.darkModeEnabled,
      darkModeStartTime: req.body.darkModeStartTime ?? setting.darkModeStartTime,
      darkModeEndTime: req.body.darkModeEndTime ?? setting.darkModeEndTime,
      adOnArchives: req.body.adOnArchives ?? setting.adOnArchives,
      rssEnabled: req.body.rssEnabled ?? setting.rssEnabled,
      rssIncludeMoments: req.body.rssIncludeMoments ?? setting.rssIncludeMoments,
      doubanId: req.body.doubanId ?? setting.doubanId,
      doubanCache: doubanIdChanged ? null : setting.doubanCache,
      doubanSyncStatus: doubanIdChanged ? "never" : setting.doubanSyncStatus,
      doubanSyncedAt: doubanIdChanged ? null : setting.doubanSyncedAt,
      doubanLastError: doubanIdChanged ? null : setting.doubanLastError,
      doubanSyncLeaseId: doubanIdChanged ? null : setting.doubanSyncLeaseId,
      doubanSyncLeaseExpiresAt: doubanIdChanged ? null : setting.doubanSyncLeaseExpiresAt,
      musicAutoplay: req.body.musicAutoplay ?? setting.musicAutoplay,
      emailNotifyEnabled: req.body.emailNotifyEnabled ?? setting.emailNotifyEnabled,
      notifyEmail: req.body.notifyEmail ?? setting.notifyEmail,
      smtpHost: req.body.smtpHost ?? setting.smtpHost,
      smtpPort: req.body.smtpPort ?? setting.smtpPort,
      smtpSecure: req.body.smtpSecure ?? setting.smtpSecure,
      smtpUser: req.body.smtpUser ?? setting.smtpUser,
      smtpPass: req.body.smtpPass ?? setting.smtpPass,
      smtpFrom: req.body.smtpFrom ?? setting.smtpFrom,
      emailTemplate: req.body.emailTemplate ?? setting.emailTemplate,
      amapKey: req.body.amapKey ?? setting.amapKey,
      amapJsKey: req.body.amapJsKey ?? setting.amapJsKey,
      amapSecurityJsCode: req.body.amapSecurityJsCode ?? setting.amapSecurityJsCode,
    });

    void triggerRevalidate();

    res.json({
      siteName: setting.siteName,
      description: setting.description,
      keywords: setting.keywords,
      domain: setting.domain,
      beian: setting.beian,
      beianUrl: setting.beianUrl,
      faviconUrl: setting.faviconUrl,
      ogImage: setting.ogImage,
      backgroundImages: setting.backgroundImages,
      socialLinks: setting.socialLinks,
      postCollapseLength: setting.postCollapseLength,
      fontUrl: setting.fontUrl,
      darkModeEnabled: setting.darkModeEnabled,
      darkModeStartTime: setting.darkModeStartTime,
      darkModeEndTime: setting.darkModeEndTime,
      adOnArchives: setting.adOnArchives,
      rssEnabled: setting.rssEnabled,
      rssIncludeMoments: setting.rssIncludeMoments,
    });
  }
);

// GET /api/settings/default-template - built-in email HTML (admin only)
router.get("/default-template", authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ template: DEFAULT_EMAIL_TEMPLATE, templateVersion: 1 });
});

// GET /api/settings/email-config - email config (admin only, includes smtpPass)
router.get("/email-config", authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const setting = await ensureSetting();
  res.json({
    emailNotifyEnabled: setting.emailNotifyEnabled,
    smtpHost: setting.smtpHost,
    smtpPort: setting.smtpPort,
    smtpSecure: setting.smtpSecure,
    smtpUser: setting.smtpUser,
    smtpPass: setting.smtpPass,
    smtpFrom: setting.smtpFrom,
    notifyEmail: setting.notifyEmail,
    emailTemplate: setting.emailTemplate,
  });
});

// GET /api/settings/amap-config - amap config (admin only)
router.get("/amap-config", authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const setting = await ensureSetting();
  res.json({
    amapKey: setting.amapKey,
    amapJsKey: setting.amapJsKey,
    amapSecurityJsCode: setting.amapSecurityJsCode,
  });
});

// POST /api/settings/email-test - send a test email (admin only)
router.post("/email-test", authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await sendTestEmail();
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : "测试邮件发送失败",
    });
  }
});

export default router;
