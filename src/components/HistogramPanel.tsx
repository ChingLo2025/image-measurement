import { useId, useMemo, useRef, useState } from "react";

type Props = {
  distances: number[];
  unit: string;
};

type Bin = {
  start: number;
  end: number;
  midpoint: number;
  count: number;
};

type Stats = {
  sampleSize: number;
  mean: number;
  min: number;
  max: number;
  stdDev: number;
};

const BASE_CHART_WIDTH = 920;
const CHART_HEIGHT = 420;
const MARGIN = { top: 24, right: 20, bottom: 72, left: 64 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatValue(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) {
    return value.toExponential(2);
  }
  return value.toFixed(2);
}

function buildBins(distances: number[], binWidth: number): Bin[] {
  if (distances.length === 0 || !Number.isFinite(binWidth) || binWidth <= 0) return [];

  const min = Math.min(...distances);
  const max = Math.max(...distances);
  const safeMax = max === min ? min + binWidth : max;
  const start = Math.floor(min / binWidth) * binWidth;
  const binCount = Math.max(1, Math.ceil((safeMax - start) / binWidth));

  const bins = Array.from({ length: binCount }, (_, index) => {
    const binStart = start + index * binWidth;
    const binEnd = binStart + binWidth;
    return {
      start: binStart,
      end: binEnd,
      midpoint: binStart + binWidth / 2,
      count: 0,
    } satisfies Bin;
  });

  for (const value of distances) {
    const rawIndex = Math.floor((value - start) / binWidth);
    const index = clamp(rawIndex, 0, bins.length - 1);
    bins[index].count += 1;
  }

  return bins;
}

function computeStats(distances: number[]): Stats | null {
  if (distances.length === 0) return null;

  const sampleSize = distances.length;
  const total = distances.reduce((sum, value) => sum + value, 0);
  const mean = total / sampleSize;
  const min = Math.min(...distances);
  const max = Math.max(...distances);
  const variance =
    sampleSize > 1
      ? distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sampleSize - 1)
      : 0;

  return {
    sampleSize,
    mean,
    min,
    max,
    stdDev: Math.sqrt(variance),
  };
}

