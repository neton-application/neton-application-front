import type { ApiError, ApiFieldError } from "./client";
import type { Translate } from "./i18n";

/*
 * 错误 → 人话的纯函数部分（只有类型依赖，不依赖 React，便于 node --test 单测）。hook 包装见 errors.ts。
 */

/** [ApiError] 里描述需要的部分。 */
export type DescribableError = Pick<ApiError, "kind" | "message" | "machineCode" | "details">;

/** 只是「校验没过」的总括码：有字段错误时优先说字段，而不是这句总括。 */
const UMBRELLA_CODES = new Set(["VALIDATION_FAILED", "INVALID_PARAMS"]);

/** 模块语言包 `error.<CODE>` → 通用 `errors.code.<CODE>`；都没有返回 undefined。 */
export function translateCode(
  code: string | undefined,
  t: Translate,
  moduleT?: Translate,
  params?: Record<string, unknown>,
): string | undefined {
  if (!code) return undefined;
  if (moduleT?.has(`error.${code}`)) return moduleT(`error.${code}`, params);
  if (t.has(`code.${code}`)) return t(`code.${code}`, params);
  return undefined;
}

/** 一条字段错误的说明：按 `code` 翻译（带 `params`）；没有翻译时显示机器码本身。 */
export function describeFieldError(item: ApiFieldError, t: Translate, moduleT?: Translate): string {
  const code = item.code ?? item.message;
  return translateCode(code, t, moduleT, item.params) ?? code;
}

export function describeFieldErrors(error: DescribableError, t: Translate, moduleT?: Translate): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of error.details.fieldErrors ?? []) {
    if (!item.field || result[item.field] !== undefined) continue;
    result[item.field] = describeFieldError(item, t, moduleT);
  }
  return result;
}

export function describeError(error: DescribableError, t: Translate, moduleT?: Translate): string {
  const code = error.machineCode;
  if (code && moduleT?.has(`error.${code}`)) return moduleT(`error.${code}`);
  const fields = error.details.fieldErrors ?? [];
  if (fields.length > 0 && (code === undefined || UMBRELLA_CODES.has(code))) {
    return fields.map((f) => describeFieldError(f, t, moduleT)).join("；");
  }
  if (error.kind === "rate_limited" && error.details.retryAfterSeconds !== undefined && !translateCode(code, t, moduleT)) {
    return t("kind.rate_limited_after", { seconds: error.details.retryAfterSeconds });
  }
  const translated = translateCode(code, t);
  if (translated) return translated;
  if (error.kind === "business" || error.kind === "validation") {
    // 业务失败的具体原因只有后端知道：字段错误逐条说明，否则显示后端的机器码，再不行退回类别说明。
    if (fields.length > 0) return fields.map((f) => describeFieldError(f, t, moduleT)).join("；");
    return error.message || t(`kind.${error.kind}`);
  }
  return t(`kind.${error.kind}`);
}
