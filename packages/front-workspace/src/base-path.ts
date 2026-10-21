/**
 * 工作区挂在站点的某个路径前缀下（如 C 端门户把控制台放在 `/my`）。
 *
 * 工作区内部一律使用**不带前缀**的地址（manifest 的 `path`、页签的 `location.href`、持久化记录），
 * 只有和浏览器打交道的那一层（地址栏、`<a href>`）才加前缀。这样同一套模块 manifest 装在
 * 根路径或任意前缀下都不用改，换前缀也不会让已持久化的页签失效。
 *
 * 前缀为空串表示挂在根路径（admin 线与只有控制台的 C 端产品），此时所有转换都是恒等的。
 */

const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * 规范化前缀：`""`、`"/"` → `""`；`"/my/"` → `"/my"`。
 *
 * 只接受由普通路径段组成的绝对前缀：带查询串、锚点、`..`、空段或需要转义的字符一律拒绝 ——
 * 前缀是构建期常量，写错应该在启动时就炸，而不是生成出一批错误的链接。
 */
export function normalizeBasePath(input: string | undefined | null): string {
  const raw = (input ?? "").trim();
  if (raw === "" || raw === "/") return "";
  if (!raw.startsWith("/")) throw new Error(`[workspace] basePath must start with "/": ${JSON.stringify(raw)}`);
  const segments = raw.replace(/\/+$/, "").split("/").slice(1);
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment === "." || segment === "..") {
      throw new Error(`[workspace] invalid basePath segment ${JSON.stringify(segment)} in ${JSON.stringify(raw)}`);
    }
  }
  return `/${segments.join("/")}`;
}

/**
 * 工作区地址 → 浏览器地址。`"/"` 在前缀下是前缀本身（`/my`），不是 `/my/`：
 * 与 Next 的路由一致，带尾斜杠的地址会被它 308 回不带的。
 */
export function withBasePath(basePath: string, href: string): string {
  if (!basePath) return href;
  if (!href.startsWith("/")) throw new Error(`[workspace] workspace href must be absolute: ${JSON.stringify(href)}`);
  const cut = href.search(/[?#]/);
  const pathname = cut < 0 ? href : href.slice(0, cut);
  const rest = cut < 0 ? "" : href.slice(cut);
  return `${pathname === "/" ? basePath : `${basePath}${pathname}`}${rest}`;
}

/**
 * 浏览器地址 → 工作区地址；不在前缀下返回 null（例如门户页面、登录页）。
 * `"/mything"` 不在 `"/my"` 下：前缀按整段匹配。
 */
export function stripBasePath(basePath: string, href: string): string | null {
  if (!href.startsWith("/")) return null;
  if (!basePath) return href;
  const cut = href.search(/[?#]/);
  const pathname = cut < 0 ? href : href.slice(0, cut);
  const rest = cut < 0 ? "" : href.slice(cut);
  if (pathname === basePath || pathname === `${basePath}/`) return `/${rest}`;
  if (pathname.startsWith(`${basePath}/`)) return `${pathname.slice(basePath.length)}${rest}`;
  return null;
}
