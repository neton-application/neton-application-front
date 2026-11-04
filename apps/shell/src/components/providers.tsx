"use client";

import * as React from "react";
import { KitLabelsProvider, type KitLabels } from "@neton/application-front-kit";
import { loadSitePublic } from "@neton/application-front-runtime/brand";
import { I18nProvider, i18nConfigFromEnv, useFormat, useT } from "@neton/application-front-runtime/i18n";
import { runtimeCatalogs } from "@neton/application-front-runtime/messages";
import { localeRegistry } from "@/generated/modules.generated";
import { shellCatalogs } from "@/messages";
import { loadUserLocale, localeSubject } from "@/lib/locale-preference";

const config = i18nConfigFromEnv();
const catalogs = { ...runtimeCatalogs, ...shellCatalogs };

/**
 * 根部的客户端 Provider：国际化（宿主 / 运行时词条静态打入，模块词条随模块懒加 载）。
 * 登录账号以本人 system_users.locale 为准，无偏好回站点默认；匿名使用手选 > 浏览器语言 > 站点默认。
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [siteLocale, setSiteLocale] = React.useState<string | undefined>(undefined);
  const [subject, setSubject] = React.useState<string | undefined>(undefined);
  const [refresh, recheck] = React.useReducer((n) => n + 1, 0);
  const [userLocale, setUserLocale] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    const focused = () => recheck();
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, []);
  React.useEffect(() => {
    loadSitePublic().then((data) => {
      const value = data.locale?.trim();
      if (value && config.locales.includes(value)) setSiteLocale(value);
    });
    let active = true;
    loadUserLocale().then((value) => {
      if (!active) return;
      setSubject(localeSubject());
      // undefined is anonymous; null is an authenticated subject without a preference.
      setUserLocale(value);
    }).catch(() => { /* transient failure must not clear the last known preference */ });
    return () => { active = false; };
  }, [refresh]);
  return (
    <I18nProvider key={subject ?? "anonymous"} config={config} registry={localeRegistry} catalogs={catalogs} siteLocale={siteLocale} userLocale={userLocale}>
      <KitLabelsBridge>{children}</KitLabelsBridge>
    </I18nProvider>
  );
}

/** 把当前语言的 kit 文案注入 front-kit（kit 自身不依赖 i18n 实现）。 */
function KitLabelsBridge({ children }: { children: React.ReactNode }) {
  const t = useT("kit");
  const fmt = useFormat();
  const labels = React.useMemo<KitLabels>(() => ({
    emptyTitle: t("emptyTitle"),
    emptyDescription: t("emptyDescription"),
    total: (count) => t("total", { count }),
    perPage: (size) => t("perPage", { size }),
    previous: t("previous"),
    next: t("next"),
    goTo: t("goTo"),
    pageNumber: t("pageNumber"),
    pageSuffix: t("pageSuffix"),
    moreActions: t("moreActions"),
    close: (title) => t("close", { title }),
    confirm: t("confirm"),
    cancel: t("cancel"),
    processing: t("processing"),
    formatNumber: (value) => fmt.number(value),
  }), [t, fmt]);
  return <KitLabelsProvider labels={labels}>{children}</KitLabelsProvider>;
}
