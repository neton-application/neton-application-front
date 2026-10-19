// 写请求的 HTTP 状态：202 Accepted（只排进后台）与 200（请求里做完）都是成功信封；错误照常抛 ApiError。
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, apiWrite, apiWriteResult } from "./client.ts";

function respond(status: number, body: unknown, contentType = "application/json; charset=utf-8") {
  const calls: { url: string; method?: string; headers: Headers }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method, headers: new Headers(init.headers) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": contentType } });
  }) as typeof fetch;
  return calls;
}

test("202 Accepted is a success that reports accepted", async () => {
  const calls = respond(202, { code: 0, message: "OK", data: { state: "pending" } });
  const r = await apiWriteResult<{ state: string }>("/admin/newsroom/story/publish/1", "POST");
  assert.deepEqual(r, { data: { state: "pending" }, status: 202, accepted: true });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.get("X-Neton-Csrf"), "1");
});

test("200 is a success that was done in the request", async () => {
  respond(200, { code: 0, message: "OK", data: { state: "done" } });
  const r = await apiWriteResult<{ state: string }>("/admin/newsroom/story/publish/1", "POST");
  assert.equal(r.accepted, false);
  assert.equal(r.status, 200);
  assert.equal(r.data.state, "done");
});

test("apiWrite keeps returning just the data for 202", async () => {
  respond(202, { code: 0, message: "OK", data: 7 });
  assert.equal(await apiWrite<number>("/x", "POST"), 7);
});

test("errors still throw ApiError with the machine code", async () => {
  respond(409, { code: 10400, message: "NEWSROOM_STORY_EMPTY", data: null });
  await assert.rejects(apiWriteResult("/x", "POST"), (e: unknown) => e instanceof ApiError && e.machineCode === "NEWSROOM_STORY_EMPTY" && e.details.status === 409);
});

test("a 202 that carries a business error is still an error", async () => {
  respond(202, { code: 10400, message: "NEWSROOM_STORY_EMPTY", data: null });
  await assert.rejects(apiWriteResult("/x", "POST"), ApiError);
});
