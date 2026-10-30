/**
 * Every refusal and failure reason code, in plain language, with what the user can do next. Shared by
 * the server (which sends the code with each error) and the browser (which shows it). The next step
 * depends on who is looking: a judge account is told to press "Reset demo" where that helps.
 */

export type ReasonContext = { role: "brand" | "creator" | null; judge: boolean };
/** A button the UI can offer as the next step. */
export type NextAction = "reset-demo" | "find-creator" | "top-up" | "retry" | "edit-brief" | "none";
/** `uncharged`: this failure never charges; the error card says "Nothing was charged." once, in the reason sentence. */
export type Reason = { title: string; next: (c: ReasonContext) => { text: string; action: NextAction }; uncharged?: true };

const plain = (text: string, action: NextAction = "none") => () => ({ text, action });

export const REASONS = {
  // Licence and account
  NO_LICENCE: { title: "Licence not found", next: plain("Request a licence from a creator's page.", "find-creator") },
  NOT_YOUR_LICENCE: { title: "Not your licence", next: plain("This licence belongs to another brand. Request your own from the creator's page.", "find-creator") },
  LICENCE_REVOKED: {
    title: "Licence revoked",
    next: (c) => (c.judge ? { text: "The creator revoked it. Press Reset demo to make it active again.", action: "reset-demo" } : { text: "The creator revoked this licence. Ask the creator to re-approve by sending a new request.", action: "find-creator" }),
  },
  LICENCE_EXPIRED: { title: "Licence expired", next: plain("This licence has ended. Send the creator a new request.", "find-creator") },
  OVER_CAP: {
    title: "Out of renders",
    next: (c) => (c.judge ? { text: "This licence's renders are used up. Press Reset demo to start again.", action: "reset-demo" } : { text: "This licence's renders are used up. Request a new licence from the creator.", action: "find-creator" }),
  },
  NO_CREDITS: {
    title: "Not enough demo credits",
    next: (c) => (c.judge ? { text: "Press Reset demo to restore the judge brand's credits.", action: "reset-demo" } : { text: "Use your one demo top-up from the dashboard.", action: "top-up" }),
  },
  DAILY_LIMIT: { title: "Daily limit reached", next: plain("Try again after 00:00 UTC. Images the consent check blocked count toward the limit too.") },
  RENDER_CONFLICT: { title: "Another render finished first", next: plain("Two renders on this licence finished at once; this one wasn't charged. Try again.", "retry") },
  NO_CREATOR: { title: "Creator not found", next: plain("The creator may have left. Choose another creator.", "find-creator") },
  // The brief and the policy check
  EMPTY_BRIEF: { title: "Empty brief", next: plain("Describe the shot in a few words, then try again.", "edit-brief") },
  NO_RENDER: { title: "Render not found", next: plain("Reload the page; the image may belong to another account.") },
  NOT_FLAGGED: { title: "No alternative for this image", next: plain("Only an image the output review flagged can have an alternative.") },
  ALTERNATIVE_USED: { title: "Alternative already made", next: plain("Each flagged image can have one alternative; it's in Your renders.") },
  UNSUPPORTED_SIZE: { title: "Shape not available", next: plain("Choose one of the shapes offered and try again."), uncharged: true },
  BANNED_USE: { title: "Banned use", next: plain("Political, adult, minor-related, impersonating and deceptive uses are never allowed. Change the brief and try again.", "edit-brief") },
  OUTSIDE_LICENSED_USE: { title: "Outside the licensed use", next: plain("This licence covers one use only. Rewrite the brief for that use, or request a licence for the other one.", "edit-brief") },
  MODEL_REFUSED: { title: "Refused by the policy model", next: plain("Rephrase the brief and try again; the reason is shown above.", "edit-brief") },
  POLICY_CHECK_FAILED: { title: "Policy check couldn't run", next: plain("Try again in a minute; this is usually temporary.", "retry"), uncharged: true },
  // The consent gate and the output review
  NO_PERSON: { title: "No person in the image", next: plain("Try again; a brief that clearly features the person helps.", "retry"), uncharged: true },
  MULTIPLE_PEOPLE: { title: "More than one person", next: plain("Remove other people from the brief and try again.", "edit-brief"), uncharged: true },
  FACE_NOT_VISIBLE: { title: "Face not fully visible", next: plain("Ask for the full face in frame (a medium close-up works well) and try again.", "edit-brief"), uncharged: true },
  FACE_MISMATCH: { title: "Face doesn't match the creator", next: plain("Try again; a new image may match better.", "retry"), uncharged: true },
  GATE_ERROR: { title: "Consent check couldn't run", next: plain("Try again in a minute.", "retry"), uncharged: true },
  REVIEW_BLOCKED: { title: "Blocked by the output review", next: plain("Change the brief and try again.", "edit-brief"), uncharged: true },
  REVIEW_ERROR: { title: "Output review couldn't run", next: plain("Try again in a minute.", "retry"), uncharged: true },
  REVIEW_FLAG: { title: "Flagged by the output review", next: plain("Delivered, but it may not match the brief (product or setting). Check it before use.") },
  // Service
  RATE_LIMITED: { title: "Too many requests", next: plain("Wait a moment, then try again.", "retry") },
  SERVICE_UNAVAILABLE: { title: "A service is unavailable", next: plain("Try again in a minute.", "retry"), uncharged: true },
  TIMEOUT: { title: "Took too long", next: plain("Try again; if it keeps happening, try a shorter brief.", "retry"), uncharged: true },
  NOT_JUDGE: { title: "Judge accounts only", next: plain("Only the demo judge accounts can reset the demo.") },
  UNKNOWN: { title: "Something went wrong", next: plain("Try again; if it keeps failing, the details are above.", "retry"), uncharged: true },
} satisfies Record<string, Reason>;

export type ReasonCode = keyof typeof REASONS;

/** The reason for an error code (or HTTP status when there is no code). */
export function reasonFor(code: string | null | undefined, status?: number): Reason & { code: ReasonCode } {
  if (code && code in REASONS) return { code: code as ReasonCode, ...REASONS[code as ReasonCode] };
  if (status === 429) return { code: "RATE_LIMITED", ...REASONS.RATE_LIMITED };
  if (status === 504) return { code: "TIMEOUT", ...REASONS.TIMEOUT };
  if (status && status >= 502) return { code: "SERVICE_UNAVAILABLE", ...REASONS.SERVICE_UNAVAILABLE };
  return { code: "UNKNOWN", ...REASONS.UNKNOWN };
}

/** The reason sentence for an image blocked after it was made, live or reopened from its stored record. */
export function blockedSentence(by: "consent" | "review" | "payment", explanation: string): string {
  return by === "payment" ? explanation : `Image blocked by the ${by === "consent" ? "consent gate" : "output review"}: ${explanation}`;
}

/** The error card's reason sentence: the detail, ending with "Nothing was charged." once when nothing was. */
export function reasonSentence(detail: string, uncharged: boolean): string {
  const d = detail.trim();
  if (!uncharged || /nothing was charged/i.test(d)) return d;
  return d ? `${d}${/[.!?]$/.test(d) ? "" : "."} Nothing was charged.` : "Nothing was charged.";
}
