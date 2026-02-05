import type { Mode, Point } from "./types";
import { norm, perp, sub } from "./math";

export const NORMAL_MARK_LENGTH = 18;

export function getNormalSegments(
  p1: Point,
  p2: Point,
  mode: Mode,
  length: number = NORMAL_MARK_LENGTH,
): [Point, Point][] {
  const v = sub(p2, p1);
  const n = norm(perp(v));
  if (!n) return [];

  const half = length / 2;
  const centers: Point[] = [p1];
  if (mode === "ll" || mode === "pp") {
    centers.push(p2);
  }

  return centers.map(center => [
    { x: center.x - n.x * half, y: center.y - n.y * half },
    { x: center.x + n.x * half, y: center.y + n.y * half },
  ]);
}
