"use client";

import * as React from "react";
import { Languages } from "lucide-react";
import { useLocale, useT } from "@neton/application-front-runtime/i18n";
import { saveUserLocale } from "@/lib/locale-preference";

/**
 * 语言切换：本地缓存立即写入（下次首帧直接命中），登录后同步持久化到本人资料
 * （system_users.locale），换浏览器 / 清缓存仍跟随本人选择；登录页等匿名场景只改本地。
 * 语言名用各自语言书写，切换前后都认得出来。
 */
const LANGUAGE_NAMES: Record<string, string> = { "zh-CN": "简体中文", "en-US": "English" };

export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, locales, setLocale } = useLocale();
  const t = useT("shell");
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  if (locales.length < 2) return null;
  const onChange = (next: string) => {
    setLocale(next); // 内部已写 localStorage
    setSaving(true);
    setFailed(false);
    void saveUserLocale(next).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLocale(locale);
      setFailed(true);
    }).finally(() => setSaving(false));
  };
  return (
    <span className="inline-flex flex-col gap-1"><label className={className ?? "flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 text-[var(--muted-foreground)] shadow-sm"}>
      <Languages size={14} aria-hidden />
      <span className="sr-only">{t("locale.label")}</span>
      <select
        value={locale}
        disabled={saving}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-xs text-[var(--foreground)] outline-none"
      >
        {locales.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l] ?? l}</option>)}
      </select>
    </label>{failed && <span role="status" className="text-xs text-[var(--destructive)]">{t("locale.saveFailed")}</span>}</span>
  );
}
