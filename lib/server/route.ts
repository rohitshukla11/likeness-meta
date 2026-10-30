import "server-only";
import { requireUser, type Caller } from "./authn";
import { fail, json } from "./http";

type Ctx<P> = { params: Promise<P> };

/** A route handler with JSON errors; `authed` also requires a signed-in Firebase user. */
export function route<P = Record<string, string>>(f: (req: Request, params: P) => Promise<unknown>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const out = await f(req, await ctx.params);
      return out instanceof Response ? out : json(out);
    } catch (e) {
      return fail(e);
    }
  };
}

export function authed<P = Record<string, string>>(f: (req: Request, me: Caller, params: P) => Promise<unknown>) {
  return route<P>(async (req, params) => f(req, await requireUser(req), params));
}

export async function body<T>(req: Request): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}

export const b64bytes = (s: string) => new Uint8Array(Buffer.from(String(s).replace(/^data:[^;]+;base64,/, ""), "base64"));
