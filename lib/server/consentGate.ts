import "server-only";
/**
 * The consent gate, run on every generated image before it is labelled, signed or charged, under
 * either AI provider. It passes only when:
 *   1. the PersonSegmenter (SAM 3.1 with meta, YuNet faces with google) finds exactly one person;
 *   2. the face check (lib/server/facecheck.ts: YuNet + AuraFace, on this server) finds that person's
 *      face, inside the person's box and fully visible, and no second clear face;
 *   3. the face matches the licensed creator's reference frames at or above CONSENT_FACE_MATCH_THRESHOLD.
 * Anything else blocks the image with a reason code; any error is GATE_ERROR (fail closed).
 * Nothing it returns contains pixels, masks or embeddings: only counts, boxes and scores.
 */
import { ai } from "./ai";
import { isBudgetStop } from "./ai/budget";
import type { Box, CallMetrics, ImageInput, PersonSegmenter } from "./ai/types";
import { checkImageFaces, type ImageFaceCheck } from "./facecheck";

export type ConsentCode = "NO_PERSON" | "MULTIPLE_PEOPLE" | "FACE_NOT_VISIBLE" | "FACE_MISMATCH" | "GATE_ERROR";

export type ConsentResult = {
  passed: boolean;
  code: ConsentCode | null;
  /** Plain language, in full: for the brand's error card and the blocked render's record. */
  explanation: string;
  /** A few words for the step line ("2 people found"). */
  short: string;
  people: number | null;
  faces: number | null;
  similarity: number | null;
  threshold: number | null;
  segmenter: string | null;
  /** What the gate saw, as numbers and short labels for the timeline: never pixels. Null when the gate couldn't run. */
  figure: ConsentFigure | null;
  metrics: CallMetrics[];
};

/**
 * One person in the gate's figure: their box (fractions of the image), their role, and their face's match.
 * "creator" is the licensed creator (at most one, drawn green); every other role is what blocks an image
 * (drawn red): another person who also matches ("extra person"), a face that doesn't match ("not
 * licensed"), a face cut off or missing ("face not visible"), a clear face outside every person ("face only").
 */
export type FigurePerson = { box: { x: number; y: number; w: number; h: number }; role: "creator" | "extra person" | "not licensed" | "face not visible" | "face only"; similarity: number | null; label: string };
export type ConsentFigure = { width: number; height: number; people: FigurePerson[]; verdict: { passed: boolean; code: ConsentCode | null; text: string } };

const MAX_FIGURE_PEOPLE = 10;

/**
 * The figure for the timeline, from what was detected. Each person (a SAM box, or a face with the local
 * counter) gets the best-matching face inside it. The best fully visible match at or above the threshold
 * is the licensed creator; another person who also matches is an extra person; a lower match is not
 * licensed; no face, or a face cut by the edge, is face not visible. A clear face outside every person
 * box is shown on its own. People are numbered left to right; labels read "1 · Maya · 0.95". Pure.
 */
export function consentFigure(
  people: { boxes: Omit<Box, "score">[] },
  face: Pick<ImageFaceCheck, "width" | "height" | "faces" | "threshold">,
  verdict: { code: ConsentCode | null; explanation: string },
  creatorName: string,
): ConsentFigure {
  const used = new Set<number>();
  type Found = { box: FigurePerson["box"]; similarity: number | null; visible: boolean; inPerson: boolean };
  const found: Found[] = people.boxes.slice(0, MAX_FIGURE_PEOPLE).map((box) => {
    const inside = face.faces.map((f, j) => ({ f, j })).filter(({ f, j }) => !used.has(j) && overlapShare(f, box) >= FACE_IN_PERSON);
    const best = inside.sort((a, b) => (b.f.similarity ?? -1) - (a.f.similarity ?? -1))[0];
    if (best) used.add(best.j);
    return { box: { x: box.x, y: box.y, w: box.w, h: box.h }, similarity: best?.f.similarity ?? null, visible: !!best && best.f.fullyVisible !== false, inPerson: true };
  });
  face.faces.forEach((f, j) => {
    if (used.has(j) || f.score < SECOND_FACE_SCORE || found.length >= MAX_FIGURE_PEOPLE) return;
    found.push({ box: { x: f.x, y: f.y, w: f.w, h: f.h }, similarity: f.similarity ?? null, visible: f.fullyVisible !== false, inPerson: false });
  });
  const matches = (p: Found) => p.inPerson && p.visible && p.similarity !== null && p.similarity >= face.threshold;
  const creator = found.filter(matches).sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))[0];
  const first = creatorName.trim().split(/\s+/)[0] || "the creator";
  const score = (s: number | null) => (s === null ? "" : ` · ${(Math.round(s * 100) / 100).toFixed(2)}`);
  const ordered = [...found].sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
  const out = ordered.map((p, i): FigurePerson => {
    const role: FigurePerson["role"] = p === creator ? "creator" : !p.inPerson ? "face only" : !p.visible ? "face not visible" : matches(p) ? "extra person" : "not licensed";
    const what = { creator: first, "extra person": "extra person", "not licensed": "not licensed", "face not visible": "face not visible", "face only": "face outside any person" }[role];
    return { box: p.box, role, similarity: p.similarity, label: `${i + 1} · ${what}${role === "face not visible" ? "" : score(p.similarity)}` };
  });
  return { width: face.width, height: face.height, people: out, verdict: { passed: verdict.code === null, code: verdict.code, text: verdict.explanation } };
}

