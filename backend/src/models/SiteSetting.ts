import { DataTypes, Model, Optional } from "sequelize";
import sequelize from "../config/database";

interface SiteSettingAttributes {
  id: number;
  siteName: string;
  description: string;
  keywords: string;
  domain: string;
  beian: string;
  /** 页面底部版权/页脚 HTML，可由后台编辑 */
  footerHtml: string;
  /** 桌面端背景装饰图 URL，为空时不显示桌面装饰 */
  decorationImage: string;
  faviconUrl: string;
  ogImage: string;
  backgroundImages: string;
  darkModeEnabled: boolean;
  darkModeStartTime: string;
  darkModeEndTime: string;
  emailNotifyEnabled: boolean;
  notifyEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  emailTemplate: string;
  amapJsKey: string;
  amapSecurityJsCode: string;
  amapKey: string;
  beianUrl: string;
  socialLinks: string;
  postCollapseLength: number;
  fontUrl: string;
  fontFamily: string;
  adOnArchives: boolean;
  /** 评论防刷（限流 + 黑名单）总开关，默认开启 */
  commentAntiSpamEnabled: boolean;
  /** RSS 订阅总开关，关闭后 /feed 返回 404 */
  rssEnabled: boolean;
  /** RSS 是否包含动态（moment），关闭后只订阅文章（article） */
  rssIncludeMoments: boolean;
  /** 豆瓣用户 ID，用于抓取电影/图书/音乐收藏 */
  doubanId: string;
  /** 最后一次成功/部分成功的豆瓣快照 JSON */
  doubanCache: string | null;
  /** 最近一次同步状态（success / partial / failed） */
  doubanSyncStatus: string;
  /** 最近一次成功同步时间 */
  doubanSyncedAt: Date | null;
  /** 最近一次同步错误的安全摘要 */
  doubanLastError: string | null;
  /** 跨 Vercel 实例的豆瓣同步租约 ID */
  doubanSyncLeaseId: string | null;
  /** 豆瓣同步租约的过期时间 */
  doubanSyncLeaseExpiresAt: Date | null;
  /** 最近一次豆瓣同步尝试时间 */
  doubanLastAttemptAt: Date | null;
  /** 评论违禁词列表，JSON 数组字符串 */
  bannedWords: string | null;
  /** 进入网站是否自动播放歌单音乐 */
  musicAutoplay: boolean;
  /** 关于页面内容（HTML），可由后台编辑 */
  aboutContent: string;
}

interface SiteSettingCreationAttributes extends Optional<
  SiteSettingAttributes,
  "id" | "siteName" | "description" | "keywords" | "domain" | "beian" | "footerHtml" | "decorationImage" | "faviconUrl" | "ogImage" | "backgroundImages" | "darkModeEnabled" | "darkModeStartTime" | "darkModeEndTime" | "emailNotifyEnabled" | "notifyEmail" | "smtpHost" | "smtpPort" | "smtpSecure" | "smtpUser" | "smtpPass" | "smtpFrom" | "emailTemplate" | "amapJsKey" | "amapSecurityJsCode" | "amapKey" | "beianUrl" | "socialLinks" | "postCollapseLength" | "fontUrl" | "fontFamily" | "adOnArchives" | "commentAntiSpamEnabled" | "rssEnabled" | "rssIncludeMoments" | "doubanId" | "doubanCache" | "doubanSyncStatus" | "doubanSyncedAt" | "doubanLastError" | "doubanSyncLeaseId" | "doubanSyncLeaseExpiresAt" | "doubanLastAttemptAt" | "bannedWords" | "musicAutoplay" | "aboutContent"
> {}

