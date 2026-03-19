import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  values: number[];
  unit: string;
};

type HistogramBin = {
  start: number;
  end: number;
  mid: number;
  count: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) {
    return value.toExponential(3);
  }
  return value.toFixed(3);
}

function computeStats(values: number[]) {
  const count = values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const stdDev = Math.sqrt(variance);

  return { count, min, max, mean, stdDev };
}

function buildHistogram(values: number[], binWidth: number): HistogramBin[] {
  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const safeWidth = Math.max(binWidth, Number.EPSILON);

  if (max === min) {
    return [{
      start: min - safeWidth / 2,
      end: min + safeWidth / 2,
      mid: min,
      count: values.length,
    }];
  }

  const start = Math.floor(min / safeWidth) * safeWidth;
  const end = Math.ceil(max / safeWidth) * safeWidth;
  const binCount = Math.max(1, Math.ceil((end - start) / safeWidth));
  const bins = Array.from({ length: binCount }, (_, index) => {
    const binStart = start + index * safeWidth;
    return {
      start: binStart,
      end: binStart + safeWidth,
      mid: binStart + safeWidth / 2,
      count: 0,
    };
  });

  for (const value of values) {
    const index = clamp(Math.floor((value - start) / safeWidth), 0, bins.length - 1);
    bins[index].count += 1;
  }

  return bins;
}

