import type { Point } from "./types";

export type Viewport = {
  scale: number;     // image -> canvas(css px)
  offsetX: number;   // canvas(css px)
  offsetY: number;   // canvas(css px)
  drawW: number;
  drawH: number;
};

export function computeContainViewport(
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
  padding = 16
): Viewport {
  const aw = Math.max(1, canvasW - padding * 2);
  const ah = Math.max(1, canvasH - padding * 2);
  const scale = Math.min(aw / imgW, ah / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const offsetX = (canvasW - drawW) / 2;
  const offsetY = (canvasH - drawH) / 2;
  return { scale, offsetX, offsetY, drawW, drawH };
}

export function imgToCanvas(p: Point, vp: Viewport): Point {
  return { x: vp.offsetX + p.x * vp.scale, y: vp.offsetY + p.y * vp.scale };
}

export function canvasToImg(p: Point, vp: Viewport): Point {
  return { x: (p.x - vp.offsetX) / vp.scale, y: (p.y - vp.offsetY) / vp.scale };
}

export function isInsideImage(pImg: Point, imgW: number, imgH: number): boolean {
  return pImg.x >= 0 && pImg.y >= 0 && pImg.x <= imgW && pImg.y <= imgH;
}
