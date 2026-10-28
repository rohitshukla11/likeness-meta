/**
 * Use categories and regions. The banned set is never allowed under any licence: every prompt is checked
 * against it (lib/server/filter.ts) before a render.
 */

export const BANNED = [
  { bit: 1 << 0, key: "political", label: "Political" },
  { bit: 1 << 1, key: "adult", label: "Adult" },
  { bit: 1 << 2, key: "minors", label: "Anything involving minors" },
  { bit: 1 << 3, key: "impersonation", label: "Impersonation" },
  { bit: 1 << 4, key: "deception", label: "Deception" },
] as const;
export const BANNED_MASK = 0x1f | 0xe0;

export const CATEGORIES = [
  { bit: 1 << 8, key: "advertising", label: "Advertising" },
  { bit: 1 << 9, key: "social", label: "Social" },
  { bit: 1 << 10, key: "editorial", label: "Editorial" },
  { bit: 1 << 11, key: "entertainment", label: "Entertainment" },
  { bit: 1 << 12, key: "product", label: "Product" },
] as const;
export const ALLOWED_MASK = CATEGORIES.reduce((m, c) => m | c.bit, 0);

export type CategoryKey = (typeof CATEGORIES)[number]["key"];

/** Region bits: defined for licence terms, not used by the licence flow yet. */
export const REGIONS = [
  { bit: 1 << 0, key: "na", label: "North America" },
  { bit: 1 << 1, key: "latam", label: "Latin America" },
  { bit: 1 << 2, key: "eu", label: "Europe" },
  { bit: 1 << 3, key: "uk", label: "United Kingdom" },
  { bit: 1 << 4, key: "mea", label: "Middle East and Africa" },
  { bit: 1 << 5, key: "apac", label: "Asia-Pacific" },
] as const;
export const ALL_REGIONS = REGIONS.reduce((m, r) => m | r.bit, 0);

export function categoryLabels(mask: number): string[] {
  return CATEGORIES.filter((c) => mask & c.bit).map((c) => c.label);
}

export function categoryByKey(key: string) {
  return CATEGORIES.find((c) => c.key === key);
}

export function regionLabels(mask: number): string[] {
  if ((mask & ALL_REGIONS) === ALL_REGIONS) return ["Worldwide"];
  return REGIONS.filter((r) => mask & r.bit).map((r) => r.label);
}

/** Same rule as Categories.requireAllowedSet. */
export function isAllowedSet(mask: number): boolean {
  return mask !== 0 && (mask & BANNED_MASK) === 0 && (mask & ~ALLOWED_MASK) === 0;
}

/** Same rule as Categories.requireLicensable: exactly one allowed bit. */
export function isLicensable(category: number): boolean {
  return isAllowedSet(category) && (category & (category - 1)) === 0;
}
