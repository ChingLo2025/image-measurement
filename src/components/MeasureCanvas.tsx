import React, { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import type { Measurement, Mode, Point } from "../core/types";
import { norm, perp, sub } from "../core/math";
import { clipInfiniteLineToRect } from "../core/clip";
import {
  canvasToImg,
  computeContainViewport,
  imgToCanvas,
  isInsideImage,
} from "../core/viewport";

type Props = {
  image: HTMLImageElement | null;
  mode: Mode;
  measurements: Measurement[];
  currentP1: Point | null;
  onPickPoint: (pImg: Point) => void;
  onHover: (pImg: Point | null) => void;
};

export type MeasureCanvasHandle = {
  downloadPng: () => void;
};

const MeasureCanvas = forwardRef<MeasureCanvasHandle, Props>(function MeasureCanvas({
  image,
  mode,
  measurements,
  currentP1,
  onPickPoint,
  onHover,
}, ref) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });

  useImperativeHandle(ref, () => ({
    downloadPng() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "sem_measurement.png";
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    },
  }));

  // ResizeObserver：避免 CSS 尺寸變了但 canvas 不重畫
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setSize({ w: Math.max(1, cr.width), h: Math.max(1, cr.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const vp = useMemo(() => {
    if (!image) return null;
    return computeContainViewport(image.width, image.height, size.w, size.h, 16);
  }, [image, size.w, size.h]);

  // hover point 存在這裡純粹為了預覽線
  const [hoverImg, setHoverImg] = useState<Point | null>(null);

  function pointerToCanvasPoint(e: React.PointerEvent): Point {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleMove(e: React.PointerEvent) {
    if (!image || !vp) return;
    const pCanvas = pointerToCanvasPoint(e);
    const pImg = canvasToImg(pCanvas, vp);
    const inside = isInsideImage(pImg, image.width, image.height);
    const p = inside ? pImg : null;
    setHoverImg(p);
    onHover(p);
  }

  function handleLeave() {
    setHoverImg(null);
    onHover(null);
  }

  function handleClick(e: React.PointerEvent) {
    if (!image || !vp) return;
    const pCanvas = pointerToCanvasPoint(e);
    const pImg = canvasToImg(pCanvas, vp);
    if (!isInsideImage(pImg, image.width, image.height)) return;
    onPickPoint(pImg);
  }

  // 每次狀態變更就重畫（輕量工具這樣就夠了）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 先把座標系切回 CSS px，後面我們都用 CSS px 畫
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    if (!image || !vp) {
      // empty state
      ctx.fillStyle = "#666";
      ctx.font = "14px system-ui";
      ctx.fillText("Upload an image to start.", 16, 24);
      return;
    }

    // 背景
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, size.w, size.h);

    // 影像
    ctx.drawImage(image, vp.offsetX, vp.offsetY, vp.drawW, vp.drawH);

    const imgW = image.width;
    const imgH = image.height;

    // helpers
    const drawLine = (a: Point, b: Point, width = 1) => {
      const A = imgToCanvas(a, vp);
      const B = imgToCanvas(b, vp);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    };

    // 短法線（|---|風格的端點標記）
    const SHORT_TICK_LEN = 8; // 像素長度（canvas座標）

    const drawShortTick = (p: Point, direction: Point, width = 1.5) => {
      const n = norm(perp(direction));
      if (!n) return;
      const P = imgToCanvas(p, vp);
      const halfLen = SHORT_TICK_LEN;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(P.x - n.x * halfLen, P.y - n.y * halfLen);
      ctx.lineTo(P.x + n.x * halfLen, P.y + n.y * halfLen);
      ctx.stroke();
    };

    const drawAuxNormals = (p1: Point, p2: Point, mode: Mode) => {
      const v = sub(p2, p1);
      const n = norm(perp(v));
      if (!n) return;

      if (mode === "pp") {
        // 點-點：兩端都畫短法線
        drawShortTick(p1, v);
        drawShortTick(p2, v);
      } else if (mode === "pl") {
        // 點-線：p1 長輔助線，p2 短法線
        const seg1 = clipInfiniteLineToRect(p1, n, imgW, imgH);
        if (seg1) drawLine(seg1[0], seg1[1], 1);
        drawShortTick(p2, v);
      } else if (mode === "ll") {
        // 線-線：兩端都畫長輔助線
        const seg1 = clipInfiniteLineToRect(p1, n, imgW, imgH);
        if (seg1) drawLine(seg1[0], seg1[1], 1);
        const seg2 = clipInfiniteLineToRect(p2, n, imgW, imgH);
        if (seg2) drawLine(seg2[0], seg2[1], 1);
      }
    };

    // 已完成量測：留「輔助線」（無端點圓點）
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    for (const m of measurements) {
      drawLine(m.p1, m.p2, 1.5);          // 量測線
      drawAuxNormals(m.p1, m.p2, m.mode); // 輔助線（依模式）
    }

    // 預覽（正在量）
    if (currentP1 && hoverImg) {
      ctx.strokeStyle = "rgba(0,255,255,0.9)";
      ctx.fillStyle = "rgba(0,255,255,0.95)";
      drawLine(currentP1, hoverImg, 1.5);
      drawAuxNormals(currentP1, hoverImg, mode);
    }
  }, [image, vp, size.h, size.w, measurements, currentP1, hoverImg, mode]);

  return (
    <div
      ref={wrapRef}
      style={{
        width: "100%",
        height: "520px",
        border: "1px solid #2a2a2a",
        borderRadius: 8,
        overflow: "hidden",
        background: "#111",
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onPointerDown={handleClick}
        style={{ display: "block", cursor: "crosshair" }}
      />
    </div>
  );
});

export default MeasureCanvas;
