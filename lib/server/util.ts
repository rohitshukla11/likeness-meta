import "server-only";
/**
 * Process-wide singletons. Next's dev server can load a module once per route bundle, so state that
 * must be shared across routes (model sessions, caches) hangs off globalThis.
 */
export function singleton<T>(name: string, make: () => T): T {
  const g = globalThis as unknown as Record<string, T>;
  const key = `__likeness_${name}`;
  if (!(key in g)) g[key] = make();
  return g[key];
}
