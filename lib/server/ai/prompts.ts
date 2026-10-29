/**
 * Instructions shared by the providers' models. FILTER_INSTRUCTION is likeness-ai's prompt-screening
 * instruction, unchanged; both the Gemini and the Muse Spark policy checks use it.
 */
import { BANNED } from "@/lib/categories";

export const FILTER_INSTRUCTION = `You screen prompts for an image generator that renders a real, consenting adult's likeness under a licence.
Banned uses, never allowed under any licence:
- political: elections, candidates, parties, policy advocacy;
- adult: sexual or sexualised content, nudity;
- minors: anything involving minors or a childlike depiction;
- impersonation: presenting the person as someone else, or as endorsing or saying something they did not;
- deception: fake news, fake evidence, fake testimonials, depicting crimes or events as real.
The licence covers exactly one use category. Decide whether the prompt fits it.
Return JSON matching the schema.`;

/** The banned uses, as the model is told them (keys match lib/categories.ts BANNED). */
export const BANNED_KEYS = BANNED.map((b) => b.key);
