import "server-only";
/**
 * The admin view's data: every render's step log (latency and estimated cost per step), totals per day
 * and per provider, and blocked renders with their reasons. The only place development (fixture) renders are listed. Admins are listed in ADMIN_UIDS (user ids)
 * or ADMIN_EMAILS (verified emails only), comma-separated; nobody is an admin by default.
 */
import type { Caller } from "./authn";
import { firestore } from "./firebase-admin";
import { HttpError } from "./http";
import { judgeRegistryCached } from "./demo";
import { blockedReason, isFixtureRecord, type BlockedRenderDoc } from "./render-image";
import type { RenderLogDoc } from "./renderLog";

const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

export function isAdmin(c: Pick<Caller, "uid" | "email" | "emailVerified">): boolean {
  if (list(process.env.ADMIN_UIDS).includes(c.uid.toLowerCase())) return true;
  return !!c.email && c.emailVerified && list(process.env.ADMIN_EMAILS).includes(c.email.toLowerCase());
}

export function requireAdmin(c: Caller) {
  if (!isAdmin(c)) throw new HttpError(403, "admins only");
}

export type DayTotals = { key: string; renders: number; delivered: number; blocked: number; refused: number; error: number; costUsd: number; avgLatencyMs: number | null };

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const logCost = (l: Pick<RenderLogDoc, "steps">) => l.steps.reduce((s, x) => s + (typeof x.costUsd === "number" ? x.costUsd : 0), 0);

/** Totals per day and per provider from step logs: counts by outcome, estimated cost, mean latency of finished renders. Pure. */
export function summarise(logs: Pick<RenderLogDoc, "provider" | "status" | "startedAt" | "finishedAt" | "steps">[]): { byDay: DayTotals[]; byProvider: DayTotals[]; total: DayTotals } {
  const group = (keyOf: (l: (typeof logs)[number]) => string) => {
    const m = new Map<string, { t: DayTotals; latencies: number[] }>();
    for (const l of logs) {
      const k = keyOf(l);
      const g = m.get(k) ?? { t: { key: k, renders: 0, delivered: 0, blocked: 0, refused: 0, error: 0, costUsd: 0, avgLatencyMs: null }, latencies: [] };
      g.t.renders++;
      if (l.status === "delivered" || l.status === "blocked" || l.status === "refused" || l.status === "error") g.t[l.status]++;
      g.t.costUsd += logCost(l);
      if (l.finishedAt) g.latencies.push(l.finishedAt - l.startedAt);
      m.set(k, g);
    }
    return [...m.values()].map(({ t, latencies }) => ({ ...t, costUsd: Math.round(t.costUsd * 1e6) / 1e6, avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null }));
  };
  const byDay = group((l) => day(l.startedAt)).sort((a, b) => b.key.localeCompare(a.key));
  const byProvider = group((l) => l.provider).sort((a, b) => a.key.localeCompare(b.key));
  const [total] = group(() => "all");
  return { byDay, byProvider, total: total ?? { key: "all", renders: 0, delivered: 0, blocked: 0, refused: 0, error: 0, costUsd: 0, avgLatencyMs: null } };
}

export const PROVIDERS = ["meta", "google", "fixture"] as const;
export type ProviderFilter = (typeof PROVIDERS)[number] | null;
/** ?provider=meta|google|fixture, or null for all. */
export const parseProvider = (v: string | null): ProviderFilter => (PROVIDERS as readonly string[]).includes(v ?? "") ? (v as ProviderFilter) : null;

/** A blocked render's provider: its step log's, else from the model it used (older records). Pure. */
export function blockedProvider(b: Pick<BlockedRenderDoc, "model" | "fixture">, logProvider: string | undefined): string {
  if (logProvider) return logProvider;
  if (isFixtureRecord(b)) return "fixture";
  return b.model.startsWith("muse") ? "meta" : b.model.startsWith("gemini") ? "google" : "unknown";
}

export async function adminOverview(days: number, provider: ProviderFilter = null) {
  const since = Date.now() - days * 86_400_000;
  const db = firestore();
  const [logs, blocked, judges] = await Promise.all([
    db.collection("renderLogs").where("startedAt", ">=", since).orderBy("startedAt", "desc").limit(500).get(),
    db.collection("blockedRenders").where("createdAt", ">=", since).orderBy("createdAt", "desc").limit(100).get(),
    judgeRegistryCached(),
  ]);
  const isEval = (brandId: string, flag?: true) => !!flag || brandId === judges?.evalBrandUid;
  const every = logs.docs.map((d) => d.data() as RenderLogDoc);
  const providerById = new Map(every.map((l) => [l.id, l.provider]));
  // Totals and both lists for one provider, or for all.
  const all = provider ? every.filter((l) => l.provider === provider) : every;
  const blockedDocs = blocked.docs.map((d) => d.data() as BlockedRenderDoc).map((b) => ({ b, provider: blockedProvider(b, providerById.get(b.id)) })).filter((x) => !provider || x.provider === provider);
  return {
    days,
    provider,
    note: "Costs are estimates from the published prices (lib/server/ai/pricing.ts), not the bill. Gemini calls have no pinned price.",
    totals: summarise(all),
    renders: all.slice(0, 100).map((l) => ({
      id: l.id,
      brandId: l.brandId,
      licenceId: l.licenceId,
      provider: l.provider,
      fixture: l.provider === "fixture",
      evalRun: isEval(l.brandId),
      status: l.status,
      startedAt: l.startedAt,
      latencyMs: l.finishedAt ? l.finishedAt - l.startedAt : null,
      costUsd: Math.round(logCost(l) * 1e6) / 1e6,
      outcome: l.outcome,
      steps: l.steps.map(({ step, status, ms, costUsd, model, code, attempt, settings }) => ({ step, status, ms, costUsd: costUsd ?? null, model: model ?? null, code: code ?? null, attempt: attempt ?? 1, settings: settings ?? null })),
    })),
    blocked: blockedDocs.map(({ b, provider }) => {
      return { id: b.id, createdAt: b.createdAt, brandId: b.brandId, licenceId: b.licenceId, blockedBy: b.blockedBy ?? "consent", ...blockedReason(b), model: b.model, provider, fixture: isFixtureRecord(b), evalRun: isEval(b.brandId, b.evalRun), costUsd: b.cost?.costUsd ?? null, costComplete: b.cost?.complete ?? false };
    }),
  };
}
