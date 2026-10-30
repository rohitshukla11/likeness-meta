"use client";
import { useCallback, useEffect, useState } from "react";
import { api, reason } from "@/lib/client/firebase";
import type { Aspect } from "@/lib/creative";
import type { LicenceDoc, LicenceStatus, RequestDoc } from "@/lib/model";

export type LicenceRow = LicenceDoc & { status: LicenceStatus };
/** An image that was made but blocked (never delivered, never charged); the image itself was deleted. */
export type BlockedRender = { id: string; licenceId: string; createdAt: number; brief: string; blockedBy: "consent" | "review" | "payment"; code: string | null; explanation: string; creatorName: string; brandName: string; use: string };

export type Render = {
  id: string;
  licenceId: string;
  brandId: string;
  creatorId: string;
  type: "image";
  renderIndex: number;
  sha256: string;
  mime: string;
  model: string;
  price: number;
  creatorShare: number;
  fee: number;
  brief: string;
  createdAt: number;
  aspect?: Aspect;
  hasPreview?: boolean;
  /** The consent gate's result (lib/server/consentGate.ts). */
  consent?: { code: string | null; explanation: string; segmenter: string | null };
  /** The output reviewer (skipped with AI_PROVIDER=google); "flag" means delivered with a warning. */
  review?: { verdict: "pass" | "flag" | "block"; reasons: string[]; skipped: boolean };
  /** Estimated model cost of this render (shown unless SHOW_MODEL_COST=0); an estimate, not a bill. */
  cost?: { costUsd: number; complete: boolean };
  creatorName: string;
  brandName: string;
  use: string;
  /** A development render (AI_PROVIDER=fixture): never listed for the brand or creator. */
  fixture?: true;
  /** The flagged render this one is the brand's alternative to. */
  alternativeOf?: string;
  /** On a flagged render: the alternative already asked for (one at most). */
  alternativeId?: string;
};

export const pipelineLabel = (r: Pick<Render, "model">) => `Gemini (${r.model})`;
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
