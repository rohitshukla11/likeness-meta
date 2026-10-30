import { isAdmin } from "@/lib/server/admin";
import { firestore } from "@/lib/server/firebase-admin";
import { docId, HttpError } from "@/lib/server/http";
import { renderIdFor } from "@/lib/server/idempotency";
import { showModelCost } from "@/lib/server/ai/pricing";
import { blockedReason, type BlockedRenderDoc } from "@/lib/server/render-image";
import type { RenderLogDoc } from "@/lib/server/renderLog";
import { authed } from "@/lib/server/route";

/**
 * A render's step log, for the timeline: ?requestId= (the brand's own request, while it runs) or
 * ?renderId= (reopening a past render, delivered or blocked). Only the brand that asked and the creator
 * in it can read it, and admins (the admin view lists every render, development ones included). Text and numbers only.
 */
export const GET = authed(async (req, me) => {
  const q = new URL(req.url).searchParams;
  const requestId = q.get("requestId");
  const id = requestId ? renderIdFor(me.uid, requestId) : docId(q.get("renderId"), "renderId");
  const s = await firestore().collection("renderLogs").doc(id).get();
  const log = s.data() as RenderLogDoc | undefined;
  if (!log) {
    // A just-started request may not have its first write yet.
    if (requestId) return { log: null };
    throw new HttpError(404, "no such render log");
  }
  if (log.brandId !== me.uid && log.creatorId !== me.uid && !isAdmin(me)) throw new HttpError(404, "no such render log");
  // A blocked image's stored reason, so a reopened render shows the same error card as the live one.
  const b = log.status === "blocked" ? ((await firestore().collection("blockedRenders").doc(id).get()).data() as BlockedRenderDoc | undefined) : undefined;
  const blocked = b ? { blockedBy: b.blockedBy ?? "consent", ...blockedReason(b) } : null;
  // Model cost is an estimate, shown unless SHOW_MODEL_COST=0.
  return { log: showModelCost() ? log : { ...log, steps: log.steps.map(({ costUsd: _c, ...s }) => (void _c, s)) }, blocked };
});
