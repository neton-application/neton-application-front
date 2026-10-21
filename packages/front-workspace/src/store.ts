import { resolveRoute } from "./route";
import type { WorkspaceHostAdapter, WorkspaceInstance, WorkspacePage, WorkspaceSnapshot } from "./types";

const PERSIST_KEY = "neton-workspace";
/** 结构变更时 +1：旧结构整份丢弃，不做迁移，避免复活出坏页签。 */
const PERSIST_VERSION = 3;

/**
 * 只存页签的地址与固定状态（评审 R19）。页面发布的标题**不存**：它常带着人名、单号等业务数据，
 * 不该留在本机；恢复后先显示默认标题，页面加载完会重新发布。
 */
interface PersistedInstance {
  instanceId: string;
  href: string;
  pinned?: boolean;
}

let seq = 0;
function nextInstanceId(): string {
  seq += 1;
  return `ws${Date.now().toString(36)}${seq.toString(36)}`;
}

export interface WorkspaceStoreOptions {
  pages: WorkspacePage[];
  host: WorkspaceHostAdapter;
  /** 兜底首页：解析不出任何页面时落到这里。 */
  homeHref: string;
  /** 首页页签不可关闭。 */
  pinHome?: boolean;
  /**
   * 记住打开的页签。[scope] 区分发行版身份域与用户（如 `admin:42`）：同一台电脑换人登录，
   * 不能恢复出上一个人的页签。省略即不持久化。
   */
  persist?: { scope: string };
}

/**
 * 工作区状态机。
 *
 * 生命周期硬约束：**已打开的实例不会因为切换、翻页或地址变化被销毁**。
 * 只有 close() 和显式重置才结束实例。这里没有 LRU、没有自动回收 ——
 * 那与「切换不重新加载」直接冲突。
 */
export class WorkspaceStore {
  private instances: WorkspaceInstance[] = [];
  private activeId: string | null = null;
  private listeners = new Set<() => void>();
  private snapshot: WorkspaceSnapshot = { instances: [], activeId: null };
  private readonly options: WorkspaceStoreOptions;
  private disposeHost?: () => void;

  constructor(options: WorkspaceStoreOptions) {
    this.options = options;
  }

