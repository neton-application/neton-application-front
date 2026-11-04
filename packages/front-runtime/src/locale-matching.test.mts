import { test } from "node:test";
import assert from "node:assert/strict";
import { matchLocale, resolveInitialLocale } from "./locale-resolution.ts";

test("malformed optional candidates do not crash valid language matching", () => {
  assert.equal(matchLocale("en-GB", ["not_a_valid_locale", "en-US"]), "en-US");
  assert.equal(matchLocale("en;q=0.8", ["en-US"]), undefined);
});

// Shared golden vectors with the server-side UserLanguageTest (contract/core).
// Explicit script (Hans/Hant) must beat region inference, and swapping the
// candidate order must never change the selected locale. See spec §6.
const withWindow = (langs: string[], fn: () => void) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem: () => null }, navigator: { languages: langs },
  } });
  try { fn(); } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
};

for (const locales of [["zh-CN", "zh-TW", "en-US"], ["en-US", "zh-TW", "zh-CN"]]) {
  const config = { locales, defaultLocale: "zh-CN" };
  test(`script beats region and order is irrelevant (${locales.join("|")})`, () => {
    assert.equal(resolveInitialLocale(config, "zh-CN", "en-GB"), "en-US");
    assert.equal(resolveInitialLocale(config, "zh-CN", "zh-Hant-CN"), "zh-TW");
    assert.equal(resolveInitialLocale(config, "zh-CN", "zh-Hans-HK"), "zh-CN");
    withWindow(["en-GB"], () => assert.equal(resolveInitialLocale(config, "zh-CN"), "en-US"));
    withWindow(["zh-Hans-HK"], () => assert.equal(resolveInitialLocale(config), "zh-CN"));
    withWindow(["zh-Hant-CN"], () => assert.equal(resolveInitialLocale(config), "zh-TW"));
    withWindow(["zh-HK"], () => assert.equal(resolveInitialLocale(config), "zh-TW"));
    withWindow(["en-GB"], () => assert.equal(resolveInitialLocale(config), "en-US"));
  });
}
