"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppPage, Card, pillClass } from "@/components/ds";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, reason, signIn } from "@/lib/client/firebase";

/** After sign-in: choose to be a creator or a brand (you can do both later). */
export default function StartPage() {
  const { user, me, loading, refresh } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (me?.user.role === "creator") router.replace(me.creator?.status === "live" ? "/dashboard" : "/creator/onboard");
    if (me?.user.role === "brand") router.replace("/dashboard");
  }, [me, router]);

  async function choose(role: "creator" | "brand") {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/me", { method: "POST", body: JSON.stringify({ role }) });
      await refresh();
      router.push(role === "creator" ? "/creator/onboard" : "/dashboard");
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !user)
    return (
      <AppPage title="Get started" description="Sign in with your Google account to continue.">
        <button type="button" onClick={() => signIn().catch((e) => setErr(reason(e)))} className={pillClass("lime", "self-start")}>
          Sign in with Google
        </button>
        {err && <p className="m-0 text-bad">{err}</p>}
      </AppPage>
    );

  return (
    <AppPage title="How will you use Likeness?" description="Pick one to start. You can switch later.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="I'm a creator">
          <p className="m-0 text-[15px] text-grey">Connect your YouTube channel, take a quick live face check, and license your likeness for AI ads. You approve every brand and get paid per render.</p>
          <button type="button" disabled={busy} onClick={() => choose("creator")} className={pillClass("ink", "mt-2 self-start")}>
            Become a creator
          </button>
        </Card>
        <Card title="I'm a brand">
          <p className="m-0 text-[15px] text-grey">Request a licence from a verified creator, then make image and video ads in minutes, paid per render.</p>
          <button type="button" disabled={busy} onClick={() => choose("brand")} className={pillClass("lime", "mt-2 self-start")}>
            License a face
          </button>
        </Card>
      </div>
      {err && <p className="m-0 text-bad">{err}</p>}
    </AppPage>
  );
}