  // ── React 订阅 ──
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): WorkspaceSnapshot => this.snapshot;

  /** 工作区地址 → 浏览器地址（`<a href>` 必须用它，宿主可能挂在路径前缀下）。 */
  hrefOf(href: string): string {
    return this.options.host.toExternal(href);
  }

  /** 浏览器里的同源相对地址 → 工作区地址；在宿主前缀外返回 null。 */
  internalHrefOf(href: string): string | null {
    return this.options.host.toInternal(href);
  }

  /**
   * 换一份页面表（例如切换语言后页面的默认标题变了）。已打开的实例**原样保留**，
   * 只按新页面表重算各自的默认标题；页面发布的标题不受影响。
   */
  updatePages(pages: WorkspacePage[]): void {
    this.options.pages = pages;
    for (const instance of this.instances) {
      const resolved = resolveRoute(pages, instance.location.href);
      if (resolved) instance.defaultTitle = resolved.defaultTitle;
    }
    this.emit();
  }

  private emit() {
    this.snapshot = { instances: [...this.instances], activeId: this.activeId };
    this.listeners.forEach((l) => l());
  }

  /** 启动：恢复持久化页签 → 打开地址栏对应页签 → 订阅前进后退。 */
  start(): void {
    const current = this.options.host.read();
    const boundId = this.options.host.readInstanceId();

    if (this.options.persist) this.restore();

    const existing = boundId ? this.instances.find((i) => i.instanceId === boundId) : undefined;
    if (existing) {
      this.activeId = existing.instanceId;
      this.touch(existing.instanceId);
    } else {
      this.open(current, { history: "replace" });
    }
    if (!this.instances.length) this.open(this.options.homeHref, { history: "replace" });
    if (!this.activeId && this.instances[0]) this.activeId = this.instances[0].instanceId;

    this.disposeHost = this.options.host.subscribe((href, instanceId) => this.onPop(href, instanceId));
    this.emit();
  }

  stop(): void {
    this.disposeHost?.();
    this.disposeHost = undefined;
  }

  /**
   * 打开地址。
   *
   * - 命中既有 resourceKey → **激活既有实例**并更新其 location（不重建）
   * - 未命中 → 建新实例
   * - `forceNew` → 同一资源另开一个实例（`instanceId` 不同，`resourceKey` 相同）
   */
  open(href: string, opts: { history?: "push" | "replace" | "none"; forceNew?: boolean } = {}): WorkspaceInstance | null {
    const resolved = resolveRoute(this.options.pages, href);
    if (!resolved) return null;

    const mode = opts.history ?? "push";
    const hit = opts.forceNew ? undefined : this.instances.find((i) => i.resourceKey === resolved.resourceKey);

    if (hit) {
      hit.location = resolved.location;
      hit.defaultTitle = resolved.defaultTitle;
      this.activeId = hit.instanceId;
      this.touch(hit.instanceId);
      this.writeHistory(mode, hit);
      this.emit();
      this.persist();
      return hit;
    }

    const instance: WorkspaceInstance = {
      instanceId: nextInstanceId(),
      resourceKey: resolved.resourceKey,
      pageKey: resolved.page.key,
      location: resolved.location,
      defaultTitle: resolved.defaultTitle,
      pinned: this.options.pinHome ? resolved.location.href === this.options.homeHref : false,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    // 首页固定在最前，其余按打开顺序追加
    if (instance.pinned) this.instances.unshift(instance);
    else this.instances.push(instance);
    this.activeId = instance.instanceId;
    this.writeHistory(mode, instance);
    this.emit();
    this.persist();
    return instance;
  }

  /** 激活既有页签：地址栏同步为该页签的完整 URL，实例不重建。 */
  activate(instanceId: string): void {
    const instance = this.instances.find((i) => i.instanceId === instanceId);
    if (!instance || this.activeId === instanceId) return;
    this.activeId = instanceId;
    this.touch(instanceId);
    this.writeHistory("push", instance);
    this.emit();
    this.persist();
  }

  /**
   * 页面内视图状态变化（翻页、筛选、切 section）。
   *
   * 用 replace 而不是 push —— 否则翻十页就往历史里塞十条，后退变成逐页倒退。
   * resourceKey 不重算：视图状态按定义不参与身份。
   */
  updateLocation(instanceId: string, href: string): void {
    const instance = this.instances.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    const resolved = resolveRoute(this.options.pages, href);
    if (!resolved) return;
    if (resolved.location.href === instance.location.href) return;
    instance.location = resolved.location;
    if (this.activeId === instanceId) this.writeHistory("replace", instance);
    this.emit();
    this.persist();
  }

  /** 页面发布标题。state 驱动，不在 effect 里反复写，避免切换时标题抖动。 */
  setTitle(instanceId: string, title: string): void {
    const instance = this.instances.find((i) => i.instanceId === instanceId);
    if (!instance || instance.publishedTitle === title) return;
    instance.publishedTitle = title;
    this.emit();
    this.persist();
  }

  setDirty(instanceId: string, dirty: boolean): void {
    const instance = this.instances.find((i) => i.instanceId === instanceId);
    if (!instance || Boolean(instance.dirty) === dirty) return;
    instance.dirty = dirty;
    this.emit();
  }

  /** 关闭页签：销毁实例，激活相邻页签并把地址栏同步过去。 */
  close(instanceId: string): void {
    const index = this.instances.findIndex((i) => i.instanceId === instanceId);
    if (index < 0) return;
    const target = this.instances[index]!;
    if (target.pinned) return;
    this.instances.splice(index, 1);
    if (this.activeId === instanceId) {
      const next = this.instances[index] ?? this.instances[index - 1] ?? this.instances[0];
      this.activeId = next?.instanceId ?? null;
      if (next) {
        this.touch(next.instanceId);
        this.writeHistory("push", next);
      }
    }
    this.emit();
    this.persist();
  }

  closeOthers(instanceId: string): void {
    this.instances = this.instances.filter((i) => i.instanceId === instanceId || i.pinned);
    this.activeId = instanceId;
    const active = this.instances.find((i) => i.instanceId === instanceId);
    if (active) this.writeHistory("push", active);
    this.emit();
    this.persist();
  }

  /**
   * 浏览器前进后退。
   *
   * 条目上绑的 instanceId 还活着 → 直接激活，不重建、不再写历史。
   * 实例已被关闭 → 按该条目的地址新建一个实例（instanceId 是新的）。
   * 用户主动关闭已经结束了旧实例的生命周期，这与「切换不重建」不冲突；
   * 静默跳过该条目在 History API 下做不干净（要二次 go，会闪）。
   */
  private onPop(href: string, instanceId: string | null): void {
    const alive = instanceId ? this.instances.find((i) => i.instanceId === instanceId) : undefined;
    if (alive) {
      this.activeId = alive.instanceId;
      this.touch(alive.instanceId);
      this.emit();
      return;
    }
    this.open(href, { history: "none" });
  }

  private touch(instanceId: string) {
    const instance = this.instances.find((i) => i.instanceId === instanceId);
    if (instance) instance.lastActiveAt = Date.now();
  }

  private writeHistory(mode: "push" | "replace" | "none", instance: WorkspaceInstance) {
    if (mode === "none") return;
    const href = instance.location.href;
    if (mode === "push") this.options.host.push(href, instance.instanceId);
    else this.options.host.replace(href, instance.instanceId);
  }

  // ── 持久化：只存可序列化的页签描述，不承诺恢复内存状态 ──
  private persistKey(): string {
    return `${PERSIST_KEY}:${this.options.persist?.scope ?? ""}`;
  }

  /** 退出登录时调用：清掉本机所有用户的页签记录（含旧版本留下的全站共用记录）。 */
  static clearPersisted(): void {
    if (typeof localStorage === "undefined") return;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key === PERSIST_KEY || key?.startsWith(`${PERSIST_KEY}:`)) localStorage.removeItem(key);
    }
  }

  private persist() {
    if (!this.options.persist || typeof localStorage === "undefined") return;
    const payload: PersistedInstance[] = this.instances.map((i) => ({
      instanceId: i.instanceId,
      href: i.location.href,
      pinned: i.pinned,
    }));
    try {
      localStorage.setItem(this.persistKey(), JSON.stringify({ version: PERSIST_VERSION, instances: payload }));
    } catch { /* 配额或隐私模式，放弃持久化不影响运行 */ }
  }

  private restore() {
    if (typeof localStorage === "undefined") return;
    let parsed: { version?: number; instances?: PersistedInstance[] } | null = null;
    try {
      parsed = JSON.parse(localStorage.getItem(this.persistKey()) ?? "null");
    } catch { parsed = null; }
    if (!parsed || parsed.version !== PERSIST_VERSION || !Array.isArray(parsed.instances)) {
      try { localStorage.removeItem(this.persistKey()); } catch { /* ignore */ }
      return;
    }
    for (const item of parsed.instances) {
      const resolved = resolveRoute(this.options.pages, item.href);
      if (!resolved) continue;
      // 同一资源可以有多个页签：按持久化里的 instanceId 逐个恢复，不做归一。
      this.instances.push({
        instanceId: item.instanceId || nextInstanceId(),
        resourceKey: resolved.resourceKey,
        pageKey: resolved.page.key,
        location: resolved.location,
        defaultTitle: resolved.defaultTitle,
        pinned: item.pinned,
        createdAt: Date.now(),
        lastActiveAt: 0,
      });
    }
  }
}
