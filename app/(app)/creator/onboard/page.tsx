"use client";
/**
 * Creator onboarding, about two minutes, resumable (progress is saved server-side):
 *   1. Connect YouTube (read-only): proves the channel is yours; its avatar must show a face.
 *   2. Live face check: blink and turn, three frames, matched to your channel avatar.
 *   3. Self-declared 18+, consent, then "Protect my photos and go live".
 */
import Link from "next/link";
import { useCallback, useState } from "react";
import { AppPage, Card, pillClass } from "@/components/ds";
import { useAuth } from "@/components/auth/AuthProvider";
import { LivenessCapture, type Capture } from "@/components/creator/LivenessCapture";
import { api, reason, signIn, youtubeAccessToken } from "@/lib/client/firebase";
import { CONSENT_TEXT, subscriberLabel } from "@/lib/model";

type Match = { ok: boolean; score: number; threshold: number; perFrame: number[] };

export default function OnboardPage() {
  const { user, me, loading, refresh } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy(null);
    }
  };

  const onCaptured = useCallback((c: Capture) => {
    setCapture(c);
    setBusy("Matching your face to your channel…");
    setErr(null);
    api<Match>("/api/creator/match", { method: "POST", body: JSON.stringify(c) })
      .then(setMatch)
      .catch((e) => setErr(reason(e)))
      .finally(() => setBusy(null));
  }, []);

  if (!loading && !user)
    return (
      <AppPage title="Become a creator" description="Sign in with the Google account that owns your YouTube channel.">
        <button type="button" onClick={() => signIn().catch((e) => setErr(reason(e)))} className={pillClass("lime", "self-start")}>
          Sign in with Google
        </button>
      </AppPage>
    );
  if (loading || !me) return <AppPage title="Become a creator">Loading…</AppPage>;

  const c = me.creator;
  if (c?.status === "live")
    return (
      <AppPage title="You're live" description="Brands can now request a licence. You approve each one.">
        <Card tone="lime" title={`Verified creator account: YouTube, ${subscriberLabel(c.channel?.subscriberCount ?? null)}`}>
          <p className="m-0">Your photos are encrypted with your own key. Only the render service can open them, and every access is logged.</p>
          <Link href="/dashboard" className={pillClass("ink", "self-start")}>
            Go to your dashboard
          </Link>
        </Card>
      </AppPage>
    );

  const step = !c?.channel ? 1 : !match?.ok ? 2 : 3;
  return (
    <AppPage title="Become a creator" description="About two minutes. Your progress is saved.">
      <ol className="m-0 flex list-none flex-wrap gap-2 p-0 text-[14px] font-semibold" aria-label="Steps">
        {["Connect YouTube", "Live face check", "Go live"].map((l, i) => (
          <li key={l} aria-current={step === i + 1 ? "step" : undefined} className={`rounded-full px-3.5 py-1.5 ${step > i + 1 ? "bg-lime text-ink" : step === i + 1 ? "bg-ink text-white" : "bg-white text-grey"}`}>
            {i + 1}. {l}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card title="Connect your YouTube channel">
          <p className="m-0 text-[15px] text-grey">
            Google asks you to let Likeness <b>see your YouTube account</b> (read-only). We read your channel&apos;s name, avatar and subscriber count once, to show you
            own it. We can&apos;t post, edit or see anything private, and we don&apos;t keep the access.
          </p>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run("Connecting YouTube…", async () => {
                const accessToken = await youtubeAccessToken();
                await api("/api/creator/youtube", { method: "POST", body: JSON.stringify({ accessToken }) });
                await refresh();
              })
            }
            className={pillClass("ink", "self-start")}
          >
            Connect YouTube
          </button>
        </Card>
      )}

      {step >= 2 && c?.channel && (
        <Card title={`Channel: ${c.channel.title}`} action={<span className="text-[14px] text-grey">{subscriberLabel(c.channel.subscriberCount)}</span>}>
          <p className="m-0 text-[14px] text-grey">Connected. Your channel avatar is what we match your live face against.</p>
        </Card>
      )}

      {step === 2 && (
        <Card title="Live face check">
          <p className="m-0 text-[15px] text-grey">Use your camera: look at it, blink, then turn slightly each way. We take three frames. Nothing is uploaded from your files.</p>
          {!capture ? (
            <LivenessCapture key={attempt} onDone={onCaptured} />
          ) : match && !match.ok ? (
            <div className="flex flex-col gap-2">
              <p role="alert" className="m-0 text-[15px] text-bad">
                Your live face didn&apos;t match your channel avatar closely enough (best match {match.score.toFixed(2)}, needs {match.threshold.toFixed(2)}). Check the light and that
                your avatar is a clear photo of you.
              </p>
              <button type="button" onClick={() => (setCapture(null), setMatch(null), setAttempt((a) => a + 1))} className={pillClass("ink", "self-start")}>
                Try again
              </button>
            </div>
          ) : (
            !match && !err && <p className="m-0 text-[15px]">Checking…</p>
          )}
          {err && capture && (
            <button type="button" onClick={() => (setCapture(null), setMatch(null), setErr(null), setAttempt((a) => a + 1))} className={pillClass("ink", "self-start")}>
              Try again
            </button>
          )}
        </Card>
      )}

      {step === 3 && capture && match && (
        <Card title="Go live">
          <p className="m-0 text-[15px] text-ok">Face matched to your channel (score {match.score.toFixed(2)}).</p>
          <label className="flex items-start gap-3 text-[15px]">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-1 h-5 w-5" />
            <span>I am 18 or older <span className="text-grey">(self-declared)</span>.</span>
          </label>
          <label className="flex items-start gap-3 text-[15px]">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5" />
            <span>{CONSENT_TEXT}</span>
          </label>
          <p className="m-0 text-[14px] text-grey">
            Your three frames are encrypted with a key that belongs to you, wrapped by Google Cloud KMS. Only the render service can open them, and every access is logged
            and shown on your dashboard. The front frame becomes your public photo, labelled &ldquo;not licensed for reuse&rdquo;.
          </p>
          <button
            type="button"
            disabled={!adult || !consent || !!busy}
            onClick={() =>
              run("Encrypting and going live…", async () => {
                await api("/api/creator/golive", { method: "POST", body: JSON.stringify({ frames: capture.frames, adult, consent }) });
                await refresh();
              })
            }
            className={pillClass("lime", "self-start")}
          >
            Protect my photos and go live
          </button>
        </Card>
      )}

      {step === 3 && !capture && (
        <Card title="Face check needed">
          <p className="m-0 text-[15px] text-grey">Your face was matched earlier, but the frames are only kept in this browser until you go live. Take the face check again.</p>
          <button type="button" onClick={() => setMatch(null)} className={pillClass("ink", "self-start")}>
            Take the face check
          </button>
        </Card>
      )}

      {busy && <p role="status" className="m-0 text-[15px] text-wait">{busy}</p>}
      {err && <p role="alert" className="m-0 text-[15px] text-bad">{err}</p>}
    </AppPage>
  );
}
