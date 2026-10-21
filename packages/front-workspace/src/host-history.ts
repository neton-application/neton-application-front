import { normalizeBasePath, stripBasePath, withBasePath } from "./base-path";
import type { WorkspaceHostAdapter } from "./types";

/** 我们在 history.state 上的命名空间。绝不整体覆盖 state —— 宿主的内部字段也在里面。 */
const NS = "__neton_workspace";

interface WorkspaceHistoryState { instanceId: string }

function readNs(state: unknown): WorkspaceHistoryState | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[NS];
  if (!value || typeof value !== "object") return null;
  const id = (value as Record<string, unknown>).instanceId;
  return typeof id === "string" ? { instanceId: id } : null;
}

/**
 * 浏览器 History 宿主适配器。
 *
 * 🔴 只能走 `window.history.pushState/replaceState` 这两个**公开 API**，
 * 不要缓存 original 引用绕过去，也不要改用 Navigation API。
 *
 * 原因（Next 16 App Router 实测）：它给 pushState/replaceState 打了补丁，会把
 * 自己的内部字段合并进我们传的 state；而它的 popstate 处理里有一条
 * 「条目 state 上没有它的内部标记 → `window.location.reload()`」。
 * 一旦有任何路径绕过补丁写了历史，用户按后退就是整页刷新，
 * 工作区里所有实例连同未保存内容一起没。行为回归见 gate2 用例
 * 「后退不得触发 load 事件」。
 *
 * 我们只读写自己命名空间下的字段，不读也不写宿主的内部字段。
 */
export interface BrowserHistoryHostOptions {
  /**
   * 工作区挂载的路径前缀（如 `/my`）；省略或空串 = 根路径。见 base-path.ts：工作区内部的地址
   * 不带前缀，只有写进地址栏与 `<a href>` 时才加。
   */
  basePath?: string;
}

export function createBrowserHistoryHost(options: BrowserHistoryHostOptions = {}): WorkspaceHostAdapter {
  const basePath = normalizeBasePath(options.basePath);
  const current = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return {
    read() {
      // 工作区只挂在前缀下；万一在前缀外启动，按首页处理（store 会把地址栏改回前缀首页）
      return stripBasePath(basePath, current()) ?? "/";
    },
    readInstanceId() {
      return readNs(window.history.state)?.instanceId ?? null;
    },
    push(href, instanceId) {
      const prev = (window.history.state ?? {}) as Record<string, unknown>;
      window.history.pushState({ ...prev, [NS]: { instanceId } }, "", withBasePath(basePath, href));
    },
    replace(href, instanceId) {
      const prev = (window.history.state ?? {}) as Record<string, unknown>;
      window.history.replaceState({ ...prev, [NS]: { instanceId } }, "", withBasePath(basePath, href));
    },
    subscribe(listener) {
      const onPop = () => {
        // 后退到前缀外（门户页面）由宿主路由处理，工作区不接
        const href = stripBasePath(basePath, current());
        if (href !== null) listener(href, readNs(window.history.state)?.instanceId ?? null);
      };
      window.addEventListener("popstate", onPop);
      return () => window.removeEventListener("popstate", onPop);
    },
    toExternal(href) {
      return withBasePath(basePath, href);
    },
    toInternal(href) {
      return stripBasePath(basePath, href);
    },
  };
}
