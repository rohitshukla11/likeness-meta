"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppPage, Card, StatusPill, pillClass } from "@/components/ds";
import { reason } from "@/lib/client/firebase";

type Result = {
  verdict: "Licensed" | "Expired" | "Revoked" | "Unknown";
  headline: string;
  sha256: string;
  receipt: { valid: boolean; keyVersion: string; payload: { renderType: string; createdAt: number; model: string } } | null;
  licence: { id: string; use: string; status: string; renders: string; licensee: string } | null;
  creator: { displayName: string; demo: boolean; channel: { title: string } | null } | null;
  manifest: { present: boolean; signatureValid?: boolean; trustedSigner?: boolean; matchesReceipt?: boolean };
  notes: string[];
};

export default function VerifyPage() {
  // useSearchParams needs a Suspense boundary in a statically rendered page.
  return (
    <Suspense fallback={<AppPage title="Verify a file">Loading…</AppPage>}>
      <Verify />
    </Suspense>
  );
}

function Verify() {
  const sha = useSearchParams().get("sha");
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function check(file: File) {
    setBusy(true);
    setErr(null);
    setR(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/verify", { method: "POST", body: form });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "check failed");
      setR(j);
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy(false);
    }
  }
  // Opened from a render card: check that render by its receipt straight away.
  useEffect(() => {
    if (!sha || !/^[0-9a-f]{64}$/.test(sha)) return;
    setBusy(true);
    fetch(`/api/verify?sha=${sha}`)
      .then(async (res) => {
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "check failed");
        setR(j);
      })
      .catch((e) => setErr(reason(e)))
      .finally(() => setBusy(false));
  }, [sha]);
  const kind = r?.verdict === "Licensed" ? "licensed" : r?.verdict === "Revoked" ? "revoked" : r?.verdict === "Expired" ? "expired" : "neutral";
  return (
    <AppPage title="Verify a file" description="Was this image or video licensed by the person in it? Nothing you upload is stored.">
      <Card>
        <label className={pillClass("lime", "self-start cursor-pointer")}>
          Choose an image or video
          <input type="file" accept="image/*,video/mp4" className="sr-only" onChange={(e) => e.target.files?.[0] && check(e.target.files[0])} />
        </label>
        {sha && <span className="text-[14px] text-grey">Checking this render by its receipt. To check the content credential too, download the file and upload it here.</span>}
        {busy && <span className="text-wait">Checking the receipt, its signature, the licence and the content credential…</span>}
        {err && <span className="text-bad">{err}</span>}
      </Card>
      {r && (
        <Card title={<StatusPill kind={kind}>{r.verdict}</StatusPill>}>
          <p className="m-0 text-[17px] font-semibold">{r.headline}</p>
          {r.creator && (
            <span>
              Creator: <b>{r.creator.displayName}</b>
              {r.creator.demo ? " (synthetic demo creator)" : r.creator.channel ? ` · YouTube: ${r.creator.channel.title}` : ""}
            </span>
          )}
          {r.licence && (
            <span>
              Licensee: <b>{r.licence.licensee}</b> · use: {r.licence.use} · licence {r.licence.id.slice(0, 8)} · {r.licence.renders} renders
            </span>
          )}
          <span>
            Signed receipt: {r.receipt ? (r.receipt.valid ? `valid (Cloud KMS, ${r.receipt.payload.renderType}, ${r.receipt.payload.model})` : "signature does not verify") : "none for these exact bytes"}
          </span>
          <span>
            Content credential (C2PA): {r.manifest.present ? `${r.manifest.signatureValid ? "intact" : "broken"}${r.manifest.trustedSigner ? "" : ", test certificate"}${r.manifest.matchesReceipt ? ", matches the receipt" : ""}` : "none"}
          </span>
          {r.notes.map((n) => (
            <span key={n} className="text-[14px] text-grey">
              {n}
            </span>
          ))}
          <span className="break-all font-mono text-[12px] text-grey">sha256 {r.sha256}</span>
        </Card>
      )}
    </AppPage>
  );
}
