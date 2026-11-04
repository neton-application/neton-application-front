import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdminLocalePreferences, PROFILE_UPDATE } from "../apps/shell/src/lib/locale-preference-store.ts";

test("admin focus revalidation waits for an in-flight save rather than invalidating its success", async () => {
  let locale = "en-US";
  let finish!: () => void;
  let started!: () => void;
  const updating = new Promise<void>((resolve) => { started = resolve; });
  const preferences = createAdminLocalePreferences(async (path) => {
    if (path === PROFILE_UPDATE) {
      started();
      await new Promise<void>((resolve) => { finish = resolve; });
      locale = "zh-CN";
      return { code: 0 };
    }
    return { code: 0, data: { id: 42, locale } };
  });
  await preferences.load();
  const save = preferences.save("zh-CN");
  await updating;
  const load = preferences.load();
  finish();
  await save;
  assert.equal(await load, "zh-CN");
});

test("admin preferences use their own profile domain and carry an interaction precondition", async () => {
  const writes: RequestInit[] = [];
  const preferences = createAdminLocalePreferences(async (path, init) => {
    if (path === PROFILE_UPDATE) { writes.push(init!); return { code: 0 }; }
    return { code: 0, data: { id: 42, locale: "en-US" } };
  });
  assert.equal(await preferences.load(), "en-US");
  await preferences.save("zh-CN");
  assert.equal(new Headers(writes[0].headers).get("X-Neton-Preference-Subject"), "42");
});

test("a stale admin interaction never updates the next session's profile", async () => {
  let id = 42;
  let writes = 0;
  const preferences = createAdminLocalePreferences(async (path) => {
    if (path === PROFILE_UPDATE) writes++;
    return { code: 0, data: { id, locale: "en-US" } };
  });
  await preferences.load();
  id = 43;
  await assert.rejects(preferences.save("zh-CN"), { name: "AbortError" });
  assert.equal(writes, 0);
});

test("admin save failures remain failures, anonymous selection does not write", async () => {
  const failed = createAdminLocalePreferences(async (path) => path === PROFILE_UPDATE
    ? { code: 3 } : { code: 0, data: { id: 42 } });
  await assert.rejects(failed.save("en-US"), /LOCALE_SAVE_FAILED/);
  let calls = 0;
  const anonymous = createAdminLocalePreferences(async () => { calls++; return { code: 401 }; });
  assert.equal(await anonymous.load(), undefined);
  await anonymous.save("en-US");
  assert.equal(calls, 2);
});

test("an older admin read is discarded after a new choice", async () => {
  let finish!: (value: { code: number; data: { id: number; locale: string } }) => void;
  let calls = 0;
  const preferences = createAdminLocalePreferences(async () => ++calls === 1
    ? new Promise((resolve) => { finish = resolve; }) : { code: 0, data: { id: 42 } });
  const old = preferences.load();
  const rejected = assert.rejects(old, { name: "AbortError" });
  await preferences.save("zh-CN");
  finish({ code: 0, data: { id: 42, locale: "en-US" } });
  await rejected;
});
