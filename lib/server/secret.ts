import "server-only";
/**
 * A server secret (PEM, JSON) from an env value or from a file the env names. Locally each secret
 * stays in its file under .secrets/ (mode 0600); a hosted deployment such as Cloud Run has no such
 * files and passes the value instead. A value may carry its newlines escaped as \n. Never logged.
 */
import { existsSync, readFileSync } from "node:fs";

export function secretText(valueVar: string, fileVar: string, defaultFile?: string): string | null {
  const value = process.env[valueVar];
  if (value) return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
  const file = process.env[fileVar] ?? defaultFile;
  if (!file || !existsSync(/*turbopackIgnore: true*/ file)) return null;
  return readFileSync(/*turbopackIgnore: true*/ file, "utf8");
}
