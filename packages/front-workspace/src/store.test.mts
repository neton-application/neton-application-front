import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkspaceStore } from "./store.ts";
import type { WorkspaceHostAdapter, WorkspacePage } from "./types.ts";
import { stripBasePath, withBasePath } from "./base-path.ts";

const load = async () => ({ default: () => null });
const pages: WorkspacePage[] = [
  { key: "__home", path: "/", identity: [], title: "Home", standalone: true, load },
  { key: "account/profile/index", path: "/account/profile", identity: [], title: "Profile", standalone: false, load },
  { key: "user/detail", path: "/user/:id", identity: ["id"], title: "User :id", standalone: true, load },
];

function memoryHost(basePath: string, initial: string) {
  const bar: string[] = [initial];
  const host: WorkspaceHostAdapter = {
    read: () => stripBasePath(basePath, bar.at(-1)!) ?? "/",
    readInstanceId: () => null,
    push: (href) => { bar.push(withBasePath(basePath, href)); },
    replace: (href) => { bar[bar.length - 1] = withBasePath(basePath, href); },
    subscribe: () => () => {},
    toExternal: (href) => withBasePath(basePath, href),
    toInternal: (href) => stripBasePath(basePath, href),
  };
  return { host, bar };
}

test("a store under a prefix keeps prefix-free locations and writes prefixed addresses", () => {
  const { host, bar } = memoryHost("/my", "/my/user/7?tab=b");
  const store = new WorkspaceStore({ pages, host, homeHref: "/", pinHome: true });
  store.start();
  const [active] = store.getSnapshot().instances;
  assert.equal(active!.location.href, "/user/7?tab=b");
  assert.equal(active!.pageKey, "user/detail");
  store.open("/account/profile");
  assert.equal(bar.at(-1), "/my/account/profile");
  assert.equal(store.hrefOf("/user/8"), "/my/user/8");
  assert.equal(store.internalHrefOf("/my/user/8"), "/user/8");
  assert.equal(store.internalHrefOf("/channel/latest"), null);
  store.open("/");
  assert.equal(bar.at(-1), "/my");
  assert.ok(store.getSnapshot().instances.some((i) => i.pinned === false && i.pageKey === "user/detail"));
  store.stop();
});

test("a store without a prefix behaves exactly as before", () => {
  const { host, bar } = memoryHost("", "/account/profile");
  const store = new WorkspaceStore({ pages, host, homeHref: "/", pinHome: true });
  store.start();
  assert.equal(bar[0], "/account/profile");
  store.open("/user/1");
  assert.equal(bar.at(-1), "/user/1");
  assert.equal(store.hrefOf("/user/1"), "/user/1");
  store.stop();
});

test("starting twice does not duplicate restored tabs (React strict mode runs effects twice)", () => {
  const data = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: Storage };
  const saved = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); }, clear: () => data.clear(), key: () => null, length: 0,
  } as Storage;
  try {
    const first = new WorkspaceStore({ pages, host: memoryHost("", "/account/profile").host, homeHref: "/", pinHome: true, persist: { scope: "t" } });
    first.start();
    first.open("/user/1");
    first.stop();
    // 刷新后的新页面：同一个 store 被 start 两次
    const store = new WorkspaceStore({ pages, host: memoryHost("", "/user/1").host, homeHref: "/", pinHome: true, persist: { scope: "t" } });
    store.start();
    store.start();
    const keys = store.getSnapshot().instances.map((i) => i.resourceKey);
    assert.equal(keys.length, new Set(keys).size, `duplicate tabs: ${keys.join(", ")}`);
    store.stop();
  } finally {
    g.localStorage = saved;
  }
});
