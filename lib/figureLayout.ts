/**
 * Where the consent figure's labels go (components/dashboard/ConsentFigure.tsx). Pure, so it is tested.
 *
 * People are numbered left to right; each label reads "N · who · score", built from the stored role and
 * score, so figures stored with older labels ("Person 1: Maya Okafor, match 0.81") follow the same rules.
 * A label sits above its box, shifted inward at the frame's edges. If it would overlap a label already
 * placed, it is shortened ("N · who · score" with a short word), then tried below its box, then at the
 * nearest free height. Labels never leave the frame.
 */

export type FigureInput = {
  width: number;
  height: number;
  people: { box: { x: number; y: number; w: number; h: number }; role: string; similarity: number | null; label: string }[];
};
export type Rect = { x: number; y: number; w: number; h: number };
export type PlacedLabel = { n: number; role: string; box: Rect; text: string; label: Rect };

export const LABEL_FONT = 15;
export const LABEL_H = 22;
/** A generous width per character for 15 px semibold text, so the estimate never runs short. */
const CHAR_W = LABEL_FONT * 0.62;
const PAD = 12;
const MAX_NAME = 14;

const FULL: Record<string, string> = { "extra person": "extra person", "not licensed": "not licensed", "face not visible": "face not visible", "face only": "face outside any person" };
const SHORT: Record<string, string> = { "extra person": "extra", "not licensed": "unlicensed", "face not visible": "hidden", "face only": "outside" };

/** The creator's first name from a stored label, new ("1 · Maya · 0.95") or old ("Person 1: Maya Okafor, match 0.81"). */
export function creatorName(label: string): string {
  const m = /^\d+ · (.+?)(?: · [\d.]+)?$/.exec(label) ?? /^Person \d+: (.+?)(?:, match [\d.]+)?$/.exec(label);
  const first = (m?.[1] ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? first.slice(0, MAX_NAME) : "creator";
}

/** The label text for one person, full or short. */
export function labelText(n: number, p: FigureInput["people"][number], short: boolean): string {
  const who = p.role === "creator" ? creatorName(p.label) : ((short ? SHORT : FULL)[p.role] ?? p.role);
  const score = p.role === "face not visible" || p.similarity === null ? "" : ` · ${(Math.round(p.similarity * 100) / 100).toFixed(2)}`;
  return `${n} · ${who}${score}`;
}

export const labelWidth = (text: string) => Math.ceil(text.length * CHAR_W + PAD);

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Lay out every label for a drawing `W` px wide. */
export function layoutFigure(f: FigureInput, W: number): { H: number; labels: PlacedLabel[] } {
  const H = f.width > 0 && f.height > 0 ? Math.round((W * f.height) / f.width) : W;
  const clampX = (x: number, w: number) => Math.max(0, Math.min(x, W - w));
  const clampY = (y: number) => Math.max(0, Math.min(y, H - LABEL_H));
  const people = [...f.people].sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
  const placed: PlacedLabel[] = [];
  const free = (r: Rect) => !placed.some((p) => overlaps(p.label, r));
  people.forEach((p, i) => {
    const box = { x: p.box.x * W, y: p.box.y * H, w: Math.max(2, p.box.w * W), h: Math.max(2, p.box.h * H) };
    const above = clampY(box.y - LABEL_H);
    const below = clampY(box.y + box.h);
    const at = (text: string, y: number, x = box.x): Rect => {
      const w = Math.min(W, labelWidth(text));
      return { x: clampX(x, w), y, w, h: LABEL_H };
    };
    const full = labelText(i + 1, p, false);
    const short = labelText(i + 1, p, true);
    // In order: full above, short above, short below; then the nearest free height, at the box or either edge.
    const tries: [string, Rect][] = [
      [full, at(full, above)],
      [short, at(short, above)],
      [short, at(short, below)],
    ];
    let chosen = tries.find(([, r]) => free(r));
    if (!chosen) {
      const heights = Array.from({ length: Math.floor((H - LABEL_H) / 2) + 1 }, (_, k) => k * 2).sort((a, b) => Math.abs(a - above) - Math.abs(b - above));
      for (const y of heights) {
        const r = [at(short, y), at(short, y, 0), at(short, y, W)].find(free);
        if (r) {
          chosen = [short, r];
          break;
        }
      }
    }
    // Only when the frame has no free space left (more labels than fit): the short label above its box.
    const [text, label] = chosen ?? tries[1];
    placed.push({ n: i + 1, role: p.role, box, text, label });
  });
  return { H, labels: placed };
}
