"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Card, StatCard, pillClass } from "@/components/ds";
import { StatusBadge, inputClass } from "@/components/ui";
import type { Me } from "@/components/auth/AuthProvider";
import { api, reason } from "@/lib/client/firebase";
import { AUTO_APPROVED_LABEL, credits, DEMO_TOPUP, useLabel } from "@/lib/model";
import { CreativeAssistant } from "./CreativeAssistant";
import { ErrorNotice } from "./ErrorNotice";
import { BlockedCard, RenderCard } from "./RenderCard";
import { RenderTimeline } from "./RenderTimeline";
import { useApi, when, type BlockedRender, type LicenceRow, type Lists, type Render } from "./shared";

/** What a render endpoint returns, turned into a list row using the licence's names. */
const asRow = (render: Omit<Render, "creatorName" | "brandName" | "use">, l: LicenceRow): Render => ({ ...render, creatorName: l.creatorName, brandName: l.brandName, use: l.use });

export function BrandDashboard({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const lists = useApi<Lists>("/api/licences");
  const renders = useApi<{ asBrand: Render[]; blockedAsBrand: BlockedRender[] }>("/api/renders");
  const [msg, setMsg] = useState<string | null>(null);
  // Renders made in this session go on top at once; the list then reloads in the background.
  const [fresh, setFresh] = useState<Render[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (highlight) cardRefs.current.get(highlight)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight, fresh]);
  const [name, setName] = useState(me.brand?.name ?? "");
  const [site, setSite] = useState(me.brand?.website ?? "");

  if (!me.brand)
    return (
      <Card title="Set up your brand">
        <label className="flex flex-col gap-1 text-[14px]">
          <span className="text-grey">Brand name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Brew & Co." />
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          <span className="text-grey">Website (optional)</span>
          <input value={site} onChange={(e) => setSite(e.target.value)} className={inputClass} placeholder="brewandco.example" />
        </label>
        <button type="button" onClick={() => api("/api/brand", { method: "POST", body: JSON.stringify({ name, website: site }) }).then(refresh).catch((e) => setMsg(reason(e)))} className={pillClass("ink", "self-start")}>
          Save brand
        </button>
        {msg && <span className="text-bad">{msg}</span>}
      </Card>
    );

  const licences = lists.data?.asBrand.licences ?? [];
  const listed = renders.data?.asBrand ?? [];
  const allRenders = [...fresh.filter((f) => !listed.some((r) => r.id === f.id)), ...listed];
  // Delivered and blocked renders together, newest first; each card reopens its steps.
  const cards = [...allRenders.map((r) => ({ kind: "render" as const, r, at: r.createdAt })), ...(renders.data?.blockedAsBrand ?? []).map((b) => ({ kind: "blocked" as const, b, at: b.createdAt }))].sort((x, y) => y.at - x.at);
  const pending = (lists.data?.asBrand.requests ?? []).filter((r) => r.state === "pending");
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Demo credits" value={credits(me.credits)} note="demo money for the prototype, not real payments" />
        <StatCard label="Active licences" value={licences.filter((l) => l.status === "Active").length} note={`${pending.length} request${pending.length === 1 ? "" : "s"} waiting for the creator`} />
        <Card tone="lime">
          <span className="text-[14px] font-semibold">{me.brand.name}</span>
          <button
            type="button"
            onClick={() =>
              api("/api/credits/topup", { method: "POST" })
                .then(() => (setMsg(`Added ${DEMO_TOPUP.toLocaleString("en-US")} demo credits.`), refresh()))
                .catch((e) => setMsg(reason(e)))
            }
            className={pillClass("ink", "self-start")}
          >
            Top up {DEMO_TOPUP.toLocaleString("en-US")} demo credits (once)
          </button>
        </Card>
      </div>
      {msg && <p role="status" className="m-0 text-[15px] text-wait">{msg}</p>}

      <Card title="Licences" action={<Link href="/creators" className={pillClass("outline", "min-h-10 px-4")}>Find a creator</Link>}>
        {licences.length === 0 && pending.length === 0 && <p className="m-0 text-grey">No licences yet. Request one from a creator&apos;s page.</p>}
        {pending.map((r) => (
          <span key={r.id} className="text-[14px] text-wait">
            Waiting for approval: {useLabel(r.use)}, {r.maxRenders} renders, {r.days} days
          </span>
        ))}
        {licences.map((l) => (
          <LicenceCard
            key={l.id}
            l={l}
            onRendered={async (render) => {
              // A development render (AI_PROVIDER=fixture) is never listed; only the admin view shows it.
              if (!render.fixture) {
                setFresh((f) => [asRow(render, l), ...f]);
                setHighlight(render.id);
              }
              await Promise.all([lists.reload(), renders.reload(), refresh()]);
            }}
            onBlocked={() => void renders.reload()}
          />
        ))}
      </Card>

      <Card title="Your renders">
        {cards.length === 0 && <p className="m-0 text-grey">None yet.</p>}
        {cards.map((c) =>
          c.kind === "blocked" ? (
            <BlockedCard key={c.b.id} b={c.b} mode="brand" />
          ) : (
            <RenderCard
              key={c.r.id}
              ref={(el) => {
                if (el) cardRefs.current.set(c.r.id, el);
              }}
              r={c.r}
              mode="brand"
              highlight={c.r.id === highlight}
            />
          ),
        )}
      </Card>
    </div>
  );
}

