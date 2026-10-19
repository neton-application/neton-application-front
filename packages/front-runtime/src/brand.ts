"use client";

/**
 * 品牌的单一配置来源（评审 R13）。
 *
 * 两层，后者覆盖前者：
 * 1. 构建期：`NEXT_PUBLIC_NETON_BRAND_NAME` / `_TAGLINE` / `_DESCRIPTION` / `_COPYRIGHT`。
 *    `NEXT_PUBLIC_*` 在构建时写进产物，构建之后改环境变量**不会**生效。
 * 2. 运行期：后台「配置管理」里的站点名称与副标题，经公开接口 `/admin/system/site/public` 读取。
 *    同一个镜像部署到多处、或上线后改名，走这一层，不必重新构建。
 *
 * 浏览器标题、登录页、导航栏都从这里取，不再各写各的。品牌与语言是两回事：品牌名不翻译。
 * MFA 的签发者名称在后端单独配置，不跟随这里 —— 改页面名称不能让已绑定的验证器对不上账号。
 */
import * as React from "react";
import { backendBaseUrl } from "./client";

export interface Brand {
  name: string;
  tagline: string;
  description: string;
  /** 版权行；未配置时按「© 年份 名称」生成。 */
  copyright: string;
}

export function buildBrand(): Brand {
  const name = process.env.NEXT_PUBLIC_NETON_BRAND_NAME?.trim() || "Neton";
  return {
    name,
    tagline: process.env.NEXT_PUBLIC_NETON_BRAND_TAGLINE?.trim() ?? "",
    description: process.env.NEXT_PUBLIC_NETON_BRAND_DESCRIPTION?.trim() ?? "",
    copyright: process.env.NEXT_PUBLIC_NETON_BRAND_COPYRIGHT?.trim() || `© ${new Date().getFullYear()} ${name}`,
  };
}

interface SitePublic { name?: string; tagline?: string; captcha?: unknown }

let sitePublic: Promise<SitePublic> | null = null;

/**
 * 公开站点配置只取一次（品牌与人机验证共用）；接口失败时返回空对象，登录页不能因为它打不开。
 */
export function loadSitePublic(): Promise<SitePublic> {
  sitePublic ??= fetch(`${backendBaseUrl()}/admin/system/site/public`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { code?: number; data?: SitePublic } | null) => (body?.code === 0 && body.data ? body.data : {}))
    .catch(() => ({}));
  return sitePublic;
}

/** 运行期品牌覆盖；接口失败时静默退回构建期品牌。 */
function loadRuntimeBrand(): Promise<Partial<Brand>> {
  return loadSitePublic().then((data) => ({
    ...(data.name?.trim() ? { name: data.name.trim() } : {}),
    ...(data.tagline !== undefined ? { tagline: data.tagline.trim() } : {}),
  }));
}

/**
 * 当前品牌。首帧用构建期值（不闪空白），运行期配置到达后更新，并同步浏览器标题。
 * 传入 [pageTitle] 时同时设置浏览器标题（`""` 表示只显示品牌名）；不传则不碰标题。
 */
export function useBrand(pageTitle?: string): Brand {
  const [brand, setBrand] = React.useState<Brand>(buildBrand);
  React.useEffect(() => {
    let cancelled = false;
    loadRuntimeBrand().then((override) => {
      if (cancelled) return;
      setBrand((current) => {
        const name = override.name ?? current.name;
        const explicitCopyright = process.env.NEXT_PUBLIC_NETON_BRAND_COPYRIGHT?.trim();
        return {
          ...current,
          ...override,
          name,
          copyright: explicitCopyright || `© ${new Date().getFullYear()} ${name}`,
        };
      });
    });
    return () => { cancelled = true; };
  }, []);
  React.useEffect(() => {
    if (pageTitle === undefined) return;
    document.title = pageTitle ? `${pageTitle} · ${brand.name}` : brand.name;
  }, [pageTitle, brand.name]);
  return brand;
}
