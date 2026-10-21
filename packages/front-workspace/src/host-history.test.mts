import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserHistoryHost } from "./host-history.ts";

/** 最小的浏览器替身：只实现宿主适配器用到的 location / history / popstate。 */
function fakeWindow(initial: string) {
  const listeners = new Set<() => void>();
  const entries: { href: string; state: unknown }[] = [{ href: initial, state: { next: "router" } }];
  let index = 0;
  const location = {
    get pathname() { return new URL(entries[index]!.href, "http://x").pathname; },
    get search() { return new URL(entries[index]!.href, "http://x").search; },
    get hash() { return new URL(entries[index]!.href, "http://x").hash; },
  };
  const history = {
    get state() { return entries[index]!.state; },
    pushState(state: unknown, _: string, href: string) { entries.splice(index + 1); entries.push({ href, state }); index += 1; },
    replaceState(state: unknown, _: string, href: string) { entries[index] = { href, state }; },
  };
  const win = {
    location,
    history,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  (globalThis as { window?: unknown }).window = win;
  return {
    entries,
    back() { index -= 1; listeners.forEach((l) => l()); },
    go(href: string) { entries.splice(index + 1); entries.push({ href, state: null }); index += 1; listeners.forEach((l) => l()); },
    listenerCount: () => listeners.size,
  };
}

test("without a prefix the host reads and writes the address as is", () => {
  const w = fakeWindow("/account/profile?a=1#x");
  const host = createBrowserHistoryHost();
  assert.equal(host.read(), "/account/profile?a=1#x");
  host.push("/account/password", "ws1");
  assert.equal(w.entries.at(-1)!.href, "/account/password");
  assert.equal(host.toExternal("/x"), "/x");
  assert.equal(host.toInternal("/x"), "/x");
});

test("with a prefix the address bar carries it and the workspace never sees it", () => {
  const w = fakeWindow("/my/account/profile?a=1");
  const host = createBrowserHistoryHost({ basePath: "/my/" });
  assert.equal(host.read(), "/account/profile?a=1");
  host.push("/", "ws1");
  assert.equal(w.entries.at(-1)!.href, "/my");
  host.replace("/account/email#top", "ws2");
  assert.equal(w.entries.at(-1)!.href, "/my/account/email#top");
  assert.equal(host.readInstanceId(), "ws2");
  assert.equal(host.toExternal("/account/profile"), "/my/account/profile");
  assert.equal(host.toInternal("/my/account/profile"), "/account/profile");
  assert.equal(host.toInternal("/article/1"), null);
});

test("pushState keeps the host router's own state fields", () => {
  const w = fakeWindow("/my");
  const host = createBrowserHistoryHost({ basePath: "/my" });
  host.replace("/", "ws1");
  assert.deepEqual(w.entries[0]!.state, { next: "router", __neton_workspace: { instanceId: "ws1" } });
});

test("popstate inside the prefix reaches the workspace; outside it is left to the host router", () => {
  const w = fakeWindow("/my/a");
  const host = createBrowserHistoryHost({ basePath: "/my" });
  const seen: (string | null)[] = [];
  const stop = host.subscribe((href) => seen.push(href));
  w.go("/my/b?x=1");
  w.go("/article/9");
  w.back();
  assert.deepEqual(seen, ["/b?x=1", "/b?x=1"]);
  stop();
  assert.equal(w.listenerCount(), 0);
});

test("starting outside the prefix falls back to the workspace home", () => {
  fakeWindow("/login");
  assert.equal(createBrowserHistoryHost({ basePath: "/my" }).read(), "/");
});
