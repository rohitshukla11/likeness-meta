"use client";
/**
 * What the consent gate saw, drawn from stored numbers only: a blank frame with the image's proportions,
 * each person's box numbered left to right and labelled on the box ("1 · Maya · 0.95"; placed by
 * lib/figureLayout.ts, never overlapping or leaving the frame), and the verdict with its reason code.
 * Green is the licensed creator; red is whatever blocks the image (an extra person, a face that doesn't
 * match, a hidden face). No image pixels are stored or shown.
 */

import { LABEL_FONT, LABEL_H, layoutFigure } from "@/lib/figureLayout";

export type Figure = {
  width: number;
  height: number;
  people: { box: { x: number; y: number; w: number; h: number }; role: string; similarity: number | null; label: string }[];
  verdict: { passed: boolean; code: string | null; text: string };
};

const GREEN = "var(--color-ok, #3b6e25)";
const RED = "var(--color-bad, #a33434)";
const colour = (role: string) => (role === "creator" ? GREEN : RED);

/** Drawing width in px; the SVG scales down on narrow screens. */
const W = 480;

export function ConsentFigure({ f }: { f: Figure }) {
  const { H, labels } = layoutFigure(f, W);
  const summary = `${f.verdict.passed ? "Passed" : `Blocked${f.verdict.code ? ` (${f.verdict.code})` : ""}`}: ${labels.map((l) => l.text).join("; ") || "no person found"}`;
  return (
    <figure className="m-0 mt-1 flex max-w-full flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} role="img" aria-label={summary} className="h-auto max-w-full rounded-[10px] border border-divider bg-paper">
        <title>{summary}</title>
        {f.people.length === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={LABEL_FONT} fill="currentColor" opacity="0.6">
            no person found
          </text>
        )}
        {labels.map((l) => (
          <rect key={`box${l.n}`} x={l.box.x} y={l.box.y} width={l.box.w} height={l.box.h} fill={colour(l.role)} fillOpacity="0.14" stroke={colour(l.role)} strokeWidth="2.5" rx="3" />
        ))}
        {/* Labels after every box, so no box is drawn over a label. */}
        {labels.map((l) => (
          <g key={`label${l.n}`}>
            <rect x={l.label.x} y={l.label.y} width={l.label.w} height={l.label.h} fill={colour(l.role)} rx="4" />
            <text x={l.label.x + 6} y={l.label.y + LABEL_H - 6} fontSize={LABEL_FONT} fontWeight="600" fill="#fff">
              {l.text}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-[13px]">
        <b className={f.verdict.passed ? "text-ok" : "text-bad"}>
          {f.verdict.passed ? "Passed" : "Blocked"}
          {f.verdict.code ? ` · ${f.verdict.code}` : ""}
        </b>
      </figcaption>
    </figure>
  );
}
