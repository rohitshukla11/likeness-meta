"use client";
/** Email and password sign-in for the seeded judge accounts (scripts/seed-judges.ts); everyone else uses Google. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pillClass } from "@/components/ds";
import { inputClass } from "@/components/ui";
import { reason, signInWithEmail } from "@/lib/client/firebase";

export function JudgeSignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="mt-4 flex max-w-[420px] flex-col gap-2 rounded-[14px] border border-divider bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await signInWithEmail(email, password);
          router.push("/dashboard");
        } catch (x) {
          setErr(/auth\/(invalid-credential|wrong-password|user-not-found)/.test(String(x)) ? "That email and password don't match a judge account." : /operation-not-allowed/.test(String(x)) ? "Email sign-in isn't enabled on this server yet." : reason(x));
        } finally {
          setBusy(false);
        }
      }}
    >
      <b className="text-[15px]">Judges: sign in with the demo account</b>
      <span className="text-[13px] text-grey">A brand and a creator account are set up with a synthetic creator, a licence and demo credits.</span>
      <label className="flex flex-col gap-1 text-[14px]">
        <span className="text-grey">Email</span>
        <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        <span className="text-grey">Password</span>
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </label>
      <button type="submit" disabled={busy} className={pillClass("ink", "self-start")}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {err && (
        <span role="alert" className="text-[14px] text-bad">
          {err}
        </span>
      )}
    </form>
  );
}
