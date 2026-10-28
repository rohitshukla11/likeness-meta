"use client";
import { useState } from "react";
import { Card, StatCard, pillClass } from "@/components/ds";
import { StatusBadge } from "@/components/ui";
import type { Me } from "@/components/auth/AuthProvider";
import { CATEGORIES } from "@/lib/categories";
import { api, reason } from "@/lib/client/firebase";
import { credits, subscriberLabel, useLabel, type Terms } from "@/lib/model";
import { RenderCard } from "./RenderCard";
import { useApi, when, type Lists, type Render } from "./shared";

export function CreatorDashboard({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const c = me.creator!;
  const lists = useApi<Lists>("/api/licences");
  const renders = useApi<{ asCreator: Render[] }>("/api/renders");
  const log = useApi<{ decryptions: { licenceId: string; renderId: string; by: string; at: number }[] }>("/api/creator/decryptions");
  const ledger = useApi<{ ledger: { id: string; delta: number; reason: string; at: number }[] }>("/api/credits/topup");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
      setMsg(done);
      await Promise.all([lists.reload(), refresh(), ledger.reload()]);
    } catch (e) {
      setMsg(reason(e));
    } finally {
      setBusy(false);
    }
  };
  const pending = lists.data?.asCreator.requests.filter((r) => r.state === "pending") ?? [];
  const licences = lists.data?.asCreator.licences ?? [];

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Earned (demo credits)" value={credits(me.credits)} note="after the 10% fee" />
        <StatCard label="Active licences" value={licences.filter((l) => l.status === "Active").length} note={`${pending.length} request${pending.length === 1 ? "" : "s"} waiting`} />
        <Card tone="violet">
          <span className="text-[14px] font-semibold">Verified creator account</span>
          <span className="text-[18px] font-bold">YouTube, {subscriberLabel(c.channel?.subscriberCount ?? null)}</span>
          <span className="text-[13px]">{c.demo ? "Synthetic demo creator" : `Live face matched to the channel avatar · 18+ self-declared`}</span>
        </Card>
      </div>

      {msg && <p role="status" className="m-0 text-[15px] text-wait">{msg}</p>}

      <Card title={`Licence requests${pending.length ? ` (${pending.length})` : ""}`}>
        {pending.length === 0 && <p className="m-0 text-grey">No requests waiting. Brands find you on the Creators page.</p>}
        {pending.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-[14px] bg-paper p-3">
            <span className="font-semibold">
              {r.brandName} · {useLabel(r.use)} · {r.days} days · up to {r.maxRenders} renders
            </span>
            <span className="text-grey">&ldquo;{r.brief}&rdquo;</span>
            <span className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => act(() => api(`/api/requests/${r.id}`, { method: "POST", body: JSON.stringify({ approve: true }) }), `Approved: ${r.brandName} can now render.`)} className={pillClass("lime", "min-h-10 px-4")}>
                Approve
              </button>
              <button type="button" disabled={busy} onClick={() => act(() => api(`/api/requests/${r.id}`, { method: "POST", body: JSON.stringify({ approve: false }) }), "Declined.")} className={pillClass("outline", "min-h-10 px-4")}>
                Decline
              </button>
            </span>
          </div>
        ))}
      </Card>

      <Card title="Licences">
        {licences.length === 0 && <p className="m-0 text-grey">No licences yet.</p>}
        {licences.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-3 border-b border-divider py-2 last:border-0">
            <StatusBadge status={l.status} />
            <span className="font-semibold">{l.brandName}</span>
            <span className="text-grey">
              {useLabel(l.use)} · {l.renderCount}/{l.maxRenders} renders · until {when(l.end)}
            </span>
            {l.status === "Active" && (
              <button type="button" disabled={busy} onClick={() => act(() => api(`/api/licences/${l.id}/revoke`, { method: "POST" }), "Revoked: new renders under this licence are refused.")} className={pillClass("danger", "ml-auto min-h-10 px-4")}>
                Revoke
              </button>
            )}
          </div>
        ))}
      </Card>

      <Card title="Ads made with your likeness">
        <p className="m-0 text-[14px] text-grey">Every image and video a brand made with your face, what it was for, and what you earned. Read-only.</p>
        {(renders.data?.asCreator ?? []).length === 0 && <p className="m-0 text-grey">None yet.</p>}
        {(renders.data?.asCreator ?? []).map((r) => (
          <RenderCard key={r.id} r={r} mode="creator" />
        ))}
      </Card>

      <TermsCard terms={c.terms} onSaved={refresh} />

      <Card title="Who opened your photos">
        <p className="m-0 text-[14px] text-grey">Every time the render service decrypted your photos, for which licence and render. Cloud KMS keeps its own audit log of each key use too.</p>
        {(log.data?.decryptions ?? []).length === 0 && <p className="m-0 text-grey">Never.</p>}
        {(log.data?.decryptions ?? []).slice(0, 20).map((d, i) => (
          <span key={i} className="text-[14px]">
            {when(d.at)} · licence {d.licenceId.slice(0, 8)} · render {d.renderId.slice(0, 8)} · by {d.by}
          </span>
        ))}
      </Card>

      <Card title="Credit history (demo credits)">
        {(ledger.data?.ledger ?? []).slice(0, 15).map((e) => (
          <span key={e.id} className="text-[14px]">
            {when(e.at)} · <b className={e.delta >= 0 ? "text-ok" : "text-bad"}>{e.delta >= 0 ? "+" : ""}{e.delta}</b> · {e.reason}
          </span>
        ))}
      </Card>
    </div>
  );
}

