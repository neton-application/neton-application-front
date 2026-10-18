"use client";

import * as React from "react";
import { ArrowRight, Check, Eye, EyeOff, Fingerprint, KeyRound, Moon, ShieldCheck, Sun } from "lucide-react";
import { Alert, Button, Input, Label } from "@neton/application-front-kit";
import { ApiError, login } from "@neton/application-front-runtime/client";
import { useBrand } from "@neton/application-front-runtime/brand";
import { useDescribeError } from "@neton/application-front-runtime/errors";
import { useT } from "@neton/application-front-runtime/i18n";
import { BrandMark } from "@/components/brand-mark";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ServiceStatus } from "@/components/service-status";

export default function LoginPage() {
  const t = useT("shell");
  const describeError = useDescribeError("system");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [passwordVisible, setPasswordVisible] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [darkMode, setDarkMode] = React.useState(false);
  const brand = useBrand(t("login.title"));

  React.useEffect(() => {
    setDarkMode(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    localStorage.setItem("neton-front-theme", next ? "dark" : "light");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      // 直连后端：成功后会话 Cookie 由后端 Set-Cookie 下发，前端不接触 token。
      const body = await login(username, password);
      if (body.code === 0) {
        if (body.data?.status === "mfa_required" || body.data?.status === "mfa_enrollment_required") {
          sessionStorage.setItem("neton-mfa-challenge", JSON.stringify(body.data));
          setPassword("");
          window.location.replace("/mfa");
          return;
        }
        sessionStorage.removeItem("neton-mfa-challenge");
        window.location.href = "/";
        return;
      }
      // 后端把「用户不存在 / 密码错误 / 已停用」统一成同一句，这里也只给一句（评审 R08）。
      setError(body.code === 10300 || body.code === 429 ? describeError(new ApiError("rate_limited", body.message ?? "")) : t("login.failed"));
    } catch (cause) {
      setError(describeError(cause instanceof ApiError ? cause : new ApiError("network", String(cause))));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.42] dark:opacity-[0.18]" style={{ backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)", backgroundSize: "72px 72px", maskImage: "linear-gradient(to bottom, black, transparent 82%)" }} />
      <div className="pointer-events-none absolute left-1/2 top-[-320px] h-[680px] w-[900px] -translate-x-1/2 rounded-full bg-[var(--foreground)]/[0.035] blur-[110px]" />

      <header className="relative z-10 mx-auto flex h-20 w-full max-w-[1280px] items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <BrandMark className="h-10 w-10" />
          <div>
            <div className="text-sm font-semibold tracking-[-0.01em]">{brand.name}</div>
            {brand.tagline && <div className="mt-0.5 text-[10px] font-medium tracking-[0.18em] text-[var(--muted-foreground)]">{brand.tagline}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ServiceStatus className="hidden items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)]/70 px-3 py-2 text-[11px] text-[var(--muted-foreground)] shadow-sm backdrop-blur sm:flex" />
          <LocaleSwitcher />
          <button type="button" onClick={toggleTheme} aria-label={darkMode ? t("theme.light") : t("theme.dark")} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] shadow-sm transition hover:text-[var(--foreground)]">
            {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <section className="relative z-[1] mx-auto flex min-h-[calc(100vh-132px)] w-full max-w-[1280px] items-center px-5 py-10 sm:px-8">
        <div className="mx-auto grid w-full max-w-[1040px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[0_30px_100px_rgba(15,23,42,0.12)] dark:shadow-[0_30px_100px_rgba(0,0,0,0.42)] lg:grid-cols-[0.92fr_1.08fr]">
          <section className="relative flex min-h-[570px] flex-col overflow-hidden border-b border-[var(--border)] bg-[var(--muted)] p-7 sm:p-10 lg:border-b-0 lg:border-r">
            <div className="absolute -right-28 -top-28 h-72 w-72 rounded-full border-[52px] border-[var(--foreground)]/[0.04]" />
            <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full border-[70px] border-[var(--foreground)]/[0.025]" />

            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-[10px] font-semibold tracking-[0.14em] text-[var(--muted-foreground)] shadow-sm">
                <Fingerprint size={13} className="text-[var(--primary)]" />
                {t("login.privileged")}
              </div>
              <h1 className="mt-8 max-w-sm text-[30px] font-semibold leading-[1.2] tracking-[-0.035em] sm:text-[34px]">{t("login.heroTitle")}</h1>
              <p className="mt-4 max-w-sm text-sm leading-7 text-[var(--muted-foreground)]">{brand.description || t("login.heroBody")}</p>
            </div>

            <div className="relative mt-10 space-y-1 rounded-xl border border-[var(--border)] bg-[var(--card)]/75 p-2 shadow-sm backdrop-blur">
              {[
                [t("login.featureIdentity"), t("login.featureIdentityDetail")],
                [t("login.featurePolicy"), t("login.featurePolicyDetail")],
                [t("login.featureAudit"), t("login.featureAuditDetail")],
              ].map(([label, detail]) => (
                <div key={label} className="flex items-center gap-3 rounded-xl px-3 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]"><Check size={14} strokeWidth={2.5} /></span>
                  <div className="min-w-0"><div className="text-xs font-semibold">{label}</div><div className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">{detail}</div></div>
                </div>
              ))}
            </div>

            <div className="relative mt-auto pt-8 text-[10px] font-medium tracking-[0.1em] text-[var(--muted-foreground)]">
              <span>{brand.name}</span>
            </div>
          </section>

          <section className="flex min-h-[570px] items-center p-7 sm:p-10 lg:p-14">
            <div className="mx-auto w-full max-w-[390px]">
              <div className="mb-8">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--primary)]"><KeyRound size={18} /></div>
                <p className="mt-6 text-[10px] font-semibold tracking-[0.17em] text-[var(--primary)]">{t("login.eyebrow")}</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{t("login.title")}</h2>
                <p className="mt-2 text-xs leading-6 text-[var(--muted-foreground)]">{t("login.subtitle")}</p>
              </div>

              <form className="space-y-4" onSubmit={submit}>
                {error && <Alert tone="error">{error}</Alert>}
                <div className="space-y-2">
                  <Label htmlFor="username">{t("login.username")}</Label>
                  <Input id="username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t("login.usernamePlaceholder")} autoComplete="username" autoFocus className="h-11 bg-[var(--background)] px-3.5" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t("login.password")}</Label>
                  <div className="relative">
                    <Input id="password" name="password" type={passwordVisible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("login.passwordPlaceholder")} autoComplete="current-password" className="h-11 bg-[var(--background)] px-3.5 pr-11" />
                    <button type="button" onClick={() => setPasswordVisible((value) => !value)} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]" aria-label={passwordVisible ? t("login.hidePassword") : t("login.showPassword")}>
                      {passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="group mt-2 h-11 w-full gap-2 text-sm" disabled={pending || !username || !password}>
                  {pending ? t("login.submitting") : t("login.submit")}
                  {!pending && <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />}
                </Button>
              </form>

              <div className="mt-7 flex items-start gap-2.5 border-t border-[var(--border)] pt-5 text-[11px] leading-5 text-[var(--muted-foreground)]">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                <span>{t("login.notice")}</span>
              </div>
            </div>
          </section>
        </div>
      </section>

      <footer className="relative z-10 mx-auto flex h-[52px] w-full max-w-[1280px] items-center justify-between px-5 text-[10px] text-[var(--muted-foreground)] sm:px-8">
        <span>{brand.copyright}</span>
      </footer>
    </main>
  );
}
