/**
 * Use categories. The banned set is never allowed under any licence: every prompt is checked against it
 * (lib/server/filter.ts) before a render.
 */

export const BANNED = [
  { bit: 1 << 0, key: "political", label: "Political" },
  { bit: 1 << 1, key: "adult", label: "Adult" },
  { bit: 1 << 2, key: "minors", label: "Anything involving minors" },
  { bit: 1 << 3, key: "impersonation", label: "Impersonation" },
  { bit: 1 << 4, key: "deception", label: "Deception" },
] as const;

export const CATEGORIES = [
  { bit: 1 << 8, key: "advertising", label: "Advertising" },
  { bit: 1 << 9, key: "social", label: "Social" },
  { bit: 1 << 10, key: "editorial", label: "Editorial" },
  { bit: 1 << 11, key: "entertainment", label: "Entertainment" },
  { bit: 1 << 12, key: "product", label: "Product" },
] as const;