function TermsCard({ terms, onSaved }: { terms: Terms | null; onSaved: () => Promise<void> }) {
  // Terms saved before video settings existed: video allowed, 3 per licence.
  const [t, setT] = useState<Terms | null>(terms ? { ...terms, videoAllowed: terms.videoAllowed ?? true, maxVideosPerLicence: terms.maxVideosPerLicence ?? 3 } : null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!t) return null;
  const num = (k: keyof Terms, label: string) => (
    <label className="flex flex-col gap-1 text-[14px]">
      <span className="text-grey">{label}</span>
      <input type="number" min={1} value={t[k] as number} onChange={(e) => setT({ ...t, [k]: Math.max(1, Math.floor(Number(e.target.value))) })} className="min-h-11 rounded-[12px] border border-field px-3" />
    </label>
  );
  return (
    <Card title="Your terms">
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => {
          const on = t.uses.includes(cat.key);
          return (
            <button key={cat.key} type="button" aria-pressed={on} onClick={() => setT({ ...t, uses: on ? t.uses.filter((u) => u !== cat.key) : [...t.uses, cat.key] })} className={pillClass(on ? "ink" : "outline", "min-h-10 px-4 text-[14px]")}>
              {cat.label}
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {num("pricePerImage", "Price per image (credits)")}
        {num("pricePerVideo", "Price per video (credits)")}
        {num("maxRendersPerLicence", "Max renders per licence")}
        {num("maxDays", "Max licence length (days)")}
        {num("maxVideosPerLicence", "Max videos per licence")}
      </div>
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" checked={t.videoAllowed} onChange={(e) => setT({ ...t, videoAllowed: e.target.checked })} className="h-5 w-5" />
        Allow video ads (Veo animates an image ad you already licensed)
      </label>
      <p className="m-0 text-[13px] text-grey">You approve every licence yourself. Political, adult, minor-related, impersonation and deceptive uses are never allowed.</p>
      <button
        type="button"
        onClick={() =>
          api("/api/creator/terms", { method: "POST", body: JSON.stringify({ terms: t }) })
            .then(() => (setMsg("Saved."), onSaved()))
            .catch((e) => setMsg(reason(e)))
        }
        className={pillClass("ink", "self-start")}
      >
        Save terms
      </button>
      {msg && <span className="text-[14px] text-wait">{msg}</span>}
    </Card>
  );
}
