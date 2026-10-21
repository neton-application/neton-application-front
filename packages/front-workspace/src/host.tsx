"use client";

import * as React from "react";
import { WorkspaceInstanceProvider, instanceTitle, useWorkspace, useWorkspaceStore } from "./context";
import type { WorkspaceInstance, WorkspacePage } from "./types";

/**
 * UI 套件适配。
 *
 * 工作区**不依赖任何具体的 UI 包** —— admin 线用 front-kit，C 端线用 client-kit，
 * 两条线各有一份 Portal / 导航 context。运行时若直接 import 其中一个，另一条线
 * 的弹层就挂不进本实例容器（拿到的是另一个 context 的默认值），表现为抽屉跑到
 * body 上、隐藏页签的弹层和当前页签叠在一起。
 *
 * 因此由宿主注入：宿主知道自己用哪套 kit。
 */
export interface WorkspaceUiAdapter {
  /** 把「弹层容器解析函数」提供给 UI 套件。 */
  PortalHostProvider: React.ComponentType<{ container: () => Element | null; children: React.ReactNode }>;
  /**
   * 把「打开站内地址」提供给 UI 套件（列表行的详情按钮等）。`open` 收工作区地址；
   * `hrefOf` 把工作区地址换成浏览器地址，供 kit 渲染 `<a href>`（宿主可能挂在路径前缀下）。
   */
  NavigationProvider: React.ComponentType<{ navigation: WorkspaceKitNavigation; children: React.ReactNode }>;
}

export interface WorkspaceKitNavigation {
  open(href: string): void;
  hrefOf(href: string): string;
}

/*
 * 🔴 [WorkspaceHost] 的 `ui` 是**必填**，不给默认值。
 *
 * 给过默认（透传）实现：宿主忘了注入照样编译通过、页面照常渲染，只是弹层悄悄
 * 挂回 document.body —— 每实例归属失效，隐藏页签的抽屉和当前页签叠在一起，
 * 而且只有专门去断言 portal 容器才看得出来。必填能让这类遗漏在编译期就炸。
 */

/**
 * 工作区自身的界面文案，由宿主按当前语言注入（工作区不依赖任何 i18n 实现，同 [WorkspaceUiAdapter]）。
 */
export interface WorkspaceLabels {
  loading: string;
  renderFailed: (title: string) => string;
  loadFailed: (title: string) => string;
  staleVersion: string;
  retry: string;
  reload: string;
  confirmCloseDirty: (title: string) => string;
}

export const defaultWorkspaceLabels: WorkspaceLabels = {
  loading: "正在加载页面…",
  renderFailed: (title) => `「${title}」渲染失败`,
  loadFailed: (title) => `「${title}」加载失败`,
  staleVersion: "系统已更新，请刷新页面以加载新版本。",
  retry: "重试",
  reload: "刷新页面",
  confirmCloseDirty: (title) => `「${title}」有未保存内容，仍要关闭吗？`,
};

/** 宿主在工作区最外层注入文案：页签栏、[useCloseGuard] 都在实例宿主之外，也要拿得到。 */
const WorkspaceLabelsContext = React.createContext<WorkspaceLabels>(defaultWorkspaceLabels);

export function WorkspaceLabelsProvider({ labels, children }: { labels: WorkspaceLabels; children: React.ReactNode }) {
  return <WorkspaceLabelsContext.Provider value={labels}>{children}</WorkspaceLabelsContext.Provider>;
}

class InstanceErrorBoundary extends React.Component<
  { title: string; labels: WorkspaceLabels; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="m-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        <div className="font-semibold">{this.props.labels.renderFailed(this.props.title)}</div>
        <div className="mt-2 break-all text-xs">{this.state.error.message}</div>
        <button type="button" className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold" onClick={() => this.setState({ error: null })}>
          {this.props.labels.retry}
        </button>
      </div>
    );
  }
}

/** 组件按 pageKey 缓存：同一页面的多个实例共用一次模块加载。 */
const componentCache = new Map<string, React.ComponentType>();
const loadingCache = new Map<string, Promise<React.ComponentType>>();

type PageLoad =
  | { status: "loading" }
  | { status: "ready"; Component: React.ComponentType }
  | { status: "error"; error: Error; retry: () => void };

/**
 * 加载页面组件（评审 R14）。
 *
 * 失败的加载**不留在缓存里**：否则同一个失败的 Promise 会被后续每次挂载复用，页面永远停在
 * 「加载中」。失败时给出错误态和重试；同一时间多个实例等待同一页面仍只发一次请求。
 */
function loadPage(page: WorkspacePage): Promise<React.ComponentType> {
  let pending = loadingCache.get(page.key);
  if (!pending) {
    pending = page.load().then(
      (mod) => {
        componentCache.set(page.key, mod.default);
        loadingCache.delete(page.key);
        return mod.default;
      },
      (error: unknown) => {
        loadingCache.delete(page.key);
        throw error instanceof Error ? error : new Error(String(error));
      },
    );
    loadingCache.set(page.key, pending);
  }
  return pending;
}

