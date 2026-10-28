import { listedCreators, publicCreator } from "@/lib/server/creators";
import { route } from "@/lib/server/route";

export const GET = route(async () => ({ creators: (await listedCreators()).map(publicCreator) }));
