"use client";

/**
 * 国际化运行时（评审 R12）。
 *
 * - 词条按**命名空间**组织：模块 id 一个命名空间（`system`、`member`…），宿主与基础包用
 *   `shell`、`kit`、`runtime`、`errors`。模块只维护自己的词条，不碰别人的。
 * - 词条是扁平的 `key → 模板`。模板支持 `{name}` 插值和复数
 *   `{count, plural, one {# item} other {# items}}`（`#` 代入数字），复数规则用 Intl.PluralRules。
 * - 模块词条随模块懒加载（构建期注册表给出 loader），切换语言时只加载用得到的那一份。
 * - 缺失的词条回退到默认语言，再回退到 key 本身；开发环境在控制台告警，`scripts/check-locales.mts`
 *   在构建前检查各语言 key 是否齐全。
 * - 日期、数字、金额一律走 Intl，跟随当前语言；金额必须带币种，按币种的小数位格式化，
 *   不再写死 `¥` 和两位小数。
 */

import * as React from "react";
import { matchLocale, resolveInitialLocale } from "./locale-resolution";
import { setFormatLocale } from "./types";

export type Messages = Record<string, string>;
export type MessageLoader = () => Promise<{ default: Messages }>;
/** namespace → locale → loader */
export type LocaleRegistry = Record<string, Record<string, MessageLoader>>;
/** namespace → locale → messages（随包静态打入的词条，如宿主与基础包） */
export type StaticCatalogs = Record<string, Record<string, Messages>>;

export interface I18nConfig {
  locales: string[];
  defaultLocale: string;
  /** 展示时区；缺省用浏览器时区。服务端一律以 UTC 时间戳传输。 */
  timeZone?: string;
}

const STORAGE_KEY = "neton.locale";

/** 构建期配置：NEXT_PUBLIC_NETON_LOCALES（逗号分隔）、NEXT_PUBLIC_NETON_DEFAULT_LOCALE、NEXT_PUBLIC_NETON_TIME_ZONE。 */
export function i18nConfigFromEnv(): I18nConfig {
  const locales = (process.env.NEXT_PUBLIC_NETON_LOCALES ?? "zh-CN,en-US").split(",").map((s) => s.trim()).filter(Boolean);
  const defaultLocale = process.env.NEXT_PUBLIC_NETON_DEFAULT_LOCALE?.trim() || locales[0] || "zh-CN";
  return { locales, defaultLocale, timeZone: process.env.NEXT_PUBLIC_NETON_TIME_ZONE?.trim() || undefined };
}

/** Authenticated: saved preference, then site default. Anonymous: explicit local choice, browser, default. */
export { resolveInitialLocale } from "./locale-resolution";

// ---------------------------------------------------------------------------
// 模板