async function downloadSvgAsPng(svg: SVGSVGElement, filename: string) {
  const serialized = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to render histogram image."));
      img.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 1100;
    canvas.height = 620;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context is unavailable.");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (!blob) throw new Error("Failed to export histogram image.");

    const pngUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(pngUrl);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export default function HistogramPanel({ values, unit }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const stats = useMemo(() => computeStats(values), [values]);

  const { sliderMin, sliderMax, sliderStep, defaultBinWidth } = useMemo(() => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, Math.abs(max) * 0.1, 1);
    const nextSliderMin = Math.max(range / 200, 0.001);
    const nextSliderMax = Math.max(range * 1.2, nextSliderMin * 10);
    const nextStep = Math.max((nextSliderMax - nextSliderMin) / 400, 0.001);
    const nextDefault = clamp(range / Math.min(10, values.length), nextSliderMin, nextSliderMax);

    return {
      sliderMin: nextSliderMin,
      sliderMax: nextSliderMax,
      sliderStep: nextStep,
      defaultBinWidth: nextDefault,
    };
  }, [values]);

  const [binWidth, setBinWidth] = useState(defaultBinWidth);

  useEffect(() => {
    setBinWidth(defaultBinWidth);
  }, [defaultBinWidth]);

  const bins = useMemo(() => buildHistogram(values, binWidth), [values, binWidth]);
  const maxCount = Math.max(...bins.map(bin => bin.count), 1);
  const activeBin = hoveredIndex === null ? null : bins[hoveredIndex] ?? null;

  const chartWidth = 1100;
  const chartHeight = 620;
  const margin = { top: 36, right: 30, bottom: 96, left: 72 };
  const plotWidth = chartWidth - margin.left - margin.right;
  const plotHeight = chartHeight - margin.top - margin.bottom;
  const gap = bins.length > 24 ? 4 : 8;
  const barWidth = Math.max((plotWidth - gap * Math.max(0, bins.length - 1)) / Math.max(bins.length, 1), 12);
  const labelEvery = Math.max(1, Math.ceil(bins.length / 8));

  const statCards = [
    { label: "樣本數", value: `${stats.count}` },
    { label: "平均值", value: `${formatNumber(stats.mean)} ${unit}` },
    { label: "最小值", value: `${formatNumber(stats.min)} ${unit}` },
    { label: "最大值", value: `${formatNumber(stats.max)} ${unit}` },
    { label: "標準差", value: `${formatNumber(stats.stdDev)} ${unit}` },
  ];

  return (
    <section
      style={{
        marginTop: 16,
        padding: 16,
        border: "1px solid #ddd",
        borderRadius: 12,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>互動式長條圖</div>
          <div style={{ color: "#666", marginTop: 4 }}>
            X 軸為 distance 區間中值（{unit}），Y 軸為次數；滑鼠移到長條上可查看區間資訊。
          </div>
        </div>
        <button onClick={() => svgRef.current && void downloadSvgAsPng(svgRef.current, "measurement_histogram.png")}>
          下載圖檔
        </button>
      </div>

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        {statCards.map(card => (
          <div
            key={card.label}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#f8fafc",
            }}
          >
            <div style={{ color: "#64748b", fontSize: 13 }}>{card.label}</div>
            <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18, color: "#0f172a" }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 18,
          padding: 14,
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          background: "#f8fafc",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor="bin-width-slider" style={{ fontWeight: 600 }}>組距調整</label>
          <div style={{ color: "#334155" }}>
            目前組距：<b>{formatNumber(binWidth)}</b> {unit}
          </div>
        </div>

        <input
          id="bin-width-slider"
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={sliderStep}
          value={binWidth}
          onChange={(event) => setBinWidth(Number(event.target.value))}
          style={{ width: "100%", maxWidth: 520, marginTop: 12, accentColor: "#2563eb" }}
        />

        <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>
          拉桿已加長，方便更細緻地調整組距。
        </div>
      </div>

      <div style={{ marginTop: 18, overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          width="100%"
          role="img"
          aria-label="Measurement histogram"
        >
          <rect x={0} y={0} width={chartWidth} height={chartHeight} fill="#ffffff" />

          {Array.from({ length: maxCount + 1 }, (_, index) => {
            const y = margin.top + plotHeight - (index / maxCount) * plotHeight;
            return (
              <g key={`grid-${index}`}>
                <line
                  x1={margin.left}
                  y1={y}
                  x2={margin.left + plotWidth}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeDasharray={index === 0 ? undefined : "5 5"}
                />
                <text x={margin.left - 12} y={y + 5} textAnchor="end" fill="#475569" fontSize="14">
                  {index}
                </text>
              </g>
            );
          })}

          <line x1={margin.left} y1={margin.top + plotHeight} x2={margin.left + plotWidth} y2={margin.top + plotHeight} stroke="#0f172a" strokeWidth="2" />
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke="#0f172a" strokeWidth="2" />

          <text x={chartWidth / 2} y={chartHeight - 18} textAnchor="middle" fill="#0f172a" fontSize="18" fontWeight="700">
            distance ({unit}) / 區間中值
          </text>
          <text
            x={26}
            y={chartHeight / 2}
            textAnchor="middle"
            fill="#0f172a"
            fontSize="18"
            fontWeight="700"
            transform={`rotate(-90, 26, ${chartHeight / 2})`}
          >
            次數
          </text>

          {bins.map((bin, index) => {
            const x = margin.left + index * (barWidth + gap);
            const height = (bin.count / maxCount) * plotHeight;
            const y = margin.top + plotHeight - height;
            const highlighted = hoveredIndex === index;

            return (
              <g key={`${bin.start}-${bin.end}`}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(height, 2)}
                  rx={4}
                  fill={highlighted ? "#1d4ed8" : "#60a5fa"}
                  stroke={highlighted ? "#1e3a8a" : "#2563eb"}
                  strokeWidth={highlighted ? 3 : 1.5}
                  style={{ cursor: "pointer", transition: "all 120ms ease" }}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(current => (current === index ? null : current))}
                />
                <text x={x + barWidth / 2} y={y - 10} textAnchor="middle" fill="#0f172a" fontSize="13" fontWeight="700">
                  {bin.count}
                </text>
                {(index % labelEvery === 0 || index === bins.length - 1) && (
                  <text
                    x={x + barWidth / 2}
                    y={margin.top + plotHeight + 22}
                    textAnchor="end"
                    fill="#475569"
                    fontSize="12"
                    transform={`rotate(-35, ${x + barWidth / 2}, ${margin.top + plotHeight + 22})`}
                  >
                    {formatNumber(bin.mid)}
                  </text>
                )}
              </g>
            );
          })}

          {activeBin ? (
            <g>
              <rect x={chartWidth - 280} y={46} width={220} height={96} rx={10} fill="#eff6ff" stroke="#93c5fd" />
              <text x={chartWidth - 260} y={76} fill="#1e3a8a" fontSize="16" fontWeight="700">
                Hover 資訊
              </text>
              <text x={chartWidth - 260} y={100} fill="#1e293b" fontSize="14">
                中值：{formatNumber(activeBin.mid)} {unit}
              </text>
              <text x={chartWidth - 260} y={122} fill="#1e293b" fontSize="14">
                區間：{formatNumber(activeBin.start)} ~ {formatNumber(activeBin.end)} {unit}
              </text>
              <text x={chartWidth - 260} y={144} fill="#1e293b" fontSize="14">
                次數：{activeBin.count}
              </text>
            </g>
          ) : (
            <text x={chartWidth - 170} y={82} fill="#64748b" fontSize="14" textAnchor="middle">
              將滑鼠移到長條上查看詳細資訊
            </text>
          )}
        </svg>
      </div>
    </section>
  );
}
