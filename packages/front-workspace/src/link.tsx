"use client";

import * as React from "react";
import { useWorkspaceStore } from "./context";
import { resolveRoute } from "./route";
import type { WorkspacePage } from "./types";

export interface WorkspaceLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  /** 同一资源另开一个页签。 */
  newInstance?: boolean;
}

/**
 * 工作区内导航的正式出口。`to` 是工作区地址（与 manifest path 同一套，不带宿主前缀）。
 *
 * 仍然渲染真正的 `<a href>`（宿主挂在前缀下时自动加前缀）—— 中键、Ctrl/Cmd 点击、
 * 右键「在新标签页打开」、复制链接地址都必须照常工作；只有普通左键点击才被接管。
 */
export function WorkspaceLink({ to, newInstance, onClick, ...rest }: WorkspaceLinkProps) {
  const store = useWorkspaceStore();
  return (
    <a
      {...rest}
      href={store.hrefOf(to)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (!isPlainLeftClick(event.nativeEvent)) return;
        event.preventDefault();
        store.open(to, { forceNew: newInstance });
      }}
    />
  );
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * 兼容垫片：接管尚未迁移到 [WorkspaceLink] 的原生 `<a href>`。
 *
 * 这是迁移期设施，不是长期导航架构 —— 它接不住 `window.location.href = ...`
 * 和程序化跳转。只拦截**能被注册表解析出页面**的同源普通左键点击，其余
 * （外链、下载、新窗口、锚点、带修饰键）一律放行给浏览器。
 */
export function useWorkspaceLinkDelegation(pages: WorkspacePage[]): void {
  const store = useWorkspaceStore();
  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !isPlainLeftClick(event)) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      if (anchor.hasAttribute("download") || anchor.getAttribute("target") === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || /^[a-z]+:/i.test(href)) return;
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      // 原生链接写的是浏览器地址：先去掉宿主前缀；不在前缀下的（门户页面）交给浏览器
      const relative = store.internalHrefOf(`${url.pathname}${url.search}${url.hash}`);
      if (relative === null || !resolveRoute(pages, relative)) return;
      event.preventDefault();
      store.open(relative);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [store, pages]);
}
