import type { Point } from "./types";
import { EPS } from "./math";

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < 1e-6;
}

function dedupe(points: Point[]) {
  const out: Point[] = [];
  for (const p of points) {
    if (!out.some(q => nearlyEqual(p.x, q.x) && nearlyEqual(p.y, q.y))) out.push(p);
  }
  return out;
}

// p(t)=p0 + t*dir  (dir 不必是 unit vector)
export function clipInfiniteLineToRect(
  p0: Point,
  dir: Point,
  w: number,
  h: number
): [Point, Point] | null {
  if (Math.abs(dir.x) < EPS && Math.abs(dir.y) < EPS) return null;

  const pts: Point[] = [];

  // x = 0, x = w
  if (Math.abs(dir.x) >= EPS) {
    for (const xBound of [0, w]) {
      const t = (xBound - p0.x) / dir.x;
      const y = p0.y + t * dir.y;
      if (y >= 0 && y <= h) pts.push({ x: xBound, y });
    }
  }

  // y = 0, y = h
  if (Math.abs(dir.y) >= EPS) {
    for (const yBound of [0, h]) {
      const t = (yBound - p0.y) / dir.y;
      const x = p0.x + t * dir.x;
      if (x >= 0 && x <= w) pts.push({ x, y: yBound });
    }
  }

  const uniq = dedupe(pts);
  if (uniq.length < 2) return null;

  // 取距離最遠的一對，避免角落多點時挑錯
  let bestA = uniq[0], bestB = uniq[1], bestD = -1;
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const dx = uniq[i].x - uniq[j].x;
      const dy = uniq[i].y - uniq[j].y;
      const d = dx * dx + dy * dy;
      if (d > bestD) {
        bestD = d;
        bestA = uniq[i];
        bestB = uniq[j];
      }
    }
  }
  return [bestA, bestB];
}
