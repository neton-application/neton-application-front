"use client";

import * as React from "react";
import { ApiError } from "./client";
import { useT, type Translate } from "./i18n";

/**
 * 把错误变成给人看的话（评审 R12/R15）。
 *
 * 优先级：模块自己的机器码翻译（模块语言包里的 `error.<CODE>`，传入模块命名空间时）→
 * 通用机器码翻译（`errors.code.*`）→ 错误类别的通用说明（`errors.kind.*`）。
 * 后端返回的英文句子只在找不到任何翻译时才原样显示，并且永远不显示原始异常堆栈。
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
    if (error instanceof ApiError) {
      const code = error.machineCode;
      if (code && scoped && moduleT.has(`error.${code}`)) return moduleT(`error.${code}`);
      if (code && t.has(`code.${code}`)) return t(`code.${code}`);
      if (error.kind === "rate_limited" && error.details.retryAfterSeconds !== undefined) {
        return t("kind.rate_limited_after", { seconds: error.details.retryAfterSeconds });
      }
      if (error.kind === "business" || error.kind === "validation") {
        // 业务失败的具体原因只有后端知道；字段错误的 message 是机器码时同样按码翻译，否则退回后端给的说明。
        const translate = (c: string | undefined) => translateCode(c, scoped ? moduleT : undefined, t);
        return error.details.fieldErrors?.map((f) => translate(f.code) ?? translate(machineCodeOf(f.message)) ?? f.message).join("；")
          || error.message || t(`kind.${error.kind}`);
      }
      return t(`kind.${error.kind}`);
    }
    return t("kind.business");
  }, []);
}

const MACHINE_CODE = /^[A-Z][A-Z0-9_]{2,}$/;

function machineCodeOf(message: string | undefined): string | undefined {
  return message && MACHINE_CODE.test(message) ? message : undefined;
}


/** 模块语言包 `error.<CODE>` → 通用 `errors.code.<CODE>`；都没有返回 undefined。 */
function translateCode(code: string | undefined, moduleT: Translate | undefined, t: Translate): string | undefined {
  if (!code) return undefined;
  if (moduleT?.has(`error.${code}`)) return moduleT(`error.${code}`);
  if (t.has(`code.${code}`)) return t(`code.${code}`);
  return undefined;
}

/**
 * 把错误里的字段级错误变成「字段 → 给人看的话」，供表单逐项提示。
 *
 * 翻译顺序与 [useDescribeError] 相同：模块语言包 `error.<CODE>` → 通用 `errors.code.<CODE>` →
 * 后端给的说明。没有字段路径的条目不在这里返回，由顶部的整体错误说明承担。
 */
export function useDescribeFieldErrors(namespace?: string): (error: unknown) => Record<string, string> {
  const t = useT("errors");
  const moduleT = useT(namespace ?? "errors");
  const latest = React.useRef({ t, moduleT, scoped: namespace !== undefined });
  latest.current = { t, moduleT, scoped: namespace !== undefined };
  return React.useCallback((error: unknown) => {
    const { t, moduleT, scoped } = latest.current;
    if (!(error instanceof ApiError)) return {};
    const result: Record<string, string> = {};
    for (const item of error.details.fieldErrors ?? []) {
      if (!item.field || result[item.field] !== undefined) continue;
      // 先认 code；声明式校验（@Pattern 等）的 code 是约束名，机器码在 message 里。
      const translate = (c: string | undefined) => translateCode(c, scoped ? moduleT : undefined, t);
      result[item.field] = translate(item.code) ?? translate(machineCodeOf(item.message)) ?? item.message;
    }
    return result;
  }, []);
}
