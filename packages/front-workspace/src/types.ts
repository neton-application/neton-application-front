/**
 * 工作区运行时契约（NETON_APPLICATION_FRONT_SPEC §6）。
 *
 * 三个身份概念必须分开，混用是上一版页签实现所有 bug 的根源：
 *
 *   instanceId  实例生命周期身份。存活期间不变，作 React key。
 *   resourceKey 复用判据。再次打开同一资源时命中它就激活既有实例。
 *   location    当前完整地址（pathname + search + hash）。随页面内操作变化，
 *               但 **不改变** instanceId，也不一定改变 resourceKey。
 *
 * 举例：用户列表翻页 → location 变、resourceKey 不变 → 不新开页签；
 *       打开另一个用户 → resourceKey 变 → 新开或激活对应页签。
 */

export interface WorkspaceLocation {
  pathname: string;
  /** 规范化后的查询串（键已排序），空串表示无查询。 */
  search: string;
  hash: string;
  /** 路径参数，来自 manifest path 里的 `:name` 段。 */
  params: Record<string, string>;
  /** 查询参数。 */
  query: Record<string, string>;
  /** pathname + search + hash */
  href: string;
}

export interface WorkspaceInstance {
  instanceId: string;
  resourceKey: string;
  /** manifest 页面 key（== 后端 system_menus.component）。 */
  pageKey: string;
  location: WorkspaceLocation;
  /** 注册表默认标题，首帧与加载失败时使用。 */
  defaultTitle: string;
  /** 页面发布的标题，优先于 defaultTitle。 */
  publishedTitle?: string;
  pinned?: boolean;
  /** 有未保存内容。关闭需确认，且任何容量策略都不得回收。 */
  dirty?: boolean;
  createdAt: number;
  lastActiveAt: number;
}

export interface WorkspaceSnapshot {
  instances: WorkspaceInstance[];
  activeId: string | null;
}

/** 从 manifest 派生的页面定义。 */
export interface WorkspacePage {
  key: string;
  /** 路由模式，`:name` 匹配单个非空 segment。 */
  path: string;
  /** 决定 resourceKey 的参数名（路径参数或查询参数）。未列出的查询只是视图状态。 */
  identity: string[];
  /** 默认标题模板，可含 `:name` 占位。 */
  title: string;
  standalone: boolean;
  load: () => Promise<{ default: React.ComponentType }>;
}

export interface ResolvedRoute {
  page: WorkspacePage;
  location: WorkspaceLocation;
  resourceKey: string;
  defaultTitle: string;
}

/**
 * 宿主适配器：把「地址栏 + 浏览器历史」这件事隔离到一处。
 *
 * Next 宿主的实现依赖 App Router 对 history 的补丁行为（见 host-history.ts 注释），
 * 换宿主（Vite / hash 路由 / 桌面壳）只需另写一个实现。
 */
export interface WorkspaceHostAdapter {
  /** 读取当前地址（工作区地址：相对 href，不带宿主的路径前缀）。 */
  read(): string;
  /** 读取当前历史条目上绑定的 instanceId。 */
  readInstanceId(): string | null;
  /** 新增一条历史（打开/激活页签）。 */
  push(href: string, instanceId: string): void;
  /** 就地更新当前历史（页面内视图状态变化）。 */
  replace(href: string, instanceId: string): void;
  /** 订阅浏览器前进后退。 */
  subscribe(listener: (href: string, instanceId: string | null) => void): () => void;
  /**
   * 工作区地址 → 浏览器地址（`<a href>` 用）。宿主挂在路径前缀下时加前缀，否则原样返回。
   * 工作区内部的地址（manifest path、页签 location、持久化）一律不带前缀。
   */
  toExternal(href: string): string;
  /** 浏览器里的同源相对地址 → 工作区地址；不归工作区管（在前缀外）返回 null。 */
  toInternal(href: string): string | null;
}
