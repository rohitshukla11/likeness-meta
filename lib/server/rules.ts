/**
 * The banned-use keyword rules: the prompt filter's first layer, always on. Cheap, deterministic and
 * blunt; the model check (lib/server/filter.ts) runs after them. Pure: no server dependencies.
 */
import { BANNED } from "@/lib/categories";

type Rule = { key: (typeof BANNED)[number]["key"]; patterns: RegExp[] };

const w = (words: string) => new RegExp(`\\b(?:${words})\\b`, "i");

export const RULES: Rule[] = [
  {
    key: "political",
    patterns: [
      w("election|elections|vote for|voting for|ballot|candidate|campaign rally|political|politician|senator|congress(?:man|woman)?|parliament|prime minister|president(?:ial)?|democrat|republican|party manifesto|referendum|propaganda"),
    ],
  },
  {
    key: "adult",
    patterns: [w("nude|nudity|naked|topless|nsfw|porn\\w*|sexual|sexy|erotic|explicit|lingerie|fetish|onlyfans|strip(?:per|tease)|undress\\w*")],
  },
  {
    key: "minors",
    patterns: [w("child|children|kid|kids|minor|minors|underage|teen|teenage|teenager|schoolgirl|schoolboy|toddler|baby|infant|preteen|young girl|young boy|\\d{1,2}[- ]?year[- ]?old")],
  },
  {
    key: "impersonation",
    patterns: [
      w("pretend(?:ing)? to be|posing as|impersonat\\w*|as if (?:she|he|they) (?:were|was) (?:a )?(?:celebrity|famous)|official statement from|on behalf of|endorsed by|signature of"),
    ],
  },
  {
    key: "deception",
    patterns: [
      w("deepfake|fake news|hoax|scam|fraud\\w*|misinformation|disinformation|fake (?:testimonial|review|evidence|receipt|id|document)|crime scene|mugshot|arrest\\w*|confess\\w*|caught (?:doing|stealing)|real footage"),
    ],
  },
];

export function ruleCheck(prompt: string): string[] {
  const hits: string[] = [];
  for (const r of RULES) {
    const m = r.patterns.map((p) => p.exec(prompt)).find(Boolean);
    if (m) hits.push(`${BANNED.find((b) => b.key === r.key)!.label}: “${m[0]}”`);
  }
  return hits;
}
