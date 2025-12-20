import type { Point } from "./types";

export const EPS = 1e-9;

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function len(v: Point): number {
  return Math.hypot(v.x, v.y);
}

export function dist(a: Point, b: Point): number {
  return len(sub(a, b));
}

export function perp(v: Point): Point {
  return { x: -v.y, y: v.x };
}

export function norm(v: Point): Point | null {
  const l = len(v);
  if (l < EPS) return null;
  return { x: v.x / l, y: v.y / l };
}
