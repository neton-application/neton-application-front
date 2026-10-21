import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeBasePath, stripBasePath, withBasePath } from "./base-path.ts";

test("normalizeBasePath treats empty and root as no prefix", () => {
  assert.equal(normalizeBasePath(undefined), "");
  assert.equal(normalizeBasePath(""), "");
  assert.equal(normalizeBasePath("/"), "");
  assert.equal(normalizeBasePath(" /my/ "), "/my");
  assert.equal(normalizeBasePath("/a/b"), "/a/b");
});

test("normalizeBasePath rejects anything that is not plain absolute segments", () => {
  for (const bad of ["my", "/my?x=1", "/my#a", "/a//b", "/../x", "/a/./b", "/空间", "/a b"]) {
    assert.throws(() => normalizeBasePath(bad), /basePath/, bad);
  }
});

test("withBasePath is the identity without a prefix", () => {
  assert.equal(withBasePath("", "/"), "/");
  assert.equal(withBasePath("", "/account/profile?tab=1#x"), "/account/profile?tab=1#x");
});

test("withBasePath prefixes paths and maps the workspace root to the prefix itself", () => {
  assert.equal(withBasePath("/my", "/"), "/my");
  assert.equal(withBasePath("/my", "/?tab=a"), "/my?tab=a");
  assert.equal(withBasePath("/my", "/#top"), "/my#top");
  assert.equal(withBasePath("/my", "/account/profile"), "/my/account/profile");
  assert.equal(withBasePath("/my", "/u/1?x=1#h"), "/my/u/1?x=1#h");
  assert.throws(() => withBasePath("/my", "account"), /absolute/);
});

test("stripBasePath inverts withBasePath and matches whole segments only", () => {
  assert.equal(stripBasePath("/my", "/my"), "/");
  assert.equal(stripBasePath("/my", "/my/"), "/");
  assert.equal(stripBasePath("/my", "/my?x=1"), "/?x=1");
  assert.equal(stripBasePath("/my", "/my/account/profile#a"), "/account/profile#a");
  assert.equal(stripBasePath("/my", "/mything"), null);
  assert.equal(stripBasePath("/my", "/article/1"), null);
  assert.equal(stripBasePath("/my", "https://x/my"), null);
  assert.equal(stripBasePath("", "/article/1"), "/article/1");
  for (const href of ["/", "/a", "/a/b?c=d#e", "/?q=1"]) {
    assert.equal(stripBasePath("/my/console", withBasePath("/my/console", href)), href);
  }
});
