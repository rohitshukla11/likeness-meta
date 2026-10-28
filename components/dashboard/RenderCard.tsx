"use client";
/**
 * One render as a preview card. The bucket stays private: previews and files load through
 * short-lived V4 signed URLs (15 minutes), fetched on demand and re-fetched before or when they expire.
 */
import Link from "next/link";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { pillClass } from "@/components/ds";
import { api, reason } from "@/lib/client/firebase";
import { useLabel } from "@/lib/model";
import { gateLine, pipelineLabel, when, type Render } from "./shared";

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

export const RenderCard = forwardRef<HTMLDivElement, { r: Render; mode: "brand" | "creator"; highlight?: boolean; onMakeVideo?: (r: Render) => void }>(function RenderCard(
  { r, mode, highlight, onMakeVideo },
  ref,
) {
  const preview = useSignedUrl(r.id, "preview");
  const file = useSignedUrl(r.id, "file", r.type === "video");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ratio = r.aspect === "16:9" ? "16 / 9" : r.aspect === "9:16" ? "9 / 16" : r.aspect === "1:1" ? "1 / 1" : undefined;

  const media =
    preview.state === "loading" ? (
      <div className="w-[240px] animate-pulse rounded-[12px] bg-paper" style={{ aspectRatio: ratio ?? "1 / 1" }} aria-label="Loading preview" />
    ) : preview.state === "error" ? (
      <div className="flex w-[240px] items-center justify-center rounded-[12px] bg-paper p-3 text-center text-[13px] text-bad" style={{ aspectRatio: ratio ?? "1 / 1" }}>
        Preview unavailable: {preview.error}
      </div>
    ) : r.type === "video" ? (
      <video
        className="w-[240px] rounded-[12px] bg-ink"
        style={ratio ? { aspectRatio: ratio } : undefined}
        poster={preview.url ?? undefined}
        src={file.url ?? undefined}
        onError={file.onError}
        controls
        muted
        playsInline
        preload="none"
        aria-label={`Video ad for ${r.brandName}`}
      />
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
        {(preview.state === "refreshing" || file.state === "refreshing") && <span className="text-[12px] text-wait">Preview expired, refreshing…</span>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-[14px]">
        <span className="flex flex-wrap items-center gap-2">
          <b>{r.type === "video" ? "Video ad" : "Image ad"}</b>
          <span className="rounded-full bg-ink px-2.5 py-0.5 text-[12px] font-semibold text-lime">AI-generated · licensed likeness</span>
        </span>
        <span className="text-grey">
          {when(r.createdAt)} · {mode === "brand" ? `${r.price} credits` : `you earned ${r.creatorShare} credits`} · {pipelineLabel(r)}
        </span>
        <span className="text-grey">
          {mode === "brand" ? `Creator: ${r.creatorName}` : `Brand: ${r.brandName}`} · {useLabel(r.use)} · licence {r.licenceId.slice(0, 8)}
        </span>
        {r.pipelineNote && r.pipeline === "ffmpeg-fallback" && <span className="text-[13px] text-wait">{r.pipelineNote}</span>}
        {r.gate && (
          <span className={`text-[13px] ${r.gate.outcome.startsWith("passed") ? "text-ok" : "text-wait"}`}>
            {gateLine(r.gate)}
            {r.gate.attempts.length > 1 && ` Veo attempts: ${r.gate.attempts.map((a) => (a.passed ? "passed" : "failed")).join(", ")}.`}
          </span>
        )}
        {r.type === "video" && (r.resolution || r.framing) && <span className="text-[13px] text-grey">{[r.resolution, r.framing].filter(Boolean).join(" · ")}</span>}
        <span className="text-[13px] text-grey">&ldquo;{r.brief.length > 120 ? `${r.brief.slice(0, 117)}…` : r.brief}&rdquo;</span>
        <span className="mt-1 flex flex-wrap gap-2">
          {r.type === "video" && (
            <button type="button" onClick={() => setOpen(true)} className={pillClass("outline", "min-h-9 px-3 text-[13px]")}>
              Larger player
            </button>
          )}
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
          {mode === "brand" && r.type === "image" && r.hasRaw && onMakeVideo && (
            <button type="button" onClick={() => onMakeVideo(r)} className={pillClass("lime", "min-h-9 px-3 text-[13px]")}>
              Make a video from this
            </button>
          )}
        </span>
        {msg && <span className="text-[13px] text-bad">{msg}</span>}
      </div>
      {open && <Lightbox r={r} previewUrl={preview.url} onClose={() => setOpen(false)} />}
    </div>
  );
});

function Lightbox({ r, previewUrl, onClose }: { r: Render; previewUrl: string | null; onClose: () => void }) {
  // The full-size file, signed on demand.
  const full = useSignedUrl(r.id, "file");
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={r.type === "video" ? "Video ad" : "Image ad"} onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-full max-w-full flex-col items-end gap-2">
        <button type="button" onClick={onClose} className={pillClass("white", "min-h-9 px-4 text-[13px]")}>
          Close
        </button>
        {full.state === "loading" ? (
          <span className="text-white">Loading…</span>
        ) : r.type === "video" ? (
          <video src={full.url ?? undefined} poster={previewUrl ?? undefined} onError={full.onError} controls muted playsInline autoPlay className="max-h-[85vh] max-w-[90vw] rounded-[12px] bg-ink" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={full.url ?? previewUrl ?? undefined} onError={full.onError} alt={`Image ad for ${r.brandName}`} className="max-h-[85vh] max-w-[90vw] rounded-[12px]" />
        )}
        {full.state === "refreshing" && <span className="text-[13px] text-white">Preview expired, refreshing…</span>}
      </div>
    </div>
  );
}
