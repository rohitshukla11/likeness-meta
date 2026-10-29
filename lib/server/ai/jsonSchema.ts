/**
 * A small JSON Schema validator for the model answers this app asks for: type, properties, required,
 * additionalProperties: false, enum, items, min/maxItems, min/maxLength. Meta constrains decoding to
 * the schema, but every answer is still checked here before the code uses it: any miss is a refusal.
 * Pure; unsupported keywords are rejected when the schema is defined (assertSupported), not ignored.
 */
export type Schema = {
  type: "object" | "array" | "string" | "boolean" | "number" | "integer";
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: false;
  enum?: readonly string[];
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
};

const KNOWN = new Set(["type", "properties", "required", "additionalProperties", "enum", "items", "minItems", "maxItems", "minLength", "maxLength", "description"]);

/** Throws if the schema uses a keyword this validator doesn't check (so nothing is silently unchecked). */
export function assertSupported(s: Schema, path = "$"): void {
  for (const k of Object.keys(s)) if (!KNOWN.has(k)) throw new Error(`schema keyword "${k}" at ${path} is not checked by jsonSchema.ts`);
  for (const [k, v] of Object.entries(s.properties ?? {})) assertSupported(v, `${path}.${k}`);
  if (s.items) assertSupported(s.items, `${path}[]`);
}

/** Every way `v` misses the schema, as "path: problem"; empty when it conforms. */
export function validate(v: unknown, s: Schema, path = "$"): string[] {
  const errs: string[] = [];
  const typeOk =
    s.type === "object" ? typeof v === "object" && v !== null && !Array.isArray(v)
    : s.type === "array" ? Array.isArray(v)
    : s.type === "integer" ? Number.isInteger(v)
    : s.type === "number" ? typeof v === "number" && Number.isFinite(v)
    : typeof v === s.type;
  if (!typeOk) return [`${path}: expected ${s.type}`];
  if (s.enum && !s.enum.includes(v as string)) errs.push(`${path}: not one of ${s.enum.join(", ")}`);
  if (typeof v === "string") {
    if (s.minLength !== undefined && v.length < s.minLength) errs.push(`${path}: shorter than ${s.minLength}`);
    if (s.maxLength !== undefined && v.length > s.maxLength) errs.push(`${path}: longer than ${s.maxLength}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) errs.push(`${path}: fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(`${path}: more than ${s.maxItems} items`);
    if (s.items) v.forEach((x, i) => errs.push(...validate(x, s.items!, `${path}[${i}]`)));
  }
  if (s.type === "object") {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) errs.push(`${path}.${k}: missing`);
    for (const [k, x] of Object.entries(o)) {
      const p = s.properties?.[k];
      if (p) errs.push(...validate(x, p, `${path}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${path}.${k}: not allowed`);
    }
  }
  return errs;
}
