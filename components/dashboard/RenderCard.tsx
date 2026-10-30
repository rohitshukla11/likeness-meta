"use client";
/**
 * One render as a preview card. The bucket stays private: previews and files load through
 * short-lived V4 signed URLs (15 minutes), fetched on demand and re-fetched before or when they expire.
 * "Steps" reopens the render's stored step log and consent figure (brand and creator in it only).
 * BlockedCard: an image that was made but blocked, with the same error card the brand saw (from its stored
 * reason code); text only, the image was deleted.
 */
import Link from "next/link";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { pillClass } from "@/components/ds";
import { api, reason } from "@/lib/client/firebase";
import { useLabel } from "@/lib/model";
import { ErrorNotice } from "./ErrorNotice";
import { blockedError, RenderTimeline } from "./RenderTimeline";
import { pipelineLabel, when, type BlockedRender, type Render } from "./shared";

type Signed = { url: string | null; mime: string | null; expiresAt?: number };

/** A signed URL for one variant of a render, refreshed a minute before it expires or on a load error. */
function useSignedUrl(id: string, variant: "preview" | "file", enabled = true) {
  const [s, setS] = useState<Signed | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "refreshing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(
    async (why: "first" | "expired") => {
      if (why === "expired") setState("refreshing");
      try {
        const r = await api<Signed>(`/api/renders/${id}/url${variant === "preview" ? "?variant=preview" : ""}`);
        setS(r);
        setState("ready");
        if (timer.current) clearTimeout(timer.current);
        if (r.expiresAt) timer.current = setTimeout(() => void load("expired"), Math.max(10_000, r.expiresAt - Date.now() - 60_000));
      } catch (e) {
        setError(reason(e));
        setState("error");
      }
    },
    [id, variant],
  );
  useEffect(() => {
    if (enabled) void load("first");
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, load]);
  return { url: s?.url ?? null, state, error, onError: () => void load("expired") };
}

export const RenderCard = forwardRef<HTMLDivElement, { r: Render; mode: "brand" | "creator"; highlight?: boolean; onChanged?: () => Promise<void> | void }>(function RenderCard(
  { r, mode, highlight, onChanged },
  ref,
) {
  const preview = useSignedUrl(r.id, "preview");
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [alt, setAlt] = useState<{ busy: boolean; done: string | null; err: unknown }>({ busy: false, done: null, err: null });
  // One alternative per flagged image, at the brand's choice: a new render, charged as one.
  const canAskAlternative = mode === "brand" && r.review?.verdict === "flag" && !r.alternativeOf && !r.alternativeId && !alt.done;
  const askAlternative = async () => {
    setAlt({ busy: true, done: null, err: null });
    try {
      const x = await api<{ render: { price: number } }>("/api/render/alternative", { method: "POST", body: JSON.stringify({ renderId: r.id, requestId: crypto.randomUUID() }) });
      setAlt({ busy: false, done: `Alternative ready: ${x.render.price} credits paid. It's at the top of Your renders.`, err: null });
      await onChanged?.();
    } catch (e) {
      setAlt({ busy: false, done: null, err: e });
    }
  };
  const ratio = r.aspect ? r.aspect.replace(":", " / ") : undefined;

  const media =
    preview.state === "loading" ? (
      <div className="w-[240px] animate-pulse rounded-[12px] bg-paper" style={{ aspectRatio: ratio ?? "1 / 1" }} aria-label="Loading preview" />
    ) : preview.state === "error" ? (
      <div className="flex w-[240px] items-center justify-center rounded-[12px] bg-paper p-3 text-center text-[13px] text-bad" style={{ aspectRatio: ratio ?? "1 / 1" }}>
        Preview unavailable: {preview.error}
      </div>
    ) : (
      <button type="button" onClick={() => setOpen(true)} className="block rounded-[12px] p-0" aria-label="Enlarge image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.url ?? undefined} onError={preview.onError} alt={`Image ad for ${r.brandName}`} className="w-[240px] rounded-[12px]" style={ratio ? { aspectRatio: ratio, objectFit: "cover" } : undefined} />
      </button>
    );

  return (
    <div ref={ref} className={`flex flex-col gap-2 rounded-[16px] bg-paper p-3 sm:flex-row ${highlight ? "ring-2 ring-lime" : ""}`}>
      <div className="flex flex-col gap-1">
        {media}
        {preview.state === "refreshing" && <span className="text-[12px] text-wait">Preview expired, refreshing…</span>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-[14px]">
        <span className="flex flex-wrap items-center gap-2">
          <b>Image ad</b>
          <span className="rounded-full bg-ink px-2.5 py-0.5 text-[12px] font-semibold text-lime">AI-generated · licensed likeness</span>
        </span>
        <span className="text-grey">
          {when(r.createdAt)} · {mode === "brand" ? `${r.price} credits` : `you earned ${r.creatorShare} credits`} · {pipelineLabel(r)}
        </span>
        <span className="text-grey">
          {mode === "brand" ? `Creator: ${r.creatorName}` : `Brand: ${r.brandName}`} · {useLabel(r.use)} · licence {r.licenceId.slice(0, 8)}
        </span>
        {r.consent && <span className="text-[13px] text-ok">Consent check passed: {r.consent.explanation}</span>}
        {r.cost && mode === "brand" && (
          <span className="text-[13px] text-grey">
            Model cost: about ${r.cost.costUsd.toFixed(4)} (estimate{r.cost.complete ? "" : "; some calls have no published price"})
          </span>
        )}
        {r.review?.verdict === "flag" && <span className="text-[13px] text-wait">Flagged by the output review: {r.review.reasons.join(" ")}</span>}
        {r.alternativeOf && <span className="text-[13px] text-grey">The alternative to a flagged image.</span>}
        {mode === "brand" && r.review?.verdict === "flag" && r.alternativeId && !alt.done && <span className="text-[13px] text-grey">An alternative was asked for.</span>}
        <span className="text-[13px] text-grey">&ldquo;{r.brief.length > 120 ? `${r.brief.slice(0, 117)}…` : r.brief}&rdquo;</span>
        <span className="mt-1 flex flex-wrap gap-2">
          {mode === "brand" && (
            <button
              type="button"
              onClick={() =>
                api<{ url: string }>(`/api/renders/${r.id}/url`)
                  .then((x) => window.open(x.url, "_blank", "noopener"))
                  .catch((e) => setMsg(reason(e)))
              }
              className={pillClass("outline", "min-h-9 px-3 text-[13px]")}
            >
              Download
            </button>
          )}
          {mode === "brand" && (
            <Link href={`/verify?sha=${r.sha256}`} className={pillClass("outline", "min-h-9 px-3 text-[13px]")}>
              Verify
            </Link>
          )}
          {canAskAlternative && (
            <button type="button" disabled={alt.busy} onClick={askAlternative} className={pillClass("lime", "min-h-9 px-3 text-[13px]")}>
              {alt.busy ? "Making the alternative…" : `Ask for an alternative (${r.price} credits)`}
            </button>
          )}
          <StepsButton open={steps} onClick={() => setSteps((v) => !v)} />
        </span>
        {alt.done && <span className="text-[13px] text-ok">{alt.done}</span>}
        <ErrorNotice error={alt.err} />
        {steps && <RenderTimeline renderId={r.id} />}
        {msg && <span className="text-[13px] text-bad">{msg}</span>}
      </div>
      {open && <Lightbox r={r} previewUrl={preview.url} onClose={() => setOpen(false)} />}
    </div>
  );
});

function StepsButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-expanded={open} onClick={onClick} className={pillClass("outline", "min-h-9 px-3 text-[13px]")}>
      {open ? "Hide steps" : "Steps and consent check"}
    </button>
  );
}

