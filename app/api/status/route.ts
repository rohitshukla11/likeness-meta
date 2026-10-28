import { route } from "@/lib/server/route";
import { statusChecks } from "@/lib/server/status";

export const GET = route(async () => ({ service: "likeness-ai", checks: await statusChecks() }));
