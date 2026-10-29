import "server-only";
/**
 * PersonSegmenter on this server: YuNet face detection (lib/server/facematch.ts). It finds faces, not
 * bodies, and gives no masks, so it counts people by their faces: a person whose face isn't visible is
 * not counted. The fallback when SAM 3.1 isn't used (AI_PROVIDER=google).
 */
import { analyseFaces } from "../../facematch";
import type { PeopleDetection, PersonSegmenter } from "../types";

export const localFaceSegmenter: PersonSegmenter = {
  async detectPeople(image): Promise<PeopleDetection> {
    const t = Date.now();
    const a = await analyseFaces(image.bytes);
    const faces = a.faces.map((f) => ({ x: f.box[0] / a.width, y: f.box[1] / a.height, w: f.box[2] / a.width, h: f.box[3] / a.height, score: f.score }));
    return { count: faces.length, boxes: faces, masks: [], faces, metrics: { provider: "local", model: "YuNet (face_detection_yunet_2023mar)", latencyMs: Date.now() - t, costUsd: 0 } };
  },
};
