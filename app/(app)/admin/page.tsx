"use client";
/**
 * Admins only: each render's steps (latency, estimated cost), totals per day and per provider, and blocked renders with reasons.
 * The only view that lists development (fixture) renders; eval-brand renders are marked here and hidden from the creator.
 * Any render, delivered or blocked, reopens its step log and consent figure.
 */
import { useEffect, useState } from "react";
import { AppPage, Card, pillClass } from "@/components/ds";
import { useAuth } from "@/components/auth/AuthProvider";
import { ErrorNotice } from "@/components/dashboard/ErrorNotice";
import { RenderTimeline } from "@/components/dashboard/RenderTimeline";
import { api } from "@/lib/client/firebase";

type Totals = { key: string; renders: number; delivered: number; blocked: number; refused: number; error: number; costUsd: number; avgLatencyMs: number | null };
type Step = { step: string; status: string; ms: number; costUsd: number | null; model: string | null; code: string | null; attempt: number };
type Overview = {
  days: number;
  note: string;
  totals: { byDay: Totals[]; byProvider: Totals[]; total: Totals };
  renders: { id: string; brandId: string; provider: string; fixture: boolean; evalRun: boolean; status: string; startedAt: number; latencyMs: number | null; costUsd: number; outcome: string | null; steps: Step[] }[];
  blocked: { id: string; createdAt: number; brandId: string; blockedBy: string; code: string | null; explanation: string; model: string; fixture: boolean; evalRun: boolean; costUsd: number | null; costComplete: boolean }[];
};

const usd = (n: number | null) => (n === null ? "—" : `$${n.toFixed(4)}`);
const secs = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`);
const when = (t: number) => new Date(t).toISOString().replace("T", " ").slice(0, 16);
const th = "border-b border-divider px-2 py-1 text-left font-semibold";
const td = "border-b border-divider px-2 py-1 align-top";

const DevBadge = () => <span className="rounded-full bg-wait-bg px-2 py-0.5 text-[12px] font-semibold text-wait">Test render (development)</span>;
const EvalBadge = () => <span className="rounded-full bg-wait-bg px-2 py-0.5 text-[12px] font-semibold text-wait">Evaluation run (automated test)</span>;

/** Reopen one render's stored step log and consent figure. */
function Reopen({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="flex flex-col gap-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={pillClass("outline", "min-h-8 self-start px-3 text-[12px]")}>
        {open ? "Hide steps" : "Steps and consent figure"}
      </button>
      {open && <RenderTimeline renderId={id} />}
    </span>
  );
}

function TotalsTable({ rows, label }: { rows: Totals[]; label: string }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          {[label, "Renders", "Delivered", "Blocked", "Refused", "Errors", "Est. cost", "Mean latency"].map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className={td}>{r.key}</td>
            <td className={td}>{r.renders}</td>
            <td className={td}>{r.delivered}</td>
            <td className={td}>{r.blocked}</td>
            <td className={td}>{r.refused}</td>
            <td className={td}>{r.error}</td>
            <td className={td}>{usd(r.costUsd)}</td>
            <td className={td}>{secs(r.avgLatencyMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminPage() {
  const { me, loading } = useAuth();
  const [days, setDays] = useState(7);
  const [provider, setProvider] = useState<"all" | "meta" | "google" | "fixture">("all");
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (!me?.admin) return;
    setErr(null);
    api<Overview>(`/api/admin/overview?days=${days}${provider === "all" ? "" : `&provider=${provider}`}`).then(setData, setErr);
  }, [me?.admin, days, provider]);

  if (loading) return <AppPage title="Admin">Loading…</AppPage>;
  if (!me?.admin)
    return (
      <AppPage title="Admin" description="Admins only.">
        <p className="m-0 text-grey">This account isn&apos;t an admin. Admins are listed in ADMIN_UIDS or ADMIN_EMAILS on the server.</p>
      </AppPage>
    );
  return (
    <AppPage title="Admin" description="Latency and estimated model cost per render and per step; blocked renders count, with their reasons.">
      <span className="flex flex-wrap gap-2">
        {[1, 7, 30].map((d) => (
          <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={pillClass(days === d ? "ink" : "outline", "min-h-9 px-3 text-[13px]")}>
            Last {d} day{d === 1 ? "" : "s"}
          </button>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Provider">
        <span className="text-[13px] text-grey">Provider:</span>
        {(["all", "meta", "google", "fixture"] as const).map((p) => (
          <button key={p} type="button" aria-pressed={provider === p} onClick={() => setProvider(p)} className={pillClass(provider === p ? "ink" : "outline", "min-h-9 px-3 text-[13px]")}>
            {p === "all" ? "All" : p === "fixture" ? "fixture (development)" : p}
          </button>
        ))}
      </span>
      <ErrorNotice error={err} onRetry={() => setDays((d) => d)} />
      {data && (
        <>
          <p className="m-0 text-[13px] text-grey">{data.note}</p>
          <Card title={`Totals: ${data.totals.total.renders} renders, ${usd(data.totals.total.costUsd)} estimated`}>
            <TotalsTable rows={data.totals.byDay} label="Day (UTC)" />
            <TotalsTable rows={data.totals.byProvider} label="Provider" />
          </Card>
          <Card title={`Blocked renders (${data.blocked.length})`}>
            {data.blocked.length === 0 && <p className="m-0 text-grey">None.</p>}
            <table className="w-full border-collapse text-[13px]">
              <tbody>
                {data.blocked.map((b) => (
                  <tr key={b.id}>
                    <td className={td}>{when(b.createdAt)}</td>
                    <td className={td}>
                      <b className="text-bad">{b.code ?? "—"}</b> by {b.blockedBy} {b.fixture && <DevBadge />} {b.evalRun && <EvalBadge />}
                    </td>
                    <td className={td}>
                      {b.explanation}
                      <Reopen id={b.id} />
                    </td>
                    <td className={td}>{b.model}</td>
                    <td className={td}>
                      {usd(b.costUsd)}
                      {b.costComplete ? "" : " (partial)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title={`Renders (${data.renders.length}, newest first)`}>
            {data.renders.map((r) => (
              <details key={r.id} className="border-b border-divider py-1 text-[13px]">
                <summary className="cursor-pointer">
                  {when(r.startedAt)} · <b>{r.status}</b> · {r.provider} · {secs(r.latencyMs)} · {usd(r.costUsd)} · brand {r.brandId.slice(0, 12)} · {r.id} {r.fixture && <DevBadge />} {r.evalRun && <EvalBadge />}
                </summary>
                <Reopen id={r.id} />
                <table className="mt-1 w-full border-collapse">
                  <tbody>
                    {r.steps.map((s, i) => (
                      <tr key={i}>
                        <td className={td}>
                          {s.step}
                          {s.attempt === 2 ? " (alt)" : ""}
                        </td>
                        <td className={td}>{s.status}</td>
                        <td className={td}>{s.code ?? ""}</td>
                        <td className={td}>{secs(s.ms)}</td>
                        <td className={td}>{usd(s.costUsd)}</td>
                        <td className={td}>{s.model ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {r.outcome && <p className="m-0 mt-1 text-grey">{r.outcome}</p>}
              </details>
            ))}
          </Card>
        </>
      )}
    </AppPage>
  );
}
