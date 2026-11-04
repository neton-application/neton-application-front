interface Profile { id: string | number; locale?: string }
interface Envelope { code: number; data?: Profile }
type Request = (path: string, init?: RequestInit) => Promise<Envelope | null>;
export const PROFILE_GET = "/admin/system/user/profile/get";
export const PROFILE_UPDATE = "/admin/system/user/profile/update";
const superseded = () => new DOMException("SUPERSEDED", "AbortError");

/** Cookie sessions are rechecked, never inferred from a previous load or from localStorage. */
export function createAdminLocalePreferences(request: Request) {
  let generation = 0;
  let subject: string | undefined;
  let saving: Promise<void> | undefined;
  return {
    currentSubject: () => subject,
    async load(): Promise<string | null | undefined> {
      while (saving) await saving.catch(() => {});
      const mine = ++generation;
      const body = await request(PROFILE_GET);
      if (mine !== generation) throw superseded();
      if (body?.code === 401) { subject = undefined; return undefined; }
      if (body?.code !== 0 || !body.data) throw new Error("LOCALE_LOAD_FAILED");
      subject = String(body.data.id);
      return body.data.locale?.trim() || null;
    },
    async save(locale: string) {
      const operation = (async () => {
        const mine = ++generation; // prevents an older load from undoing this choice
        const expected = subject;
        const session = await request(PROFILE_GET);
        if (mine !== generation) throw superseded();
        if (session?.code === 401 && expected === undefined) return; // anonymous choice
        if (session?.code !== 0 || !session.data) throw new Error("LOCALE_SAVE_FAILED");
        const id = String(session.data.id);
        if (expected !== undefined && id !== expected) throw new DOMException("SUBJECT_CHANGED", "AbortError");
        const body = await request(PROFILE_UPDATE, {
          method: "PUT", body: JSON.stringify({ locale }),
          headers: { "X-Neton-Preference-Subject": id },
        });
        if (mine !== generation || body?.code === 10205) throw superseded();
        if (body?.code !== 0) throw new Error("LOCALE_SAVE_FAILED");
        subject = id;
      })();
      saving = operation;
      try { await operation; } finally { if (saving === operation) saving = undefined; }
    },
  };
}
