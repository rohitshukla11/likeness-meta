"use client";
import { useState } from "react";
import { pillClass } from "@/components/ds";
import { inputClass } from "@/components/ui";
import { api, reason } from "@/lib/client/firebase";
import { DEFAULT_INPUT, MOODS, TEMPLATES, type AssistantDraft, type AssistantInput } from "@/lib/creative";

/**
 * "✨ Write it for me": a few optional inputs → a detailed prompt from Gemini, which fills the Brief
 * box (and, for a video ad, the motion box). Free; text only. Everything it writes stays editable.
 */
export function CreativeAssistant({ licenceId, onDraft }: { licenceId: string; onDraft: (d: AssistantDraft) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<AssistantInput>(DEFAULT_INPUT);
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof AssistantInput>(k: K, v: AssistantInput[K]) => setInput((i) => ({ ...i, [k]: v }));

  const write = async (regenerate: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ draft: AssistantDraft }>("/api/assistant", { method: "POST", body: JSON.stringify({ licenceId, ...input, regenerate }) });
      setDraft(r.draft);
      onDraft(r.draft);
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={pillClass("outline", "min-h-9 self-start px-3 text-[13px]")}>
        ✨ Write it for me
      </button>
    );

  const chip = (on: boolean) => pillClass(on ? "ink" : "outline", "min-h-9 px-3 text-[13px]");
  const field = (k: "idea" | "product" | "setting", label: string, placeholder: string) => (
    <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[13px]">
      <span className="text-grey">{label}</span>
      <input value={input[k]} onChange={(e) => set(k, e.target.value)} maxLength={120} placeholder={placeholder} className={inputClass} />
    </label>
  );
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-divider bg-white p-3">
      <span className="flex items-center justify-between gap-2">
        <b className="text-[14px]">✨ Creative assistant</b>
        <button type="button" onClick={() => setOpen(false)} className="text-[13px] text-grey underline">
          Close
        </button>
      </span>
      <span className="flex flex-wrap gap-2" aria-label="Templates">
        {TEMPLATES.map((t) => (
          <button key={t.key} type="button" onClick={() => setInput((i) => ({ ...i, idea: "", product: "", setting: "", ...t.input }))} className={pillClass("outline", "min-h-9 px-3 text-[13px]")}>
            {t.label}
          </button>
        ))}
      </span>
      <span className="flex flex-wrap gap-2">
        {field("idea", "Idea (one line)", "spring coffee promo")}
        {field("product", "Product", "oat latte in a ceramic cup")}
        {field("setting", "Setting", "sunlit café")}
      </span>
      <span className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-grey">Mood</span>
        {MOODS.map((m) => (
          <button key={m} type="button" aria-pressed={input.mood === m} onClick={() => set("mood", m)} className={chip(input.mood === m)}>
            {m}
          </button>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-grey">Format</span>
        {(["image", "video"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={input.format === f}
            onClick={() => setInput((i) => ({ ...i, format: f, aspect: f === "video" && i.aspect === "1:1" ? "16:9" : i.aspect }))}
            className={chip(input.format === f)}
          >
            {f === "image" ? "Image ad" : "Video ad"}
          </button>
        ))}
        <span className="ml-2 text-grey">Aspect</span>
        {(input.format === "video" ? (["16:9", "9:16"] as const) : (["1:1", "16:9", "9:16"] as const)).map((a) => (
          <button key={a} type="button" aria-pressed={input.aspect === a} onClick={() => set("aspect", a)} className={chip(input.aspect === a)}>
            {a}
          </button>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => write(false)} className={pillClass("lime", "min-h-10 px-4")}>
          {busy ? "Writing…" : draft ? "Write again with these inputs" : "Write it for me"}
        </button>
        {draft && (
          <button type="button" disabled={busy} onClick={() => write(true)} className={pillClass("outline", "min-h-10 px-4")}>
            Regenerate
          </button>
        )}
        {draft && (
          <button type="button" aria-expanded={details} onClick={() => setDetails((d) => !d)} className="text-[13px] text-grey underline">
            {details ? "Hide details" : "Show details"}
          </button>
        )}
        <span className="text-[12px] text-grey">Free, text only. Every render still goes through the safety filter.</span>
      </span>
      {draft && <span className="text-[13px] text-ok">Filled the brief{draft.motion ? " and the video motion" : ""}; edit freely. {draft.note}</span>}
      {draft && details && (
        <dl className="m-0 grid gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
          {Object.entries(draft.details).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-semibold capitalize">{k}</dt>
              <dd className="m-0 text-grey">{v}</dd>
            </div>
          ))}
          {draft.motion && (
            <div className="contents">
              <dt className="font-semibold">Motion</dt>
              <dd className="m-0 text-grey">{draft.motion}</dd>
            </div>
          )}
        </dl>
      )}
      {err && (
        <span role="alert" className="text-[13px] text-bad">
          {err}
        </span>
      )}
    </div>
  );
}
