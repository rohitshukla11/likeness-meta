"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Card, StatCard, pillClass } from "@/components/ds";
import { StatusBadge, inputClass } from "@/components/ui";
import type { Me } from "@/components/auth/AuthProvider";
import { api, reason } from "@/lib/client/firebase";
import { AUTO_APPROVED_LABEL, credits, DEMO_TOPUP, useLabel } from "@/lib/model";
import { CreativeAssistant } from "./CreativeAssistant";
import { RenderCard } from "./RenderCard";
import { useApi, when, type LicenceRow, type Lists, type Render } from "./shared";

/** What a render endpoint returns, turned into a list row using the licence's names. */
const asRow = (render: Omit<Render, "creatorName" | "brandName" | "use">, l: LicenceRow): Render => ({ ...render, creatorName: l.creatorName, brandName: l.brandName, use: l.use });

export function BrandDashboard({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const lists = useApi<Lists>("/api/licences");
  const renders = useApi<{ asBrand: Render[] }>("/api/renders");
  const [msg, setMsg] = useState<string | null>(null);
  // Renders made in this session go on top at once; the list then reloads in the background.
  const [fresh, setFresh] = useState<Render[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [videoFrom, setVideoFrom] = useState<{ licenceId: string; renderId: string } | null>(null);
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
            stills={allRenders.filter((r) => r.licenceId === l.id && r.type === "image" && r.hasRaw)}
            videoFrom={videoFrom?.licenceId === l.id ? videoFrom.renderId : null}
            onRendered={async (render) => {
              setFresh((f) => [asRow(render, l), ...f]);
              setHighlight(render.id);
              await Promise.all([lists.reload(), renders.reload(), refresh()]);
            }}
          />
        ))}
      </Card>

      <Card title="Your renders">
        {allRenders.length === 0 && <p className="m-0 text-grey">None yet.</p>}
        {allRenders.map((r) => (
          <RenderCard
            key={r.id}
            ref={(el) => {
              if (el) cardRefs.current.set(r.id, el);
            }}
            r={r}
            mode="brand"
            highlight={r.id === highlight}
            onMakeVideo={(x) => {
              setVideoFrom({ licenceId: x.licenceId, renderId: x.id });
              document.getElementById(`video-${x.licenceId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />
        ))}
      </Card>
    </div>
  );
}

type Made = Omit<Render, "creatorName" | "brandName" | "use">;
type VideoAspect = "16:9" | "9:16";

function LicenceCard({ l, stills, videoFrom, onRendered }: { l: LicenceRow; stills: Render[]; videoFrom: string | null; onRendered: (r: Made) => Promise<void> }) {
  const [brief, setBrief] = useState("Smiling in a sunlit café holding a ceramic coffee cup, product shot for a spring campaign");
  const [aspect, setAspect] = useState<"1:1" | "16:9" | "9:16">("1:1");
  const [motion, setMotion] = useState("The person lifts the cup toward the camera and smiles, gentle push-in, warm café light");
  const [videoAspect, setVideoAspect] = useState<VideoAspect>("16:9");
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const image = async (b = brief, a = aspect): Promise<Made | null> => {
    setBusy("Checking the brief, opening the photos for this render, generating with Gemini, signing…");
    setErr(null);
    setOut(null);
    try {
      const r = await api<{ render: Made }>("/api/render/image", { method: "POST", body: JSON.stringify({ licenceId: l.id, brief: b, aspectRatio: a }) });
      setOut(`${a} image ad ready: ${r.render.price} credits paid. It's at the top of Your renders.`);
      await onRendered(r.render);
      return r.render;
    } catch (e) {
      setErr(reason(e));
      return null;
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
          {useLabel(l.use)} · {l.renderCount}/{l.maxRenders} renders · {l.videoAllowed ? `${l.videoCount ?? 0}/${l.maxVideos} videos` : "no video"} · image {l.pricePerImage} · video {l.pricePerVideo} credits · until {when(l.end)}
        </span>
      </span>
      {l.status === "Active" && (
        <>
          <CreativeAssistant
            licenceId={l.id}
            onDraft={(d) => {
              setBrief(d.brief);
              setAspect(d.aspect);
              if (d.motion) setMotion(d.motion);
              if (d.format === "video" && d.aspect !== "1:1") setVideoAspect(d.aspect);
            }}
          />
          <label className="flex flex-col gap-1 text-[14px]">
            <span className="text-grey">Brief</span>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={brief.length > 200 ? 6 : 2} maxLength={2000} className={`${inputClass} py-2`} />
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
      {l.status === "Active" && l.videoAllowed && (
        <VideoMaker
          l={l}
          stills={stills}
          preselect={videoFrom}
          prompt={motion}
          setPrompt={setMotion}
          aspect={videoAspect}
          setAspect={setVideoAspect}
          makeStill={(from) => image(from.brief, videoAspect)}
          stillBusy={!!busy}
          onRendered={onRendered}
        />
      )}
      {busy && <span className="text-[14px] text-wait">{busy}</span>}
      {out && <span className="text-[14px] text-ok">{out}</span>}
      {err && <span role="alert" className="text-[14px] text-bad">{err}</span>}
    </div>
  );
}

function VideoMaker(props: {
  l: LicenceRow;
  stills: Render[];
  preselect: string | null;
  prompt: string;
  setPrompt: (p: string) => void;
  aspect: VideoAspect;
  setAspect: (a: VideoAspect) => void;
  makeStill: (from: Render) => Promise<Made | null>;
  stillBusy: boolean;
  onRendered: (r: Made) => Promise<void>;
}) {
  const { l, stills, preselect, prompt, setPrompt, aspect, setAspect, makeStill, stillBusy, onRendered } = props;
  const [from, setFrom] = useState("");
  useEffect(() => {
    if (!preselect) return;
    setFrom(preselect);
    // A video uses the still's own aspect when it has one a video can use.
    const a = stills.find((r) => r.id === preselect)?.aspect;
    if (a === "16:9" || a === "9:16") setAspect(a);
  }, [preselect]); // eslint-disable-line react-hooks/exhaustive-deps
  const [seconds, setSeconds] = useState<6 | 8>(6);
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const left = l.maxVideos - (l.videoCount ?? 0);
  if (stills.length === 0) return <span className="text-[14px] text-grey">Make an image ad first: a video ad animates one of your licensed images (make it in 16:9 or 9:16 to match the video).</span>;
  const chosen = stills.find((r) => r.id === from) ?? stills.find((r) => r.aspect === aspect) ?? stills[0];
  const matches = (chosen.aspect ?? "1:1") === aspect;
  const price = resolution === "1080p" ? l.pricePerVideo * 2 : l.pricePerVideo;
  const secs = resolution === "1080p" ? 8 : seconds;
  const go = async () => {
    setBusy(true);
    setErr(null);
    setOut(null);
    try {
      const r = await api<{ render: Made; pipeline: string; note: string }>("/api/render/video", {
        method: "POST",
        body: JSON.stringify({ licenceId: l.id, fromRenderId: chosen.id, prompt, seconds: secs, aspectRatio: aspect, resolution }),
      });
      setOut(r.pipeline === "veo-3.1-lite" ? `Video ad ready (Veo 3.1 Lite, quality gate passed): ${r.render.price} credits paid. It's at the top of Your renders.` : `${r.note} You got the free fallback motion ad instead.`);
      await onRendered(r.render);
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy(false);
    }
  };
  const chip = (on: boolean) => pillClass(on ? "ink" : "outline", "min-h-9 px-3 text-[13px]");
  return (
    <div id={`video-${l.id}`} className="mt-1 flex flex-col gap-2 border-t border-divider pt-2">
      <b className="text-[14px]">Video ad (Veo 3.1 Lite) · {left > 0 ? `${left} left on this licence` : "limit reached"}</b>
      <label className="flex flex-col gap-1 text-[14px]">
        <span className="text-grey">Animate this licensed image</span>
        <select value={chosen.id} onChange={(e) => setFrom(e.target.value)} className={inputClass}>
          {stills.map((r) => (
            <option key={r.id} value={r.id}>
              {r.aspect ?? "1:1"} image ad from {when(r.createdAt)}: {r.brief.slice(0, 50)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        <span className="text-grey">Motion (what happens in the video). Framing rules are added for you: the full face stays in frame.</span>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={prompt.length > 160 ? 4 : 2} maxLength={1000} className={`${inputClass} py-2`} />
      </label>
      <span className="flex flex-wrap items-center gap-2">
        {(["16:9", "9:16"] as const).map((a) => (
          <button key={a} type="button" aria-pressed={aspect === a} onClick={() => setAspect(a)} className={chip(aspect === a)}>
            {a}
          </button>
        ))}
        {(["720p", "1080p"] as const).map((r) => (
          <button key={r} type="button" aria-pressed={resolution === r} onClick={() => setResolution(r)} className={chip(resolution === r)}>
            {r} · {r === "1080p" ? l.pricePerVideo * 2 : l.pricePerVideo} credits
          </button>
        ))}
        {([6, 8] as const).map((n) => (
          <button key={n} type="button" aria-pressed={secs === n} disabled={resolution === "1080p" && n === 6} title={resolution === "1080p" && n === 6 ? "1080p is 8 seconds only" : undefined} onClick={() => setSeconds(n)} className={chip(secs === n)}>
            {n} s
          </button>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {matches ? (
          <button type="button" disabled={busy || left <= 0} onClick={go} className={pillClass("lime", "min-h-10 px-4")}>
            Make a {aspect} video ad ({price} credits)
          </button>
        ) : (
          <>
            <span className="text-[14px] text-wait">This image is {chosen.aspect ?? "1:1"}; a {aspect} video needs a {aspect} still, so the face isn&apos;t cropped.</span>
            <button
              type="button"
              disabled={stillBusy}
              onClick={async () => {
                const made = await makeStill(chosen);
                if (made) setFrom(made.id);
              }}
              className={pillClass("lime", "min-h-10 px-4")}
            >
              Create a {aspect} still first ({l.pricePerImage} credits)
            </button>
          </>
        )}
      </span>
      {busy && <span className="text-[14px] text-wait">Generating with Veo 3.1 Lite (about a minute), checking the face in the frames (a retry if needed), then labelling, signing and paying…</span>}
      {out && <span className="text-[14px] text-ok">{out}</span>}
      {err && <span role="alert" className="text-[14px] text-bad">{err}</span>}
    </div>
  );
}
