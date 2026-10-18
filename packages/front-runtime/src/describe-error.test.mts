// 字段错误 / 信封机器码 → 人话（spec ERROR_CODE_SPEC「消息即机器码」）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeError, describeFieldError, describeFieldErrors, type DescribableError } from "./describe-error.ts";
import { runtimeCatalogs } from "./messages.ts";
import type { Translate } from "./i18n";

function translator(messages: Record<string, string>): Translate {
  const t = ((key: string, params?: Record<string, unknown>) => {
    const template = messages[key];
    if (template === undefined) return key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
  }) as Translate;
  t.has = (key: string) => key in messages;
  return t;
}

const t = translator(runtimeCatalogs.errors["zh-CN"]);
const moduleT = translator({ "error.INVALID_MOBILE": "手机号格式不正确。", "error.WALLET_FROZEN": "钱包已冻结。" });

function apiError(message: string, fieldErrors?: DescribableError["details"]["fieldErrors"], kind: DescribableError["kind"] = "validation"): DescribableError {
  return { kind, message, machineCode: /^[A-Z][A-Z0-9_]{2,}$/.test(message) ? message : undefined, details: { fieldErrors } };
}

test("built-in field codes translate with their params", () => {
  assert.equal(describeFieldError({ field: "title", code: "TOO_SHORT", message: "TOO_SHORT", params: { min: 2, max: 32 } }, t), "至少 2 个字符。");
  assert.equal(describeFieldError({ field: "title", code: "TOO_LONG", message: "TOO_LONG", params: { min: 2, max: 32 } }, t), "最多 32 个字符。");
  assert.equal(describeFieldError({ field: "name", code: "REQUIRED", message: "REQUIRED" }, t), "必填项。");
});

test("module code wins over the common catalogue; untranslated codes show as-is", () => {
  assert.equal(describeFieldError({ field: "mobile", code: "INVALID_MOBILE", message: "INVALID_MOBILE" }, t, moduleT), "手机号格式不正确。");
  assert.equal(describeFieldError({ field: "x", code: "SOMETHING_NEW", message: "SOMETHING_NEW" }, t, moduleT), "SOMETHING_NEW");
});

test("field map keeps the first error per field", () => {
  const error = apiError("VALIDATION_FAILED", [
    { field: "title", code: "TOO_SHORT", message: "TOO_SHORT", params: { min: 2 } },
    { field: "title", code: "INVALID_FORMAT", message: "INVALID_FORMAT" },
    { code: "INVALID_JSON", message: "INVALID_JSON" },
  ]);
  assert.deepEqual(describeFieldErrors(error, t), { title: "至少 2 个字符。" });
});

test("VALIDATION_FAILED with field errors describes the fields", () => {
  const error = apiError("VALIDATION_FAILED", [
    { field: "name", code: "REQUIRED", message: "REQUIRED" },
    { field: "mobile", code: "INVALID_MOBILE", message: "INVALID_MOBILE" },
  ]);
  assert.equal(describeError(error, t, moduleT), "必填项。；手机号格式不正确。");
  assert.equal(describeError(apiError("VALIDATION_FAILED", []), t), "提交的内容有误，请检查后重试。");
});

test("top-level codes: module first, then the common catalogue, then the raw code", () => {
  assert.equal(describeError(apiError("WALLET_FROZEN", undefined, "business"), t, moduleT), "钱包已冻结。");
  assert.equal(describeError(apiError("ROUTE_NOT_FOUND", undefined, "business"), t), "请求的接口不存在。");
  assert.equal(describeError(apiError("NEW_BUSINESS_CODE", undefined, "business"), t), "NEW_BUSINESS_CODE");
});

test("rate limit without a translation for its code uses Retry-After", () => {
  const error: DescribableError = { kind: "rate_limited", message: "RATE_LIMITED", machineCode: "RATE_LIMITED", details: { retryAfterSeconds: 30 } };
  assert.equal(describeError(error, t), "操作太频繁，请 30 秒后再试。");
});
