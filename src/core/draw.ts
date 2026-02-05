import type { Mode, Point } from "./types";
import { norm, perp, sub } from "./math";

type Transform = (p: Point) => Point;

export function drawLine(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  toCanvas: Transform,
  width = 1,
) {
  const A = toCanvas(a);
  const B = toCanvas(b);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.stroke();
}

export function drawDot(
  ctx: CanvasRenderingContext2D,
  p: Point,
  toCanvas: Transform,
  r = 3,
) {
  const P = toCanvas(p);
  ctx.beginPath();
  ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawNormalTicks(
  ctx: CanvasRenderingContext2D,
  p1: Point,
  p2: Point,
  toCanvas: Transform,
  mode: Mode,
  options: { length?: number; width?: number } = {},
) {
  const v = sub(p2, p1);
  const n = norm(perp(v));
  if (!n) return;

  const length = options.length ?? 16;
  const width = options.width ?? 1;
  const half = length / 2;

  const drawTick = (p: Point) => {
    const a = { x: p.x - n.x * half, y: p.y - n.y * half };
    const b = { x: p.x + n.x * half, y: p.y + n.y * half };
    drawLine(ctx, a, b, toCanvas, width);
  };

  if (mode === "pp") {
    drawTick(p1);
    drawTick(p2);
    return;
  }

  if (mode === "pl") {
    drawTick(p1);
    return;
  }

  drawTick(p1);
  drawTick(p2);
}
