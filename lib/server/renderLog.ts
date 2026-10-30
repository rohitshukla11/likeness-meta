import "server-only";
/**
 * The render step log: one structured entry per pipeline step (licence checks, policy, the creator's
 * frames, generation, the consent gate, the reviewer, label, credential, payment), written to
 * renderLogs/{renderId} as each step finishes, so the brand's page can show a live timeline.
 * Entries are text and numbers only: never image data, masks, embeddings or prompts' images. A
 * sanitiser drops anything that looks like image data and shortens long text, whatever a step passes in.
 */
import { firestore } from "./firebase-admin";
import type { CallMetrics } from "./ai/types";
import type { ConsentFigure } from "./consentGate";

export type StepName = "licence" | "plan" | "policy" | "frames" | "generate" | "consent" | "review" | "alternative" | "label" | "credential" | "payment";
export type StepStatus = "ok" | "refused" | "blocked" | "flagged" | "skipped" | "error";

export type StepEntry = {
  step: StepName;
  status: StepStatus;
  /** When the step finished (ms since epoch) and how long it took. */
  at: number;
  ms: number;
  /** Plain language, for the timeline. */
  detail: string;
  /** A reason code when refused or blocked (OVER_CAP, FACE_MISMATCH, …). */
  code?: string;
  /** 2 on the alternative-shot attempt (lib/server/ai/alternative.ts); absent on the first. */
  attempt?: 1 | 2;
  provider?: string;
  model?: string;
  costUsd?: number | null;
  /** Request settings that change latency or quality (Muse Image's reasoning_strength). */
  settings?: Record<string, string | number>;
  /** The consent gate's figure: boxes, roles and match scores as numbers and short labels (never pixels). */
  figure?: ConsentFigure;
};

export type RenderOutcome = "running" | "delivered" | "refused" | "blocked" | "error";

export type RenderLogDoc = {
  id: string;
  brandId: string;
  licenceId: string;
  creatorId: string | null;
  provider: string;
  status: RenderOutcome;
  startedAt: number;
  finishedAt: number | null;
  /** The last step's plain-language result. */
  outcome: string | null;
  steps: StepEntry[];
};

const MAX_TEXT = 500;
const looksLikeImageData = (s: string) => s.startsWith("data:") || /[A-Za-z0-9+/]{200,}={0,2}/.test(s);

/** Text and numbers only; image-like strings dropped, long text cut. Exported for the tests. */
export function sanitise(e: StepEntry): StepEntry {
  const text = (s: string) => (looksLikeImageData(s) ? "[image data removed]" : s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);
  const out: StepEntry = { step: e.step, status: e.status, at: e.at, ms: Math.max(0, Math.round(e.ms)), detail: text(e.detail) };
  if (e.code) out.code = text(e.code);
  if (e.attempt === 2) out.attempt = 2;
  if (e.provider) out.provider = text(e.provider);
  if (e.model) out.model = text(e.model);
  if (e.costUsd !== undefined) out.costUsd = e.costUsd;
  if (e.settings) out.settings = Object.fromEntries(Object.entries(e.settings).map(([k, v]) => [k, typeof v === "string" ? text(v) : v]));
  if (e.figure) {
    const num = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0);
    const label = (s: string) => text(s).slice(0, 80);
    out.figure = {
      width: Math.round(num(e.figure.width)),
      height: Math.round(num(e.figure.height)),
      people: e.figure.people.slice(0, 10).map((p) => ({ box: { x: num(p.box.x), y: num(p.box.y), w: num(p.box.w), h: num(p.box.h) }, role: p.role, similarity: p.similarity === null ? null : num(p.similarity), label: label(p.label) })),
      verdict: { passed: e.figure.verdict.passed, code: e.figure.verdict.code, text: label(e.figure.verdict.text) },
    };
  }
  return out;
}

/** The model call's provider, model, cost and settings, for a step entry. */
export const fromMetrics = (m: CallMetrics | null | undefined): Partial<StepEntry> =>
  m ? { provider: m.provider, model: m.model, costUsd: m.cost?.costUsd ?? null, ...(m.settings ? { settings: m.settings } : {}) } : {};

type Writer = (id: string, doc: Partial<RenderLogDoc>) => Promise<void>;
const firestoreWriter: Writer = (id, doc) => firestore().collection("renderLogs").doc(id).set(doc, { merge: true }).then(() => undefined);

export class RenderLog {
  private readonly doc: RenderLogDoc;
  private queue: Promise<void> = Promise.resolve();

  constructor(base: Pick<RenderLogDoc, "id" | "brandId" | "licenceId" | "provider">, private readonly write: Writer = firestoreWriter) {
    this.doc = { ...base, creatorId: null, status: "running", startedAt: Date.now(), finishedAt: null, outcome: null, steps: [] };
    this.persist(this.doc);
  }

  get entries(): readonly StepEntry[] {
    return this.doc.steps;
  }

  setCreator(creatorId: string) {
    this.doc.creatorId = creatorId;
    this.persist({ creatorId });
  }

  /** Record one finished step. */
  add(e: Omit<StepEntry, "at"> & { at?: number }) {
    this.doc.steps.push(sanitise({ ...e, at: e.at ?? Date.now() }));
    this.persist({ steps: this.doc.steps });
  }

  /** Time `run` as one step. `ok` describes success; a throw is recorded (refused or error) and rethrown. */
  async step<T>(step: StepName, run: () => Promise<T>, ok: (r: T) => Omit<StepEntry, "step" | "at" | "ms">, attempt: 1 | 2 = 1): Promise<T> {
    const t = Date.now();
    try {
      const r = await run();
      this.add({ step, ms: Date.now() - t, ...ok(r) });
      return r;
    } catch (e) {
      const refused = typeof (e as { status?: unknown }).status === "number" && (e as { status: number }).status < 500;
      const code = (e as { code?: unknown }).code;
      this.add({ step, status: refused ? "refused" : "error", ms: Date.now() - t, detail: (e as Error).message, ...(typeof code === "string" ? { code } : {}), ...(attempt === 2 ? { attempt } : {}) });
      throw e;
    }
  }

  finish(status: Exclude<RenderOutcome, "running">, outcome: string) {
    Object.assign(this.doc, { status, outcome: sanitise({ step: "payment", status: "ok", at: 0, ms: 0, detail: outcome }).detail, finishedAt: Date.now() });
    this.persist({ status, outcome: this.doc.outcome, finishedAt: this.doc.finishedAt });
  }

  /** Wait for every write (writes are queued in order; a failed write never fails the render). */
  flush(): Promise<void> {
    return this.queue;
  }

  private persist(patch: Partial<RenderLogDoc>) {
    const id = this.doc.id;
    const snapshot = JSON.parse(JSON.stringify(patch)) as Partial<RenderLogDoc>;
    this.queue = this.queue.then(() => this.write(id, snapshot)).catch((e) => console.error(JSON.stringify({ service: "render-log", renderId: id, error: String((e as Error).message).slice(0, 200) })));
  }
}
