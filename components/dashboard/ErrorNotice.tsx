"use client";
/**
 * An error in plain language: what happened (the reason code's title and the server's detail) and what
 * the user can do next, with a button where one helps (lib/reasons.ts). Judges are offered "Reset demo".
 * "Nothing was charged." appears once, in the reason sentence. A reopened blocked render passes
 * `uncharged` (blocked images are never charged) and `actions={false}` (no buttons for a past render).
 */
import Link from "next/link";
import { useState } from "react";
import { pillClass } from "@/components/ds";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiError, reason } from "@/lib/client/firebase";
import { reasonFor, reasonSentence } from "@/lib/reasons";

export function ErrorNotice({ error, onRetry, onEditBrief, uncharged = false, actions = true }: { error: unknown; onRetry?: () => void; onEditBrief?: () => void; uncharged?: boolean; actions?: boolean }) {
  const { me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const r = reasonFor(e?.code, e?.status);
  const next = r.next({ role: me?.user.role ?? null, judge: !!me?.judge });
  const raw = reason(error);
  const detail = reasonSentence(raw === r.title ? "" : raw, uncharged || !!r.uncharged);
  const run = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await f();
      setNote(done);
      setTimeout(() => window.location.reload(), 1200);
    } catch (x) {
      setNote(reason(x));
    } finally {
      setBusy(false);
    }
  };
  const button = !actions
    ? null
    : next.action === "reset-demo" ? (
      <button type="button" disabled={busy} onClick={() => run(() => api("/api/demo/reset", { method: "POST" }), "Reset done.")} className={pillClass("ink", "min-h-9 px-3 text-[13px]")}>
        Reset demo
      </button>
    ) : next.action === "find-creator" ? (
      <Link href="/creators" className={pillClass("outline", "min-h-9 px-3 text-[13px]")}>
        Find a creator
      </Link>
    ) : next.action === "top-up" ? (
      <button type="button" disabled={busy} onClick={() => run(() => api("/api/credits/topup", { method: "POST" }), "Demo credits added.")} className={pillClass("outline", "min-h-9 px-3 text-[13px]")}>
        Use demo top-up
      </button>
    ) : next.action === "retry" && onRetry ? (
      <button type="button" onClick={onRetry} className={pillClass("outline", "min-h-9 px-3 text-[13px]")}>
        Try again
      </button>
    ) : next.action === "edit-brief" && onEditBrief ? (
      <button type="button" onClick={onEditBrief} className={pillClass("outline", "min-h-9 px-3 text-[13px]")}>
        Edit the brief
      </button>
    ) : null;
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-[12px] border border-bad/30 bg-white p-3 text-[14px]">
      <b className="text-bad">
        {r.title}
        {e?.code ? <span className="ml-2 text-[12px] font-semibold text-grey">{e.code}</span> : null}
      </b>
      {detail && <span className="text-grey">{detail}</span>}
      <span>
        <b>What you can do: </b>
        {next.text}
        {e?.retryAfter ? ` (about ${e.retryAfter} s)` : ""}
      </span>
      {button && <span className="mt-1 flex gap-2">{button}</span>}
      {note && <span className="text-[13px] text-wait">{note}</span>}
    </div>
  );
}
