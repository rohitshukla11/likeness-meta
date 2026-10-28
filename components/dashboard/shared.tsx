"use client";
import { useCallback, useEffect, useState } from "react";
import { api, reason } from "@/lib/client/firebase";
import type { LicenceDoc, LicenceStatus, RequestDoc } from "@/lib/model";

export type LicenceRow = LicenceDoc & { status: LicenceStatus };
export type Render = {
  id: string;
  licenceId: string;
  brandId: string;
  creatorId: string;
  type: "image" | "video";
  renderIndex: number;
  sha256: string;
  mime: string;
  model: string;
  price: number;
  creatorShare: number;
  fee: number;
  brief: string;
  createdAt: number;
  pipeline?: "veo-3.1-lite" | "ffmpeg-fallback";
  pipelineNote?: string;
  fromRenderId?: string;
  aspect?: "1:1" | "16:9" | "9:16";
  hasPreview?: boolean;
  /** An unlabelled still is kept, so a video ad can animate it (image ads from before Phase 2 have none). */
  hasRaw?: boolean;
  /** Video only: the quality gate (see lib/server/gate.ts), resolution, and how the still was framed. */
  gate?: GateSummary;
  resolution?: "720p" | "1080p";
  framing?: string;
  creatorName: string;
  brandName: string;
  use: string;
};

type GateCheck = { passed: boolean; frames: number; visible: number; matched: number; need: number; threshold: number; medianSimilarity: number | null; minSimilarity: number | null; reason: string };
export type GateSummary = GateCheck & { attempts: GateCheck[]; outcome: string };

export function gateLine(g: GateSummary): string {
  const sim = g.medianSimilarity === null ? "" : `, median match ${g.medianSimilarity.toFixed(2)} (threshold ${g.threshold})`;
  const head = g.outcome === "passed" || g.outcome === "passed on retry" ? `Quality gate ${g.outcome}` : `Quality gate: ${g.outcome}`;
  return `${head}: face fully visible in ${g.visible}/${g.frames} frames, matches the creator in ${g.matched}/${g.frames}${sim}.`;
}

export const pipelineLabel = (r: Pick<Render, "type" | "pipeline" | "model">) =>
  r.type === "image" ? `Gemini (${r.model})` : r.pipeline === "veo-3.1-lite" ? "Veo 3.1 Lite" : "Free fallback motion ad (ffmpeg)";
export type Lists = {
  asCreator: { requests: RequestDoc[]; licences: LicenceRow[] };
  asBrand: { requests: RequestDoc[]; licences: LicenceRow[] };
};

/** Load a JSON endpoint and reload on demand. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!url) return;
    try {
      setData(await api<T>(url));
      setError(null);
    } catch (e) {
      setError(reason(e));
    }
  }, [url]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, reload: load };
}

/** Open a render through a short-lived signed URL. */
export async function openRender(id: string) {
  const r = await api<{ url: string }>(`/api/renders/${id}/url`);
  window.open(r.url, "_blank", "noopener");
}

export const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