/** A second face at or above this YuNet score counts as another person, even if the segmenter missed them. */
const SECOND_FACE_SCORE = 0.9;
/** How much of the face box must lie inside the person's box. */
const FACE_IN_PERSON = 0.8;

const overlapShare = (inner: Omit<Box, "score">, outer: Omit<Box, "score">) => {
  const w = Math.max(0, Math.min(inner.x + inner.w, outer.x + outer.w) - Math.max(inner.x, outer.x));
  const h = Math.max(0, Math.min(inner.y + inner.h, outer.y + outer.h) - Math.max(inner.y, outer.y));
  return inner.w * inner.h > 0 ? (w * h) / (inner.w * inner.h) : 0;
};

/** The gate's decision from what was detected. Pure, so every case is testable without models. */
export function consentVerdict(
  people: { count: number; boxes: Omit<Box, "score">[] },
  face: Pick<ImageFaceCheck, "faces" | "fullyVisible" | "similarity" | "threshold">,
): { code: ConsentCode | null; explanation: string; short: string } {
  if (people.count === 0) return { code: "NO_PERSON", explanation: "No person was found in the image, so it can't be the licensed creator.", short: "No person found" };
  if (people.count > 1) return { code: "MULTIPLE_PEOPLE", explanation: `${people.count} people were found; a licensed image may show only the creator.`, short: `${people.count} people found` };
  const [best, second] = face.faces;
  if (second && second.score >= SECOND_FACE_SCORE) return { code: "MULTIPLE_PEOPLE", explanation: "A second face was found; a licensed image may show only the creator.", short: "A second face found" };
  if (!best) return { code: "FACE_NOT_VISIBLE", explanation: "A person was found, but no face: the creator's face must be visible.", short: "No face found" };
  if (people.boxes[0] && overlapShare(best, people.boxes[0]) < FACE_IN_PERSON)
    return { code: "FACE_NOT_VISIBLE", explanation: "The face found isn't the person's face (it lies outside the person).", short: "Face outside the person" };
  if (!face.fullyVisible) return { code: "FACE_NOT_VISIBLE", explanation: "The face is cut off by the edge of the image; the whole face must be visible.", short: "Face cut off by the edge" };
  const sim = face.similarity === null ? "unknown" : face.similarity.toFixed(2);
  if (face.similarity === null || face.similarity < face.threshold)
    return { code: "FACE_MISMATCH", explanation: `The face doesn't match the licensed creator (similarity ${sim}, needs ${face.threshold}).`, short: `Face doesn't match (${sim}, needs ${face.threshold})` };
  return { code: null, explanation: `One person, face fully visible, matches the creator (similarity ${sim}, threshold ${face.threshold}).`, short: `1 person, face matches (${sim})` };
}

/** Run the gate on a generated image. `refs` are the creator's reference embeddings (lib/server/facematch referenceEmbeddings). */
export async function runConsentGate(image: ImageInput, refs: Float32Array[], segmenter: PersonSegmenter = ai().segmenter, creatorName = ""): Promise<ConsentResult> {
  const metrics: CallMetrics[] = [];
  try {
    if (!refs.length) throw new Error("no usable reference face for this creator");
    const people = await segmenter.detectPeople(image);
    metrics.push(people.metrics);
    const t = Date.now();
    const face = await checkImageFaces(image.bytes, refs);
    metrics.push({ provider: "local", model: "YuNet + AuraFace", latencyMs: Date.now() - t, cost: { costUsd: 0, estimate: true, basis: "runs on this server" } });
    const v = consentVerdict(people, face);
    const r2 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);
    const figure = consentFigure(people, face, v, creatorName);
    return { passed: v.code === null, code: v.code, explanation: v.explanation, short: v.short, people: people.count, faces: face.faces.length, similarity: r2(face.similarity), threshold: face.threshold, segmenter: people.metrics.model, figure, metrics };
  } catch (e) {
    if (isBudgetStop(e)) throw e;
    return {
      passed: false,
      code: "GATE_ERROR",
      explanation: `The consent check could not run, so the image was not delivered: ${(e as Error).message.slice(0, 200)}`,
      short: "Consent check couldn't run",
      people: null,
      faces: null,
      similarity: null,
      threshold: null,
      segmenter: null,
      figure: null,
      metrics,
    };
  }
}
