"use client";

/**
 * 后台账号本人的界面语言（服务端持久）：存 system_users.locale，
 * 读写走 /admin/system/user/profile 的 get / update（部分更新语义：只传 locale，其余字段不动）。
 *
 * - 空串 / 401 = 未设置或未登录：语言回后台「站点语言」；
 * - 刻意用裸 fetch 而不是 apiFetch：后者遇 401 会强制跳登录页，登录页上的匿名读取会变成重定向循环；
 * - 写失败抛出，调用方回滚；匿名选择只作用于当前浏览器。
 */
import { backendBaseUrl } from "@neton/application-front-runtime/client";
import { createAdminLocalePreferences } from "./locale-preference-store";

interface Envelope<T> {
  code: number;
  data?: T;
}

interface ProfileVO {
  id: string | number;
  locale?: string;
}

async function request(path: string, init?: RequestInit): Promise<Envelope<ProfileVO> | null> {
  try {
    const res = await fetch(`${backendBaseUrl()}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "X-Neton-Csrf": "1",
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...Object.fromEntries(new Headers(init?.headers)),
      },
      cache: "no-store",
      signal: init?.signal ?? AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return { code: 401 };
    if (!res.ok) return null;
    return (await res.json()) as Envelope<ProfileVO>;
  } catch {
    return null;
  }
}

/** Anonymous is undefined, authenticated without a choice is null; network failures remain failures. */
const preferences = createAdminLocalePreferences(request);
export const loadUserLocale = preferences.load;
export const localeSubject = preferences.currentSubject;

/** Anonymous choice stays local; a signed-in save failure must never be reported as synchronized. */
export function saveUserLocale(locale: string): Promise<void> {
  return preferences.save(locale).catch((error) => {
    if (error instanceof DOMException && error.message === "SUBJECT_CHANGED") window.location.reload();
    throw error;
  });
}
