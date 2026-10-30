import type { Aspect } from "@/lib/creative";
export type RenderInput = {
  prompt: string;
  /** Decrypted reference frames (JPEG). The renderer must not keep them. */
  references: Uint8Array[];
  /** The brand's product photo, sent after the references (multi-image). Absent: the request is as in likeness-ai. */
  product?: { bytes: Uint8Array; mime: "image/jpeg" | "image/png" };
  licenceId: string;
  renderIndex: number;
  aspectRatio?: Aspect;
};

export type RenderOutput = {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  provider: "gemini";
  model: string;
  test: false;
  /** Provider-reported usage (Gemini usageMetadata), for cost accounting. */
  usage?: Record<string, unknown>;
};
