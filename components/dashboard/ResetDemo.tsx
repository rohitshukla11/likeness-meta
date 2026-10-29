"use client";
/** "Reset demo", shown to the judge accounts: the judge licence back to its first render, the judge brand's credits restored. */
import { useState } from "react";
import { Card, pillClass } from "@/components/ds";
import { api, reason } from "@/lib/client/firebase";

export function ResetDemo({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Card title="Judge demo">
      <p className="m-0 text-[14px] text-grey">
        Reset puts the judge licence back to its first render (active again if it was revoked) and restores the judge brand&apos;s demo credits. Renders already made stay, with their receipts. Daily limits still apply.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const r = await api<{ credits: number; wasRevoked: boolean }>("/api/demo/reset", { method: "POST" });
            setMsg({ ok: true, text: `Reset done: licence back to 0 renders${r.wasRevoked ? " and active again" : ""}; ${r.credits.toLocaleString("en-US")} demo credits.` });
            await onDone();
            // The licence and render lists load once per page: show the reset state.
            setTimeout(() => window.location.reload(), 1500);
          } catch (e) {
            setMsg({ ok: false, text: reason(e) });
          } finally {
            setBusy(false);
          }
        }}
        className={pillClass("outline", "self-start")}
      >
        {busy ? "Resetting…" : "Reset demo"}
      </button>
      {msg && (
        <span role={msg.ok ? "status" : "alert"} className={`text-[14px] ${msg.ok ? "text-ok" : "text-bad"}`}>
          {msg.text}
        </span>
      )}
    </Card>
  );
}