type Made = Omit<Render, "creatorName" | "brandName" | "use">;

function LicenceCard({ l, onRendered, onBlocked }: { l: LicenceRow; onRendered: (r: Made) => Promise<void>; onBlocked: () => void }) {
  const [brief, setBrief] = useState("Smiling in a sunlit café holding a ceramic coffee cup, product shot for a spring campaign");
  const [aspect, setAspect] = useState<"1:1" | "16:9" | "9:16">("1:1");
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  // One request id per click: a retried or doubled request returns the first result, never a second charge.
  const [requestId, setRequestId] = useState<string | null>(null);
  const image = async (b = brief, a = aspect) => {
    const id = crypto.randomUUID();
    setRequestId(id);
    setBusy("Rendering: every step appears below as it finishes.");
    setErr(null);
    setOut(null);
    try {
      const r = await api<{ render: Made }>("/api/render/image", { method: "POST", body: JSON.stringify({ licenceId: l.id, brief: b, aspectRatio: a, requestId: id }) });
      setOut(r.render.fixture ? `Test render (development): ${r.render.price} credits paid; kept out of Your renders, listed in the admin view.` : `${a} image ad ready: ${r.render.price} credits paid. It's at the top of Your renders.`);
      await onRendered(r.render);
    } catch (e) {
      setErr(e);
      // An image blocked after it was made is now listed in Your renders.
      onBlocked();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-paper p-3">
      <span className="flex flex-wrap items-center gap-3">
        <StatusBadge status={l.status} />
        <b>{l.creatorName}</b>
        {l.autoApproved && <span className="rounded-full bg-wait-bg px-2.5 py-0.5 text-[12px] font-semibold text-wait">{AUTO_APPROVED_LABEL}</span>}
        <span className="text-grey">
          {useLabel(l.use)} · {l.renderCount}/{l.maxRenders} renders · {l.pricePerImage} credits per image · until {when(l.end)}
        </span>
      </span>
      {l.status === "Active" && (
        <>
          <CreativeAssistant
            licenceId={l.id}
            onDraft={(d) => {
              setBrief(d.brief);
              setAspect(d.aspect);
            }}
          />
          <label className="flex flex-col gap-1 text-[14px]">
            <span className="text-grey">Brief</span>
            <textarea ref={briefRef} value={brief} onChange={(e) => setBrief(e.target.value)} rows={brief.length > 200 ? 6 : 2} maxLength={2000} className={`${inputClass} py-2`} />
          </label>
          <span className="flex flex-wrap items-center gap-2">
            {(["1:1", "16:9", "9:16"] as const).map((a) => (
              <button key={a} type="button" aria-pressed={aspect === a} onClick={() => setAspect(a)} className={pillClass(aspect === a ? "ink" : "outline", "min-h-9 px-3 text-[13px]")}>
                {a}
              </button>
            ))}
            <button type="button" disabled={!!busy} onClick={() => image()} className={pillClass("lime", "min-h-10 px-4")}>
              Make an image ad ({l.pricePerImage} credits)
            </button>
          </span>
        </>
      )}
      {busy && <span className="text-[14px] text-wait">{busy}</span>}
      {requestId && <RenderTimeline requestId={requestId} running={!!busy} />}
      {out && <span className="text-[14px] text-ok">{out}</span>}
      <ErrorNotice error={err} onRetry={() => image()} onEditBrief={() => briefRef.current?.focus()} />
    </div>
  );
}