async function downloadSvgAsPng(svg: SVGSVGElement, filename: string) {
  const chartWidth = svg.viewBox.baseVal.width || svg.width.baseVal.value || BASE_CHART_WIDTH;
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svg);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to render chart image"));
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = chartWidth * 2;
    canvas.height = CHART_HEIGHT * 2;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");

    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, chartWidth, CHART_HEIGHT);
    ctx.drawImage(image, 0, 0, chartWidth, CHART_HEIGHT);

    const pngUrl = canvas.toDataURL("image/png");
    const anchor = document.createElement("a");
    anchor.href = pngUrl;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function HistogramPanel({ distances, unit }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gradientId = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const stats = useMemo(() => computeStats(distances), [distances]);
  const range = useMemo(() => {
    if (distances.length === 0) return 1;
    const min = Math.min(...distances);
    const max = Math.max(...distances);
    return Math.max(max - min, Math.abs(max) * 0.05, 1e-6);
  }, [distances]);

  const minStep = useMemo(() => Math.max(range / 80, 1e-6), [range]);
  const maxStep = useMemo(() => Math.max(range * 1.2, minStep), [range, minStep]);
  const [sliderValue, setSliderValue] = useState(120);
  const sliderMax = 1000;
  const binWidth = useMemo(() => {
    const ratio = sliderValue / sliderMax;
    return minStep + (maxStep - minStep) * ratio;
  }, [maxStep, minStep, sliderValue]);

  const bins = useMemo(() => buildBins(distances, binWidth), [distances, binWidth]);
  const maxCount = useMemo(() => Math.max(1, ...bins.map(bin => bin.count)), [bins]);

  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const barGap = 8;
  const naturalPlotWidth = Math.max(BASE_CHART_WIDTH - MARGIN.left - MARGIN.right, bins.length * 28 + Math.max(0, bins.length - 1) * barGap);
  const chartWidth = MARGIN.left + naturalPlotWidth + MARGIN.right;
  const plotWidth = naturalPlotWidth;
  const barWidth = bins.length > 0 ? Math.max(16, (plotWidth - barGap * (bins.length - 1)) / bins.length) : 0;
  const labelStride = bins.length > 14 ? Math.ceil(bins.length / 14) : 1;
  const hoveredBin = hoveredIndex === null ? null : bins[hoveredIndex] ?? null;

  if (!stats) return null;

  return (
    <section className="chart-panel">
      <div className="chart-panel__header">
        <div>
          <h3>互動式長條圖</h3>
          <p>依據量測 distance 資料分組，X 軸顯示區間中值（{unit}），Y 軸顯示次數。</p>
        </div>
        <button onClick={() => svgRef.current && void downloadSvgAsPng(svgRef.current, "measurement_histogram.png")}>下載圖檔 PNG</button>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><span>樣本數</span><strong>{stats.sampleSize}</strong></div>
        <div className="stat-card"><span>平均值</span><strong>{formatValue(stats.mean)} {unit}</strong></div>
        <div className="stat-card"><span>最小值</span><strong>{formatValue(stats.min)} {unit}</strong></div>
        <div className="stat-card"><span>最大值</span><strong>{formatValue(stats.max)} {unit}</strong></div>
        <div className="stat-card"><span>標準差</span><strong>{formatValue(stats.stdDev)} {unit}</strong></div>
      </div>

      <div className="slider-card">
        <div className="slider-card__label-row">
          <label htmlFor="bin-width-range">組距調整</label>
          <strong>{formatValue(binWidth)} {unit}</strong>
        </div>
        <input
          id="bin-width-range"
          className="bin-slider"
          type="range"
          min={0}
          max={sliderMax}
          step={1}
          value={sliderValue}
          onChange={(event) => setSliderValue(Number(event.target.value))}
        />
        <div className="slider-card__range-row">
          <span>較細：{formatValue(minStep)} {unit}</span>
          <span>較粗：{formatValue(maxStep)} {unit}</span>
        </div>
      </div>

      <div className="chart-surface">
        <svg ref={svgRef} width={chartWidth} height={CHART_HEIGHT} viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`} role="img" aria-label="Measurement histogram">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f8cff" />
              <stop offset="100%" stopColor="#82cfff" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={chartWidth} height={CHART_HEIGHT} fill="#ffffff" rx="16" />

          {Array.from({ length: 5 }, (_, index) => {
            const value = Math.round((maxCount / 4) * (4 - index));
            const y = MARGIN.top + (plotHeight / 4) * index;
            return (
              <g key={index}>
                <line x1={MARGIN.left} y1={y} x2={chartWidth - MARGIN.right} y2={y} stroke="#dbe4f0" strokeDasharray="4 4" />
                <text x={MARGIN.left - 12} y={y + 4} textAnchor="end" fontSize="12" fill="#516072">{value}</text>
              </g>
            );
          })}

          <line x1={MARGIN.left} y1={MARGIN.top + plotHeight} x2={chartWidth - MARGIN.right} y2={MARGIN.top + plotHeight} stroke="#324152" strokeWidth="1.5" />
          <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={MARGIN.top + plotHeight} stroke="#324152" strokeWidth="1.5" />

          {bins.map((bin, index) => {
            const x = MARGIN.left + index * (barWidth + barGap);
            const height = maxCount === 0 ? 0 : (bin.count / maxCount) * plotHeight;
            const y = MARGIN.top + plotHeight - height;
            const isHovered = hoveredIndex === index;

            return (
              <g key={`${bin.start}-${bin.end}`} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(height, 1)}
                  rx="8"
                  fill={isHovered ? "#2457d6" : `url(#${gradientId})`}
                  opacity={bin.count === 0 ? 0.35 : 1}
                />
                <text x={x + barWidth / 2} y={MARGIN.top + plotHeight + 20} textAnchor="middle" fontSize="11" fill="#516072">
                  {index % labelStride === 0 ? formatValue(bin.midpoint) : ""}
                </text>
                <text x={x + barWidth / 2} y={Math.max(y - 8, MARGIN.top + 12)} textAnchor="middle" fontSize="11" fill="#223041">
                  {bin.count > 0 ? bin.count : ""}
                </text>
              </g>
            );
          })}

          <text x={chartWidth / 2} y={CHART_HEIGHT - 18} textAnchor="middle" fontSize="13" fill="#223041">
            distance ({unit}) — 區間中值
          </text>
          <text x="18" y={CHART_HEIGHT / 2} textAnchor="middle" fontSize="13" fill="#223041" transform={`rotate(-90 18 ${CHART_HEIGHT / 2})`}>
            次數
          </text>
        </svg>

        {hoveredBin && (
          <div className="chart-tooltip">
            <div><strong>中值：</strong>{formatValue(hoveredBin.midpoint)} {unit}</div>
            <div><strong>區間：</strong>{formatValue(hoveredBin.start)} - {formatValue(hoveredBin.end)} {unit}</div>
            <div><strong>次數：</strong>{hoveredBin.count}</div>
          </div>
        )}
      </div>
    </section>
  );
}
