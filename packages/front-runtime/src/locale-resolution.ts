import type { I18nConfig } from "./i18n";

// A single tag, never an Accept-Language header/list. Candidate order is not a language policy.
export function matchLocale(preference: string | undefined, locales: string[]): string | undefined {
  if (!preference) return undefined;
  let tag: Intl.Locale;
  try { tag = new Intl.Locale(preference.replaceAll("_", "-")); } catch { return undefined; }
  const candidates = locales.map((value) => ({ value, tag: new Intl.Locale(value) }));
  const exact = candidates.find((c) => c.tag.toString() === tag.toString());
  if (exact) return exact.value;
  if (tag.language === "zh") {
    const script = tag.script ?? (["TW", "HK", "MO"].includes(tag.region ?? "") ? "Hant" : "Hans");
    return candidates.filter((c) => c.tag.language === "zh" && c.tag.maximize().script === script)
      .sort((a, b) => a.value.localeCompare(b.value))[0]?.value;
  }
  return candidates.filter((c) => c.tag.language === tag.language && (!tag.script || c.tag.maximize().script === tag.script))
    .sort((a, b) => Number(b.tag.toString() === tag.language) - Number(a.tag.toString() === tag.language) || a.value.localeCompare(b.value))[0]?.value;
}

export function resolveInitialLocale(config: I18nConfig, siteLocale?: string, userLocale?: string | null): string {
  const fallback = matchLocale(siteLocale, config.locales) ?? config.defaultLocale;
  // Authenticated subjects never inherit another subject's local cache.
  if (userLocale !== undefined) return matchLocale(userLocale ?? undefined, config.locales) ?? fallback;
  if (typeof window === "undefined") return fallback;
  const saved = matchLocale(window.localStorage.getItem("neton.locale") ?? undefined, config.locales);
  if (saved) return saved;
  for (const preference of window.navigator.languages ?? [window.navigator.language]) {
    const matched = matchLocale(preference, config.locales);
    if (matched) return matched;
  }
  return fallback;
}
