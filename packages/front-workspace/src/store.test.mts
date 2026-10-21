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