/** An image that was made but blocked by the consent gate, the reviewer or the payment step: never delivered, never charged. */
export function BlockedCard({ b, mode }: { b: BlockedRender; mode: "brand" | "creator" }) {
  const [steps, setSteps] = useState(false);
  return (
    <div className="flex flex-col gap-1 rounded-[16px] bg-paper p-3 text-[14px]">
      <span className="flex flex-wrap items-center gap-2">
        <b>Image blocked</b>
        <span className="rounded-full bg-bad-bg px-2.5 py-0.5 text-[12px] font-semibold text-bad">{b.code ?? "blocked"}</span>
      </span>
      <span className="text-grey">
        {when(b.createdAt)} · not delivered · {mode === "brand" ? `Creator: ${b.creatorName}` : `Brand: ${b.brandName}`} · {useLabel(b.use)} · licence {b.licenceId.slice(0, 8)}
      </span>
      <ErrorNotice error={blockedError(b)} uncharged actions={false} />
      <span className="text-[13px] text-grey">&ldquo;{b.brief.length > 120 ? `${b.brief.slice(0, 117)}…` : b.brief}&rdquo;</span>
      <span className="mt-1 flex flex-wrap gap-2">
        <StepsButton open={steps} onClick={() => setSteps((v) => !v)} />
      </span>
      {steps && <RenderTimeline renderId={b.id} blockedCard={false} />}
    </div>
  );
}

function Lightbox({ r, previewUrl, onClose }: { r: Render; previewUrl: string | null; onClose: () => void }) {
  // The full-size file, signed on demand.
  const full = useSignedUrl(r.id, "file");
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Image ad" onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-full max-w-full flex-col items-end gap-2">
        <button type="button" onClick={onClose} className={pillClass("white", "min-h-9 px-4 text-[13px]")}>
          Close
        </button>
        {full.state === "loading" ? (
          <span className="text-white">Loading…</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={full.url ?? previewUrl ?? undefined} onError={full.onError} alt={`Image ad for ${r.brandName}`} className="max-h-[85vh] max-w-[90vw] rounded-[12px]" />
        )}
        {full.state === "refreshing" && <span className="text-[13px] text-white">Preview expired, refreshing…</span>}
      </div>
    </div>
  );
}