/** 渲染一条模板。导出给测试与非 React 场景（如 manifest 标题）使用。 */
export function formatMessage(template: string, params: Record<string, unknown> | undefined, locale: string): string {
  if (!params) return template;
  return template.replace(
    /\{(\w+)(?:,\s*plural,\s*((?:[^{}]|\{[^{}]*\})*))?\}/g,
    (whole, name: string, plural: string | undefined) => {
      const value = params[name];
      if (plural === undefined) return value === undefined || value === null ? whole : String(value);
      const n = Number(value);
      const options = parsePluralOptions(plural);
      const exact = options[`=${n}`];
      const category = new Intl.PluralRules(locale).select(n);
      const chosen = exact ?? options[category] ?? options.other ?? "";
      return chosen.replace(/#/g, new Intl.NumberFormat(locale).format(n));
    },
  );
}

function parsePluralOptions(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(=?\w+)\s*\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out[m[1]] = m[2];
  return out;
}

// ---------------------------------------------------------------------------
// Provider

interface I18nState {
  config: I18nConfig;
  locale: string;
  setLocale: (locale: string) => void;
  lookup: (namespace: string, key: string) => string | undefined;
  ensureNamespace: (namespace: string) => void;
  version: number;
}

const I18nContext = React.createContext<I18nState | null>(null);

export function I18nProvider({
  config,
  registry = {},
  catalogs = {},
  siteLocale,
  userLocale,
  children,
}: {
  config: I18nConfig;
  registry?: LocaleRegistry;
  catalogs?: StaticCatalogs;
  /**
   * 后台「站点语言」下发的全站默认：服务端渲染与客户端首帧直接用它，不等挂载后 再探测，
   * 避免先闪默认语言。个人偏好（userLocale / 本地缓存）仍优先于它。
   */
  siteLocale?: string;
  /**
   * 登录后台账号的服务端持久偏好（本人界面语言）。异步到达：有效值一到即覆盖当前语言；
   * 空串 / null 表示未设置（回站点默认）。
   */
  userLocale?: string | null;
  children: React.ReactNode;
}) {
  // 首帧：服务端/客户端都先落在后台站点语言上（无效值回退默认），挂载后再叠加个人偏好与浏览器协商。
  const [locale, setLocaleState] = React.useState(
    () => matchLocale(userLocale ?? undefined, config.locales) ?? matchLocale(siteLocale, config.locales) ?? config.defaultLocale,
  );
  const manual = React.useRef<string | undefined>(undefined);
  const previousUser = React.useRef(userLocale);
  const loaded = React.useRef(new Map<string, Messages>()); // `${ns}:${locale}`
  const inflight = React.useRef(new Set<string>());
  const [version, bump] = React.useReducer((n: number) => n + 1, 0);

  // 首次挂载后再读本地偏好与浏览器协商；个人偏好（userLocale）异步到达后重新解析并覆盖。
  // Identity-scoped host keys reset manual state on account changes. A late site default is not a user choice.
  React.useEffect(() => {
    // Only explicit local choices are persisted; a late site default must not mask browser negotiation.
    if (previousUser.current !== userLocale) manual.current = undefined;
    previousUser.current = userLocale;
    setLocaleState(manual.current ?? resolveInitialLocale(config, siteLocale, userLocale));
  }, [config, siteLocale, userLocale]);
  React.useEffect(() => {
    document.documentElement.lang = locale;
    setFormatLocale(locale, config.timeZone);
  }, [locale, config.timeZone]);

  const load = React.useCallback((namespace: string, lang: string) => {
    const id = `${namespace}:${lang}`;
    if (loaded.current.has(id) || inflight.current.has(id)) return;
    const loader = registry[namespace]?.[lang];
    if (!loader) return;
    inflight.current.add(id);
    loader().then(
      (mod) => { loaded.current.set(id, mod.default); inflight.current.delete(id); bump(); },
      () => { inflight.current.delete(id); },
    );
  }, [registry]);

  const ensureNamespace = React.useCallback((namespace: string) => {
    load(namespace, locale);
    if (locale !== config.defaultLocale) load(namespace, config.defaultLocale);
  }, [load, locale, config.defaultLocale]);

  const lookup = React.useCallback((namespace: string, key: string): string | undefined => {
    for (const lang of [locale, config.defaultLocale]) {
      const fromStatic = catalogs[namespace]?.[lang]?.[key];
      if (fromStatic !== undefined) return fromStatic;
      const fromLoaded = loaded.current.get(`${namespace}:${lang}`)?.[key];
      if (fromLoaded !== undefined) return fromLoaded;
    }
    return undefined;
    // version 让 lookup 在词条到达后换引用，触发依赖它的组件重渲染
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogs, locale, config.defaultLocale, version]);

  const setLocale = React.useCallback((next: string) => {
    if (!config.locales.includes(next)) return;
    manual.current = next;
    window.localStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
  }, [config.locales]);

  const value = React.useMemo<I18nState>(
    () => ({ config, locale, setLocale, lookup, ensureNamespace, version }),
    [config, locale, setLocale, lookup, ensureNamespace, version],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18nState(): I18nState {
  const state = React.useContext(I18nContext);
  if (!state) throw new Error("I18nProvider is missing: wrap the app with <I18nProvider>.");
  return state;
}

export function useLocale(): { locale: string; locales: string[]; setLocale: (locale: string) => void } {
  const s = useI18nState();
  return { locale: s.locale, locales: s.config.locales, setLocale: s.setLocale };
}

const warned = new Set<string>();

export interface Translate {
  (key: string, params?: Record<string, unknown>): string;
  /** 该命名空间下是否有这个 key（任一回退语言里有即可）。 */
  has: (key: string) => boolean;
}

/** 取某个命名空间的翻译函数。缺失的 key 回退到默认语言，再回退到 key 本身。 */
export function useT(namespace: string): Translate {
  const s = useI18nState();
  React.useEffect(() => { s.ensureNamespace(namespace); }, [s, namespace]);
  return React.useMemo(() => {
    const t = ((key: string, params?: Record<string, unknown>) => {
      const template = s.lookup(namespace, key);
      if (template === undefined) {
        const id = `${namespace}.${key}`;
        if (process.env.NODE_ENV !== "production" && !warned.has(id)) {
          warned.add(id);
          console.warn(`[i18n] missing message ${id} (${s.locale})`);
        }
        return key;
      }
      return formatMessage(template, params, s.locale);
    }) as Translate;
    t.has = (key: string) => s.lookup(namespace, key) !== undefined;
    return t;
  }, [s, namespace]);
}

/**
 * 跨多个命名空间查找同一个 key，返回第一个命中的模板（已代入参数），都没有返回 undefined。
 * 宿主用它翻译菜单与页签标题：菜单属于哪个模块事先不知道。会确保这些命名空间都已加载。
 */
export function useLookupAcross(namespaces: readonly string[]): (key: string, params?: Record<string, unknown>) => string | undefined {
  const s = useI18nState();
  const key = namespaces.join("|");
  React.useEffect(() => { for (const ns of namespaces) s.ensureNamespace(ns); }, [s, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return React.useCallback((k: string, params?: Record<string, unknown>) => {
    for (const ns of namespaces) {
      const template = s.lookup(ns, k);
      if (template !== undefined) return formatMessage(template, params, s.locale);
    }
    return undefined;
  }, [s, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** 当前是否为默认语言（默认语言下菜单直接用后端配置的名称，运营改的名字照样生效）。 */
export function useIsDefaultLocale(): boolean {
  const s = useI18nState();
  return s.locale === s.config.defaultLocale;
}

// ---------------------------------------------------------------------------
// 格式化

export interface Formatters {
  /** 时间戳（秒或毫秒，或 ISO 字符串）→ 日期时间；空值显示 "-"。 */
  dateTime: (value?: number | string | null) => string;
  date: (value?: number | string | null) => string;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  /**
   * 金额。[minorUnits] 是最小货币单位的整数（分、日元等），按币种的小数位换算与展示：
   * CNY/USD 两位、JPY 零位、KWD/BHD 三位。币种必须给出，不再假设人民币。
   */
  money: (minorUnits: number, currency: string) => string;
}

export function useFormat(): Formatters {
  const { locale, config } = useI18nState();
  return React.useMemo(() => createFormatters(locale, config.timeZone), [locale, config.timeZone]);
}

export function createFormatters(locale: string, timeZone?: string): Formatters {
  const toDate = (value?: number | string | null): Date | null => {
    if (value === null || value === undefined || value === "" || value === 0 || value === "0") return null;
    const numeric = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    const ms = typeof numeric === "number" && numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const dateTimeFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", hour12: false, timeZone });
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone });
  return {
    dateTime: (v) => { const d = toDate(v); return d ? dateTimeFmt.format(d) : v ? String(v) : "-"; },
    date: (v) => { const d = toDate(v); return d ? dateFmt.format(d) : v ? String(v) : "-"; },
    number: (v, options) => new Intl.NumberFormat(locale, options).format(v),
    money: (minorUnits, currency) => {
      const fmt = new Intl.NumberFormat(locale, { style: "currency", currency });
      const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
      return fmt.format(minorUnits / 10 ** digits);
    },
  };
}
