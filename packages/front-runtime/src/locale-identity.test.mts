import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInitialLocale } from "./locale-resolution.ts";

const config = { locales: ["zh-CN", "en-US"], defaultLocale: "zh-CN" };
test("unconfigured identity must not inherit previous account's local cache", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem: () => "en-US" }, navigator: { languages: ["en-US"] },
  } });
  try {
    assert.equal(resolveInitialLocale(config, "zh-CN", null), "zh-CN");
    assert.equal(resolveInitialLocale(config, "zh-CN", "en-US"), "en-US");
    assert.equal(resolveInitialLocale(config, "zh-CN", "zh-CN"), "zh-CN");
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
