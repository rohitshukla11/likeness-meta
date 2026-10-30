import "server-only";
/**
 * Face-aware label placement for image renders:
 *  - labelSpot: where the visible label goes, bottom-left by default, away from the face and from
 *    the area directly below it (where hands holding a product usually are; hands aren't detected);
 *  - faceBoxes: the faces in an image as boxes, best first.
 */
import { analyseFaces } from "./facematch";

export type Box = { x: number; y: number; w: number; h: number };

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The label's top-left corner: the first safe corner of bottom-left, bottom-right, top-left, top-right. */
export function labelSpot(W: number, H: number, label: { w: number; h: number }, faces: Box[]): { x: number; y: number; corner: string } {
  const m = Math.round(Math.min(W, H) * 0.04);
  const corners = [
    { corner: "bottom-left", x: m, y: H - label.h - m },
    { corner: "bottom-right", x: W - label.w - m, y: H - label.h - m },
    { corner: "top-left", x: m, y: m },
    { corner: "top-right", x: W - label.w - m, y: m },
  ];
  // Keep clear of each face (with a margin) and of the column below it, down to the bottom edge.
  const avoid = faces.flatMap((f) => [
    { x: f.x - f.w * 0.15, y: f.y - f.h * 0.15, w: f.w * 1.3, h: f.h * 1.3 },
    { x: f.x - f.w * 0.5, y: f.y + f.h, w: f.w * 2, h: H - (f.y + f.h) },
  ]);
  const free = corners.find((c) => avoid.every((a) => !overlaps({ x: c.x, y: c.y, w: label.w, h: label.h }, a)));
  return free ?? corners[0];
}

const toBox = (b: [number, number, number, number]): Box => ({ x: b[0], y: b[1], w: b[2], h: b[3] });

/** Faces in an image as boxes, best first. */
export async function faceBoxes(bytes: Uint8Array): Promise<{ width: number; height: number; faces: Box[] }> {
  const a = await analyseFaces(bytes);
  return { width: a.width, height: a.height, faces: a.faces.map((f) => toBox(f.box)) };
}
