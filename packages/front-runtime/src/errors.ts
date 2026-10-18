"use client";

import * as React from "react";
import { ApiError } from "./client";
import { useT } from "./i18n";
import { describeError, describeFieldErrors } from "./describe-error";

export { describeError, describeFieldError, describeFieldErrors, translateCode, type DescribableError } from "./describe-error";

/**
 * 把错误变成给人看的话（评审 R12/R15；后端规则见 spec ERROR_CODE_SPEC「消息即机器码」）。
 *
 * 后端信封的 `message` 与字段错误的 `code` 都是机器码，翻译顺序统一为：模块自己的语言包
 * `error.<CODE>`（传入模块命名空间时）→ 通用 `errors.code.<CODE>`（框架内建码由本运行时的通用语言包翻译）
 * → 错误类别的通用说明（`errors.kind.*`）。没有任何翻译的机器码原样显示（便于反馈定位），永远不显示原始异常堆栈。
 *
 * 模块的错误码由模块自己翻译：每个模块在 `src/locales/<lang>.ts` 里写 `"error.<CODE>"`，
 * 页面里调用 `useDescribeError("<模块 id>")`。共享运行时不需要认识任何模块的错误码。
 */
export function useDescribeError(namespace?: string): (error: unknown) => string {
  const t = useT("errors");
  // 未传命名空间时也必须无条件调用 hook（hook 调用顺序不能随参数变化）。
  const moduleT = useT(namespace ?? "errors");
  // 引用保持稳定：调用方常把它放进 effect 依赖，词条陆续加载时不能因此重复请求。
  const latest = React.useRef({ t, moduleT, scoped: namespace !== undefined });
  latest.current = { t, moduleT, scoped: namespace !== undefined };
  return React.useCallback((error: unknown) => {
    const { t, moduleT, scoped } = latest.current;
    return error instanceof ApiError ? describeError(error, t, scoped ? moduleT : undefined) : t("kind.business");
  }, []);
}

/**
 * 把错误里的字段级错误变成「字段 → 给人看的话」，供表单逐项提示。按字段 `code` 翻译，顺序同
 * [useDescribeError]；约束值（`params`）代入模板。没有字段路径的条目不在这里返回，由顶部的整体错误说明承担。
 */
export function useDescribeFieldErrors(namespace?: string): (error: unknown) => Record<string, string> {
  const t = useT("errors");
  const moduleT = useT(namespace ?? "errors");
  const latest = React.useRef({ t, moduleT, scoped: namespace !== undefined });
  latest.current = { t, moduleT, scoped: namespace !== undefined };
  return React.useCallback((error: unknown) => {
    const { t, moduleT, scoped } = latest.current;
    return error instanceof ApiError ? describeFieldErrors(error, t, scoped ? moduleT : undefined) : {};
  }, []);
}
