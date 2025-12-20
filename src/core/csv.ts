import type { Calibration, Measurement } from "./types";

function sanitizeUnitForHeader(unit: string) {
  // 讓 header 穩定：µm -> um；去空白；去斜線等
  return unit
    .replaceAll("µ", "u")
    .replaceAll("μ", "u")
    .trim()
    .replaceAll(/\s+/g, "")
    .replaceAll("/", "_");
}

export function measurementsToCsv(measurements: Measurement[], cal: Calibration) {
  const u = sanitizeUnitForHeader(cal.unit || "unit");
  const header = `id,distance_${u}`;
  const lines = measurements.map(m => {
    const real = m.px * cal.unitPerPx;
    return `${m.id},${real}`;
  });
  return [header, ...lines].join("\n");
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
