"use client";

import * as React from "react";
import { loadSitePublic } from "./brand";

/**
 * 人机验证的公开配置，来自 system 模块的 `/admin/system/site/public`（spec auth-abuse-protection §6.1）。
 *
 * 要不要验证由后端决定：前端只按这里的 actions 渲染组件、把凭证放进 [CAPTCHA_HEADER] 发回去，
 * 真正的核验在后端。前端不渲染、不带凭证，后端照样拒绝 —— 关掉前端开关绕不过去。
 */
export interface CaptchaConfig {
  /** 空串 = 未启用。 */
  provider: string;
  siteKey: string;
  /** 需要验证的动作：login / register / send_code / admin_login。 */
  actions: string[];
}

/** 凭证随请求放在这个头里，不进请求体：各接口的 DTO 不用为验证码改字段。 */
export const CAPTCHA_HEADER = "X-Captcha-Token";

export const NO_CAPTCHA: CaptchaConfig = { provider: "", siteKey: "", actions: [] };

export function captchaRequired(config: CaptchaConfig | null | undefined, action: string): boolean {
  return !!config && config.provider === "turnstile" && !!config.siteKey && config.actions.includes(action);
}

/** 只认已知字段，其余丢弃；解析不出来按未启用处理（后端仍会拒绝缺凭证的请求）。 */
export function parseCaptchaConfig(raw: unknown): CaptchaConfig {
  if (!raw || typeof raw !== "object") return NO_CAPTCHA;
  const r = raw as Record<string, unknown>;
  return {
    provider: typeof r.provider === "string" ? r.provider : "",
    siteKey: typeof r.siteKey === "string" ? r.siteKey : "",
    actions: Array.isArray(r.actions) ? r.actions.filter((a): a is string => typeof a === "string") : [],
  };
}

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
      script.onerror = () => { scriptPromise = null; reject(new Error("turnstile script failed")); };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export interface CaptchaHandle {
  /** 凭证一次性：每次提交后（无论成败）都要重置，拿新的凭证再提交。 */
  reset(): void;
}

/**
 * Turnstile 组件。拿到凭证回调 [onToken]，过期或出错回调 null。
 * `action` 会随凭证一起被后端核对，同一凭证不能挪到别的动作上用。
 */
export const CaptchaWidget = React.forwardRef<CaptchaHandle, {
  config: CaptchaConfig;
  action: string;
  onToken: (token: string | null) => void;
  onError?: () => void;
  theme?: "light" | "dark" | "auto";
  className?: string;
}>(function CaptchaWidget({ config, action, onToken, onError, theme = "auto", className }, ref) {
  const box = React.useRef<HTMLDivElement>(null);
  const widgetId = React.useRef<string | null>(null);
  const callbacks = React.useRef({ onToken, onError });
  callbacks.current = { onToken, onError };

  React.useImperativeHandle(ref, () => ({
    reset() {
      callbacks.current.onToken(null);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
  }), []);

  React.useEffect(() => {
    if (!captchaRequired(config, action)) return;
    let cancelled = false;
    loadTurnstile().then((api) => {
      if (cancelled || !box.current) return;
      widgetId.current = api.render(box.current, {
        sitekey: config.siteKey,
        action,
        theme,
        callback: (token: string) => callbacks.current.onToken(token),
        "expired-callback": () => callbacks.current.onToken(null),
        "error-callback": () => { callbacks.current.onToken(null); callbacks.current.onError?.(); },
      });
    }).catch(() => callbacks.current.onError?.());
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [config, action, theme]);

  if (!captchaRequired(config, action)) return null;
  return <div ref={box} className={className} />;
});

/**
 * 表单用法：`ready` 为 false 时禁用提交，请求带上 `headers`，提交失败后 `reset()` 换新凭证。
 * 不需要验证的动作 `widget` 渲染为空、`ready` 恒为 true，页面不用分支。
 */
export function useCaptcha(config: CaptchaConfig, action: string, theme?: "light" | "dark" | "auto") {
  const ref = React.useRef<CaptchaHandle>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const required = captchaRequired(config, action);
  return {
    required,
    ready: !required || !!token,
    headers: (token ? { [CAPTCHA_HEADER]: token } : {}) as Record<string, string>,
    reset: () => ref.current?.reset(),
    widget: <CaptchaWidget ref={ref} config={config} action={action} onToken={setToken} theme={theme} className="min-h-[65px]" />,
  };
}

/** 当前人机验证配置，来自公开站点接口；拿到之前按未启用处理（后端仍会拒绝缺凭证的请求）。 */
export function useCaptchaConfig(): CaptchaConfig {
  const [config, setConfig] = React.useState<CaptchaConfig>(NO_CAPTCHA);
  React.useEffect(() => {
    let cancelled = false;
    loadSitePublic().then((data) => { if (!cancelled) setConfig(parseCaptchaConfig(data.captcha)); });
    return () => { cancelled = true; };
  }, []);
  return config;
}
