"use client";
/**
 * The render step log as a timeline (lib/server/renderLog.ts): each step's result, how long it took,
 * the model and its estimated cost, and the reason code when something was refused or blocked. Polls
 * every second while the render runs (requestId); a past render (renderId) is read once from the stored log,
 * and a blocked one ends with the same error card the brand saw, built from its stored reason code.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/firebase";
import { blockedSentence } from "@/lib/reasons";
import { ErrorNotice } from "./ErrorNotice";
import { ConsentFigure, type Figure } from "./ConsentFigure";

type Step = { step: string; attempt?: 2; figure?: Figure; status: "ok" | "refused" | "blocked" | "flagged" | "skipped" | "error"; ms: number; detail: string; code?: string; model?: string; costUsd?: number | null; settings?: Record<string, string | number> };
type Log = { status: "running" | "delivered" | "refused" | "blocked" | "error"; outcome: string | null; steps: Step[]; provider: string };

const LABEL: Record<string, string> = {
  licence: "Licence check",
  plan: "Brand agent plan",
  policy: "Policy check",
  frames: "Creator's reference photos",
  generate: "Image generation",
  consent: "Consent gate",
  review: "Output review",
  alternative: "Alternative shot",
  label: "AI-generated label",
  credential: "Content credential (C2PA)",
  payment: "Receipt and payment",
};
const TONE: Record<Step["status"], string> = { ok: "text-ok", refused: "text-bad", blocked: "text-bad", error: "text-bad", flagged: "text-wait", skipped: "text-grey" };
const MARK: Record<Step["status"], string> = { ok: "✓", refused: "✕", blocked: "✕", error: "!", flagged: "⚑", skipped: "–" };

type Blocked = { blockedBy: "consent" | "review" | "payment"; code: string | null; explanation: string };

/** The error card for a blocked render, from its stored record. */
export const blockedError = (b: Blocked) => new ApiError(422, blockedSentence(b.blockedBy, b.explanation), b.code, null);

export function RenderTimeline({ requestId, renderId, running = false, blockedCard = true }: { requestId?: string; renderId?: string; running?: boolean; blockedCard?: boolean }) {
  const [log, setLog] = useState<Log | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const query = requestId ? `requestId=${encodeURIComponent(requestId)}` : `renderId=${encodeURIComponent(renderId ?? "")}`;
    const load = async () => {
      try {
        const r = await api<{ log: Log | null; blocked?: Blocked | null }>(`/api/render/log?${query}`);
        if (live) {
          setLog(r.log);
          setBlocked(r.blocked ?? null);
        }
        if (live && requestId && (running || !r.log || r.log.status === "running")) timer = setTimeout(load, 1000);
      } catch {
        if (live && running) timer = setTimeout(load, 2000);
        else if (live && renderId) setMissing(true);
      }
    };
    void load();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [requestId, renderId, running]);

  if (missing) return <span className="text-[13px] text-grey">No step log was kept for this render (made before step logs existed).</span>;
  // A live request refused before any step (e.g. an unavailable shape) has no log: nothing to show once it ends.
  if (!log) return running ? <span className="text-[13px] text-grey">Starting…</span> : renderId ? <span className="text-[13px] text-grey">Loading the steps…</span> : null;
  const total = log.steps.reduce((s, x) => s + (x.costUsd ?? 0), 0);
  const list = (
    <ol className="m-0 flex list-none flex-col gap-1 rounded-[12px] border border-divider bg-white p-3 text-[13px]" aria-label="Render steps" aria-live="polite">
      {log.steps.map((s, i) => (
        <li key={i} className="flex flex-col">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <b className={TONE[s.status]} aria-hidden="true">
              {MARK[s.status]}
            </b>
            <b>
              {LABEL[s.step] ?? s.step}
              {s.attempt === 2 ? " (alternative)" : ""}
            </b>
            {s.code && <span className={`font-semibold ${TONE[s.status]}`}>{s.code}</span>}
            <span className="text-grey">
              {(s.ms / 1000).toFixed(1)} s{s.model ? ` · ${s.model}` : ""}
              {typeof s.costUsd === "number" && s.costUsd > 0 ? ` · est. $${s.costUsd.toFixed(4)}` : ""}
              {s.settings?.reasoning_strength ? ` · reasoning ${s.settings.reasoning_strength}` : ""}
            </span>
          </span>
          <span className="text-grey">{s.detail}</span>
          {s.step === "consent" && s.figure && <ConsentFigure f={s.figure} />}
        </li>
      ))}
      {log.status === "running" && <li className="text-wait">Working…</li>}
      {log.status !== "running" && (
        <li className={log.status === "delivered" ? "text-ok" : "text-bad"}>
          {log.outcome}
          {total > 0 ? ` Model cost: about $${total.toFixed(4)} (an estimate from published prices, not a bill).` : ""}
        </li>
      )}
    </ol>
  );
  return renderId && blockedCard && blocked ? (
    <div className="flex flex-col gap-2">
      {list}
      <ErrorNotice error={blockedError(blocked)} uncharged actions={false} />
    </div>
  ) : (
    list
  );
}
