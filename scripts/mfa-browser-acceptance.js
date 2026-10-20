// Run with playwright-cli run-code --filename=scripts/mfa-browser-acceptance.js.
// Requires the disposable local mfa_browser database and the documented fixture accounts.
async page => {
  const base = "http://127.0.0.1:33181";
  if (new URL(page.url()).origin !== base) throw new Error("Only the isolated local acceptance environment is allowed");
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const browser = page.context().browser();
  const adminContext = await browser.newContext();
  page = await adminContext.newPage();
  const userContext = await browser.newContext();
  const user = await userContext.newPage();
  const pageErrors = [];
  for (const p of [page, user]) p.on("pageerror", e => pageErrors.push(e.message));
  const password = "MfaTestOnly-2026!";
  const captures = new Map();
  async function instrument(p) {
    const state = { messages: [], waiters: [] };
    captures.set(p, state);
    await p.exposeBinding("__mfaAcceptanceResponse", (_, message) => {
      const index = state.waiters.findIndex(w => w.matches(message));
      if (index < 0) state.messages.push(message);
      else state.waiters.splice(index, 1)[0].resolve(message);
    });
    await p.addInitScript(() => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const r = await realFetch(...args);
        if (r.url.includes("/admin/system/auth/") || r.url.includes("/admin/system/user/mfa/")) {
          // Copy the real response before login navigates away; never mock or replace the API.
          const body = await r.clone().json();
          await window.__mfaAcceptanceResponse({ url: r.url, method: args[1]?.method || "GET", status: r.status, body });
        }
        return r;
      };
    });
  }
  function response(p, suffix, method = "POST") {
    const state = captures.get(p);
    const matches = r => r.url.endsWith(suffix) && r.method === method;
    const index = state.messages.findIndex(matches);
    if (index >= 0) return Promise.resolve(state.messages.splice(index, 1)[0]);
    return new Promise(resolve => state.waiters.push({ matches, resolve }));
  }
  async function login(p, username) {
    await p.goto(`${base}/login`);
    await p.getByRole("textbox", { name: "管理员账号" }).fill(username);
    await p.getByRole("textbox", { name: "登录密码" }).fill(password);
    const result = response(p, "/system/auth/login");
    await p.getByRole("button", { name: "安全登录", exact: true }).click();
    const r = await result;
    assert(r.body.code === 0, `Login failed: ${r.body.message}`);
    return r;
  }
  async function openPolicy() {
    await page.goto(`${base}/system/user`);
    const row = page.getByRole("row").filter({ hasText: "mfa_browser" }).last();
    await row.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("menuitem", { name: "MFA 设置", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "mfa_browser · MFA", exact: true });
    await drawer.getByRole("checkbox", { name: "必须绑定 MFA" }).waitFor();
    return drawer;
  }
  async function policy(required) {
    const drawer = await openPolicy();
    await drawer.getByRole("checkbox", { name: "必须绑定 MFA" }).setChecked(required);
    const result = response(page, "/system/user/mfa/91001", "PUT");
    await drawer.getByRole("button", { name: "保存", exact: true }).click();
    assert((await result).body.code === 0, "Admin policy update failed");
    await drawer.waitFor({ state: "hidden" });
  }
  async function totp(secret, step = Math.floor(Date.now() / 30000)) {
    // Independent WebCrypto implementation, not the backend's Totp helper.
    return user.evaluate(async ({ secret, step }) => {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      let bits = "";
      for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
      const keyBytes = Uint8Array.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
      const counter = new Uint8Array(8);
      let value = BigInt(step);
      for (let i = 7; i >= 0; i--) { counter[i] = Number(value & 255n); value >>= 8n; }
      const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
      const offset = mac[19] & 15;
      const binary = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
      return String(binary % 1000000).padStart(6, "0");
    }, { secret, step });
  }
  async function submitCode(code, binding) {
    await user.getByRole("textbox", { name: "动态验证码" }).fill(code);
    const result = response(user, "/system/auth/mfa/verify");
    await user.getByRole("button", { name: binding ? "确认绑定并登录" : "验证并登录", exact: true }).click();
    return result;
  }
  async function checkChallenge(result, status) {
    assert(result.body.data.status === status, `Expected ${status}`);
    assert(!result.body.data.accessToken && !result.body.data.refreshToken, "Formal token issued before MFA");
    await user.waitForURL(`${base}/mfa`);
    assert(!(await userContext.cookies()).some(c => c.name === "neton_session" && c.value), "Cookie issued before MFA");
    const protectedResult = await user.request.get(`${base}/admin/system/auth/get-permission-info`);
    assert(protectedResult.status() === 401, "Unauthenticated MFA page could reach protected API");
    const challenge = result.body.data.challengeToken;
    const bearer = await user.request.get(`${base}/admin/system/auth/get-permission-info`, { headers: { Authorization: `Bearer ${challenge}` } });
    assert(bearer.status() === 401, "Challenge accepted as access token");
    const refresh = await user.request.post(`${base}/admin/system/auth/refresh-token`, { data: { refreshToken: challenge } });
    assert((await refresh.json()).code !== 0, "Challenge accepted as refresh token");
  }
  try {
    await instrument(page); await instrument(user);
    await page.context().clearCookies();
    await page.goto(`${base}/login`);
    await page.evaluate(() => localStorage.removeItem("neton-workspace"));
    const admin = await login(page, "admin");
    assert(admin.body.data.status === "authenticated", "Fixture admin must not require MFA");
    await policy(false);
    const initial = await login(user, "mfa_browser");
    assert(initial.body.data.status === "authenticated", "Fixture target must start unbound");
    const oldCookie = (await userContext.cookies()).find(c => c.name === "neton_session");
    await policy(true);
    assert((await user.request.get(`${base}/admin/system/auth/get-permission-info`)).status() === 401, "Enabling policy did not revoke previous session");
    checks.push("policy_change_revokes_old_session");
    const first = await login(user, "mfa_browser");
    await checkChallenge(first, "mfa_enrollment_required");
    await user.getByRole("heading", { name: "绑定身份验证器" }).waitFor();
    await user.locator("main svg").waitFor();
    const secret = (await user.locator("details code").textContent()).trim();
    assert(/^[A-Z2-7]{32}$/.test(secret), "Invalid enrollment secret");
    assert((await user.request.get(`${base}/admin/system/auth/get-permission-info`, { headers: { Cookie: `neton_session=${oldCookie.value}` } })).status() === 401, "Old cookie survived policy change");
    checks.push("forced_binding_qr_no_token_no_cookie_challenge_not_session");
    const step = Math.floor(Date.now() / 30000);
    const valid = await totp(secret, step);
    const neighbours = await Promise.all([-1, 0, 1].map(delta => totp(secret, step + delta)));
    let wrong = "000000";
    while (neighbours.includes(wrong)) wrong = String(Number(wrong) + 1).padStart(6, "0");
    const rejected = await submitCode(wrong, true);
    assert(rejected.body.code !== 0, "Wrong code was accepted");
    await user.getByText(rejected.body.message, { exact: true }).waitFor();
    assert(user.url().endsWith("/mfa"), "Wrong code left MFA page");
    assert(!(await userContext.cookies()).some(c => c.name === "neton_session" && c.value), "Wrong code issued cookie");
    const bound = await submitCode(valid, true);
    assert(bound.body.code === 0 && bound.body.data.status === "authenticated", "Binding did not complete");
    await user.waitForURL(`${base}/`);
    const cookie = (await userContext.cookies()).find(c => c.name === "neton_session");
    assert(cookie?.httpOnly, "Formal session must be HttpOnly");
    assert(!await user.evaluate(() => document.cookie.includes("neton_session=")), "Session cookie is script-readable");
    assert((await user.request.get(`${base}/admin/system/auth/get-permission-info`)).status() === 200, "Bound session rejected");
    checks.push("wrong_code_denied_binding_issues_httponly_session");
    await user.request.post(`${base}/admin/system/auth/logout`);
    const second = await login(user, "mfa_browser");
    await checkChallenge(second, "mfa_required");
    await user.getByRole("heading", { name: "两步验证" }).waitFor();
    assert(await user.locator("main svg").count() === 0, "Bound login exposed enrollment QR");
    // A genuinely current time-step is needed; immediately reusing the binding code must fail.
    const replay = await submitCode(valid, false);
    assert(replay.body.code !== 0, "Binding code was replayed in another challenge");
    if (Math.floor(Date.now() / 30000) <= step) await user.waitForTimeout((step + 1) * 30000 - Date.now() + 150);
    const loggedIn = await submitCode(await totp(secret), false);
    assert(loggedIn.body.code === 0 && loggedIn.body.data.status === "authenticated", "MFA login failed");
    await user.waitForURL(`${base}/`);
    const preResetCookie = (await userContext.cookies()).find(c => c.name === "neton_session");
    checks.push("bound_login_requires_mfa_replay_denied_current_code_success");
    const drawer = await openPolicy();
    assert(await drawer.getByRole("checkbox", { name: "必须绑定 MFA" }).isChecked(), "Required flag disappeared");
    await drawer.getByRole("button", { name: "重置 MFA", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", { name: "重置 MFA？", exact: true });
    const resetResult = response(page, "/system/user/mfa/91001/reset");
    await confirmation.getByRole("button", { name: "确认", exact: true }).click();
    assert((await resetResult).body.code === 0, "Admin reset failed");
    await drawer.getByText("绑定状态：未绑定", { exact: true }).waitFor();
    assert(await drawer.getByRole("checkbox", { name: "必须绑定 MFA" }).isChecked(), "Reset removed requirement");
    const oldAccess = await user.request.get(`${base}/admin/system/auth/get-permission-info`, { headers: { Cookie: `neton_session=${preResetCookie.value}` } });
    assert(oldAccess.status() === 401, "Reset did not revoke access session");
    const oldRefresh = await user.request.post(`${base}/admin/system/auth/refresh-token`, { data: { refreshToken: loggedIn.body.data.refreshToken } });
    assert((await oldRefresh.json()).code !== 0, "Reset did not revoke refresh token");
    await user.reload();
    await user.waitForURL(`${base}/login`);
    checks.push("admin_reset_preserves_requirement_revokes_access_refresh_browser_redirects");
    const third = await login(user, "mfa_browser");
    await checkChallenge(third, "mfa_enrollment_required");
    await user.locator("main svg").waitFor();
    const nextSecret = (await user.locator("details code").textContent()).trim();
    assert(nextSecret !== secret, "Reset reused old TOTP key");
    const rebound = await submitCode(await totp(nextSecret), true);
    assert(rebound.body.code === 0 && rebound.body.data.status === "authenticated", "Rebinding failed");
    await user.waitForURL(`${base}/`);
    assert((await user.request.get(`${base}/admin/system/auth/get-permission-info`)).status() === 200, "Rebound session rejected");
    checks.push("reset_requires_new_qr_and_rebinding_restores_session");
    assert(pageErrors.length === 0, `Browser runtime errors: ${pageErrors.join("; ")}`);
    return { status: "MFA_BROWSER_PASS", frontend: "production", checks };
  } finally {
    await userContext.close();
    await adminContext.close();
  }
}
