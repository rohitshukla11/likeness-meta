"use client";
import Link from "next/link";
import { use, useState } from "react";
import { AppPage, Card, pillClass } from "@/components/ds";
import { inputClass } from "@/components/ui";
import { useAuth } from "@/components/auth/AuthProvider";
import { useApi } from "@/components/dashboard/shared";
import { api, reason } from "@/lib/client/firebase";
import { AUTO_APPROVED_LABEL, credits, subscriberLabel, useLabel, type Terms } from "@/lib/model";

type C = {
  uid: string;
  displayName: string;
  demo: boolean;
  channel: { title: string; subscriberCount: number | null; connectedAt: number } | null;
  faceMatch: { score: number; at: number } | null;
  adultSelfDeclared: boolean;
  terms: Terms | null;
  photo: string | null;
};

export default function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useAuth();
  const { data, error } = useApi<{ creator: C }>(`/api/creators/${id}`);
  const c = data?.creator;
  const [use_, setUse] = useState("");
  const [days, setDays] = useState(7);
  const [renders, setRenders] = useState(3);
  const [brief, setBrief] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<"pending" | "approved" | null>(null);
  if (error) return <AppPage title="Creator">{error}</AppPage>;
  if (!c) return <AppPage title="Creator">Loading…</AppPage>;
  const t = c.terms;
  return (
    <AppPage title={c.displayName} description={c.demo ? "Synthetic demo creator: a generated face, not a real person." : `Verified creator account: YouTube, ${subscriberLabel(c.channel?.subscriberCount ?? null)}`}>
      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <Card>
          {c.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.photo} alt={`${c.displayName}'s public photo`} className="aspect-square w-full rounded-[14px] object-cover" />
          )}
          <span className="text-[14px] text-grey">
            {c.demo
              ? "Synthetic demo creator: a face generated with Gemini, not a real person. No YouTube channel."
              : `Channel ownership proven with YouTube sign-in. Live face matched to the channel avatar${c.faceMatch ? ` (score ${c.faceMatch.score})` : ""}. Age 18+ self-declared; legal identity not checked.`}
          </span>
        </Card>
        <Card title="Request a licence">
          {t && (
            <p className="m-0 text-[15px]">
              {credits(t.pricePerImage)} per image · {credits(t.pricePerVideo)} per video · up to {t.maxRendersPerLicence} renders · up to {t.maxDays} days.{" "}
              {c.demo ? `Requests are ${AUTO_APPROVED_LABEL}.` : "The creator approves every request."}
            </p>
          )}
          {me?.user.role !== "brand" ? (
            <p className="m-0 text-grey">
              <Link href="/start">Sign in as a brand</Link> to request a licence.
            </p>
          ) : ok === "approved" ? (
            <p className="m-0 text-ok">
              Approved: {AUTO_APPROVED_LABEL}. Your licence is on your <Link href="/dashboard">dashboard</Link>; make your first ad there.
            </p>
          ) : ok ? (
            <p className="m-0 text-ok">
              Requested. You&apos;ll see it on your <Link href="/dashboard">dashboard</Link> once {c.displayName} approves.
            </p>
          ) : (
            t && (
              <>
                <div className="flex flex-wrap gap-2">
                  {t.uses.map((u) => (
                    <button key={u} type="button" aria-pressed={use_ === u} onClick={() => setUse(u)} className={pillClass(use_ === u ? "ink" : "outline", "min-h-10 px-4 text-[14px]")}>
                      {useLabel(u)}
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-[14px]">
                    <span className="text-grey">Days (max {t.maxDays})</span>
                    <input type="number" min={1} max={t.maxDays} value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1 text-[14px]">
                    <span className="text-grey">Renders (max {t.maxRendersPerLicence})</span>
                    <input type="number" min={1} max={t.maxRendersPerLicence} value={renders} onChange={(e) => setRenders(Number(e.target.value))} className={inputClass} />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-[14px]">
                  <span className="text-grey">Campaign brief (what the ads are for)</span>
                  <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} className={`${inputClass} py-2`} placeholder="Spring launch of our oat latte: three social ads in a café setting." />
                </label>
                <button
                  type="button"
                  disabled={!use_ || brief.trim().length < 10}
                  onClick={() =>
                    api<{ request: { state: string } }>("/api/requests", { method: "POST", body: JSON.stringify({ creatorId: c.uid, use: use_, days, maxRenders: renders, brief }) })
                      .then((r) => setOk(r.request.state === "approved" ? "approved" : "pending"))
                      .catch((e) => setMsg(reason(e)))
                  }
                  className={pillClass("lime", "self-start")}
                >
                  Send request
                </button>
                {msg && <span className="text-bad">{msg}</span>}
              </>
            )
          )}
        </Card>
      </div>
    </AppPage>
  );
}