class SiteSetting
  extends Model<SiteSettingAttributes, SiteSettingCreationAttributes>
  implements SiteSettingAttributes
{
  declare id: number;
  declare siteName: string;
  declare description: string;
  declare keywords: string;
  declare domain: string;
  declare beian: string;
  declare footerHtml: string;
  declare decorationImage: string;
  declare faviconUrl: string;
  declare ogImage: string;
  declare backgroundImages: string;
  declare darkModeEnabled: boolean;
  declare darkModeStartTime: string;
  declare darkModeEndTime: string;
  declare emailNotifyEnabled: boolean;
  declare notifyEmail: string;
  declare smtpHost: string;
  declare smtpPort: number;
  declare smtpSecure: boolean;
  declare smtpUser: string;
  declare smtpPass: string;
  declare smtpFrom: string;
  declare emailTemplate: string;
  declare amapJsKey: string;
  declare amapSecurityJsCode: string;
  declare amapKey: string;
  declare beianUrl: string;
  declare socialLinks: string;
  declare postCollapseLength: number;
  declare fontUrl: string;
  declare fontFamily: string;
  declare adOnArchives: boolean;
  declare commentAntiSpamEnabled: boolean;
  declare rssEnabled: boolean;
  declare rssIncludeMoments: boolean;
  declare doubanId: string;
  declare doubanCache: string | null;
  declare doubanSyncStatus: string;
  declare doubanSyncedAt: Date | null;
  declare doubanLastError: string | null;
  declare doubanSyncLeaseId: string | null;
  declare doubanSyncLeaseExpiresAt: Date | null;
  declare doubanLastAttemptAt: Date | null;
  declare bannedWords: string | null;
  declare musicAutoplay: boolean;
  declare aboutContent: string;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

SiteSetting.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      defaultValue: 1,
    },
    siteName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: "朋友圈博客",
    },
    description: {
      type: DataTypes.STRING(500),
      allowNull: false,
      defaultValue: "一个像微信朋友圈一样的个人博客",
    },
    keywords: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    domain: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    beian: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: "",
    },
    footerHtml: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    decorationImage: {
      type: DataTypes.STRING(500),
      allowNull: false,
      defaultValue: "",
    },
    faviconUrl: {
      type: DataTypes.STRING(500),
      allowNull: false,
      defaultValue: "",
    },
    ogImage: {
      type: DataTypes.STRING(500),
      allowNull: false,
      defaultValue: "",
    },
    backgroundImages: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    darkModeEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    darkModeStartTime: {
      type: DataTypes.STRING(5),
      allowNull: false,
      defaultValue: "18:00",
    },
    darkModeEndTime: {
      type: DataTypes.STRING(5),
      allowNull: false,
      defaultValue: "06:00",
    },
    emailNotifyEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    notifyEmail: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    smtpHost: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    smtpPort: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 465,
    },
    smtpSecure: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    smtpUser: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    smtpPass: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    smtpFrom: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    emailTemplate: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    amapJsKey: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    amapSecurityJsCode: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    amapKey: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    beianUrl: {
      type: DataTypes.STRING(500),
      allowNull: false,
      defaultValue: "",
    },
    socialLinks: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "socialLinks",
    },
    postCollapseLength: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 150,
    },
    fontUrl: {
      type: DataTypes.STRING(500),
      allowNull: false,
      defaultValue: "",
    },
    fontFamily: {
      type: DataTypes.STRING(200),
      allowNull: false,
      defaultValue: "",
    },
    adOnArchives: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    commentAntiSpamEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    rssEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    rssIncludeMoments: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    doubanId: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: "",
    },
    doubanCache: {
      type: DataTypes.TEXT("medium"),
      allowNull: true,
      defaultValue: null,
    },
    doubanSyncStatus: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "never",
    },
    doubanSyncedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    doubanLastError: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    doubanSyncLeaseId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      defaultValue: null,
    },
    doubanSyncLeaseExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    doubanLastAttemptAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    bannedWords: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    musicAutoplay: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    aboutContent: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "site_settings",
  }
);

export const DEFAULT_FOOTER_HTML =
  `© ${new Date().getFullYear()} <a href="https://kanle.net" target="_blank" rel="noopener noreferrer">kanle</a> by 小予 · 程序由AI生成`;

export const siteSettingTextDefaults = {
  backgroundImages: "[]",
  emailTemplate: "",
  socialLinks: "[]",
  footerHtml: DEFAULT_FOOTER_HTML,
} satisfies Pick<SiteSettingCreationAttributes, "backgroundImages" | "emailTemplate" | "socialLinks" | "footerHtml">;

export default SiteSetting;