function usePageComponent(page: WorkspacePage | undefined): PageLoad {
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<PageLoad>(() => {
    const cached = page ? componentCache.get(page.key) : undefined;
    return cached ? { status: "ready", Component: cached } : { status: "loading" };
  });

  React.useEffect(() => {
    if (!page) return;
    const cached = componentCache.get(page.key);
    if (cached) { setState({ status: "ready", Component: cached }); return; }
    let cancelled = false;
    setState({ status: "loading" });
    loadPage(page).then(
      (Component) => { if (!cancelled) setState({ status: "ready", Component }); },
      (error: Error) => {
        if (!cancelled) setState({ status: "error", error, retry: () => setAttempt((n) => n + 1) });
      },
    );
    return () => { cancelled = true; };
  }, [page, attempt]);

  return state;
}

/** 新版本发布后旧页面引用的分包已不存在：重试没用，只能整页刷新拿到新的清单。 */
function isStaleChunk(error: Error): boolean {
  return error.name === "ChunkLoadError" || /Loading (CSS )?chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(error.message);
}

function PageLoadError({ title, error, retry, labels }: { title: string; error: Error; retry: () => void; labels: WorkspaceLabels }) {
  const stale = isStaleChunk(error);
  return (
    <div role="alert" className="m-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
      <div className="font-semibold">{labels.loadFailed(title)}</div>
      <div className="mt-2 break-all text-xs">{stale ? labels.staleVersion : error.message}</div>
      <button
        type="button"
        className="mt-3 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold"
        onClick={() => (stale ? window.location.reload() : retry())}
      >
        {stale ? labels.reload : labels.retry}
      </button>
    </div>
  );
}

function InstanceFrame({ instance, page, visible, ui, labels }: { instance: WorkspaceInstance; page: WorkspacePage | undefined; visible: boolean; ui: WorkspaceUiAdapter; labels: WorkspaceLabels }) {
  const load = usePageComponent(page);
  const portalRef = React.useRef<HTMLDivElement>(null);
  const getPortal = React.useCallback(() => portalRef.current, []);
  const { PortalHostProvider } = ui;

  return (
    <WorkspaceInstanceProvider instance={instance}>
      <PortalHostProvider container={getPortal}>
        {/*
          每实例独立滚动容器。Activity 隐藏保留 DOM，所以 scrollTop 天然保住，
          不需要手动记录/恢复滚动位置。挂在 shell 共用的 <main> 上则做不到。
        */}
        <div
          data-workspace-instance={instance.instanceId}
          data-workspace-active={visible ? "true" : "false"}
          className="h-full overflow-auto"
        >
          <div className="mx-auto w-full max-w-[1640px] p-4 md:p-6 lg:p-8">
            <InstanceErrorBoundary title={instanceTitle(instance)} labels={labels}>
              {load.status === "ready" ? <load.Component /> : load.status === "error" ? (
                <PageLoadError title={instanceTitle(instance)} error={load.error} retry={load.retry} labels={labels} />
              ) : (
                <div role="status" className="flex min-h-[40vh] items-center justify-center text-sm text-[var(--muted-foreground)]">
                  {labels.loading}
                </div>
              )}
            </InstanceErrorBoundary>
          </div>
          <div ref={portalRef} data-workspace-portal={instance.instanceId} />
        </div>
      </PortalHostProvider>
    </WorkspaceInstanceProvider>
  );
}

/**
 * 持久实例宿主。
 *
 * 用 `<Activity>` 而不是 `display:none`：后者只藏 DOM，effect 继续跑，N 个页签
 * 就是 N 份定时器/订阅/observer 在后台空转。Activity 隐藏时**卸载 effect、保留
 * state 与 DOM**，显示时重挂 effect —— 这是实测确认过的语义，也是本设计的地基。
 *
 * 这里没有任何自动回收：已打开的实例只有 close() 能销毁。
 */
export function WorkspaceHost({ pages, ui }: { pages: WorkspacePage[]; ui: WorkspaceUiAdapter }) {
  const labels = React.useContext(WorkspaceLabelsContext);
  const { instances, activeId } = useWorkspace();
  const store = useWorkspaceStore();
  const { NavigationProvider } = ui;
  const pageMap = React.useMemo(() => new Map(pages.map((p) => [p.key, p])), [pages]);
  // front-kit 里的 RowActions / KitLink 通过这个适配器走工作区导航，
  // 不再整页跳转（它们是列表页「详情」按钮的实际出口）。
  const kitNavigation = React.useMemo<WorkspaceKitNavigation>(() => ({
    open: (href) => { store.open(href); },
    hrefOf: (href) => store.hrefOf(href),
  }), [store]);

  return (
    <NavigationProvider navigation={kitNavigation}>
      {instances.map((instance) => {
        const visible = instance.instanceId === activeId;
        return (
          <React.Activity key={instance.instanceId} mode={visible ? "visible" : "hidden"}>
            <div className={visible ? "h-full" : "hidden"}>
              <InstanceFrame instance={instance} page={pageMap.get(instance.pageKey)} visible={visible} ui={ui} labels={labels} />
            </div>
          </React.Activity>
        );
      })}
    </NavigationProvider>
  );
}

/** 关闭前的未保存确认由调用方决定；这里只暴露判据。 */
export function useCloseGuard() {
  const store = useWorkspaceStore();
  const { instances } = useWorkspace();
  const labels = React.useContext(WorkspaceLabelsContext);
  return React.useCallback((instanceId: string): boolean => {
    const target = instances.find((i) => i.instanceId === instanceId);
    if (target?.dirty && !window.confirm(labels.confirmCloseDirty(instanceTitle(target)))) return false;
    store.close(instanceId);
    return true;
  }, [store, instances, labels]);
}
