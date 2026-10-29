/**
 * The model proposes, the code decides. Every shot a BrandAgent proposes goes through these rules, the
 * same licence rules a render goes through (lib/model.ts licenceStatus, the render cap, the banned-use
 * keyword rules), and each decision carries a plain-language explanation for the brand.
 * The model's own policy check (BrandAgent.checkPolicy) runs again on each prompt at render time, in
 * lib/server/filter.ts, and refuses the render if it fails or errors.
 */
import { licenceStatus, useLabel, type LicenceDoc } from "@/lib/model";
import type { RefusalCode, ShotDecision, ShotProposal } from "./types";

/** Plain language for each refusal; `detail` adds the specifics (a rule hit, a count, a date). */
export function explain(code: RefusalCode, detail = ""): string {
  const d = detail ? ` ${detail}` : "";
  switch (code) {
    case "EMPTY_BRIEF":
      return `There is nothing to render: the brief or the shot prompt is empty.${d}`;
    case "BANNED_USE":
      return `Refused: this asks for a use that no licence allows (political, adult, minors, impersonation or deception).${d}`;
    case "OUTSIDE_LICENSED_USE":
      return `Refused: this licence covers one use only, and this shot falls outside it.${d}`;
    case "LICENCE_REVOKED":
      return `Refused: the creator revoked this licence, so no new images can be made under it.${d}`;
    case "LICENCE_EXPIRED":
      return `Refused: this licence has expired.${d}`;
    case "OVER_CAP":
      return `Refused: this licence's render limit would be exceeded.${d}`;
    case "DAILY_LIMIT":
      return `Refused: today's render limit is reached.${d}`;
    case "MODEL_REFUSED":
      return `Refused by the policy model.${d}`;
    case "POLICY_CHECK_FAILED":
      return `Refused: the policy check could not run, and renders are never made without it.${d}`;
  }
}

/** A licence-wide refusal (revoked, expired, used up), or null when renders may go ahead. */
export function licenceRefusal(l: Pick<LicenceDoc, "revokedAt" | "end" | "renderCount" | "maxRenders">, now = Date.now()): ShotDecision | null {
  const status = licenceStatus(l, now);
  if (status === "Revoked") return { shotId: null, allowed: false, code: "LICENCE_REVOKED", explanation: explain("LICENCE_REVOKED") };
  if (status === "Expired") return { shotId: null, allowed: false, code: "LICENCE_EXPIRED", explanation: explain("LICENCE_EXPIRED", `It ended on ${new Date(l.end).toISOString().slice(0, 10)}.`) };
  if (status === "Exhausted") return { shotId: null, allowed: false, code: "OVER_CAP", explanation: explain("OVER_CAP", `All ${l.maxRenders} renders have been used.`) };
  return null;
}

/**
 * Decide each proposed shot. `ruleHits` is the banned-use keyword check (lib/server/filter.ts
 * ruleCheck), passed in so this module stays pure and testable.
 */
export function decideShots(proposals: ShotProposal[], l: LicenceDoc, ruleHits: (text: string) => string[], now = Date.now()): ShotDecision[] {
  const whole = licenceRefusal(l, now);
  if (whole) return [whole, ...proposals.map((p) => ({ ...whole, shotId: p.id }))];
  const left = l.maxRenders - l.renderCount;
  let allowedSoFar = 0;
  return proposals.map((p, i) => {
    if (p.prompt.trim().length < 3) return { shotId: p.id, allowed: false, code: "EMPTY_BRIEF", explanation: explain("EMPTY_BRIEF") };
    const hits = ruleHits(p.prompt);
    if (hits.length) return { shotId: p.id, allowed: false, code: "BANNED_USE", explanation: explain("BANNED_USE", `Matched: ${hits.join("; ")}.`) };
    if (allowedSoFar >= left)
      return { shotId: p.id, allowed: false, code: "OVER_CAP", explanation: explain("OVER_CAP", `The licence has ${left} render${left === 1 ? "" : "s"} left, so shot ${i + 1} was not planned.`) };
    allowedSoFar++;
    return { shotId: p.id, allowed: true, code: null, explanation: `Allowed under the ${useLabel(l.use)} licence (${l.renderCount + allowedSoFar} of ${l.maxRenders} renders once made). The full safety check runs again before rendering.` };
  });
}
