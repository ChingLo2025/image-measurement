import { useMemo, useRef, useState } from "react";
import MeasureCanvas from "./components/MeasureCanvas";
import type { MeasureCanvasHandle } from "./components/MeasureCanvas";
import type { Calibration, Measurement, Mode, Point, Stage } from "./core/types";
import { dist } from "./core/math";
import { downloadTextFile, measurementsToCsv } from "./core/csv";

type HistogramBin = {
  start: number;
  end: number;
  midpoint: number;
  count: number;
};

type SummaryStat = {
  label: string;
  value: string;
};

const CHART_W = 860;
const CHART_H = 420;
const CHART_MARGIN = { top: 24, right: 28, bottom: 72, left: 68 };
const MIN_BIN_COUNT = 3;
const MAX_BIN_COUNT = 40;

function modeIcon(mode: Mode) {
  switch (mode) {
    case "pp":
      return "●──●";
    case "pl":
      return "●──┃";
    case "ll":
      return "┃──┃";
  }
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function computeStats(values: number[], unit: string): SummaryStat[] {
  if (values.length === 0) {
    return [
      { label: "樣本數", value: "0" },
      { label: "平均值", value: `- ${unit}` },
      { label: "最小值", value: `- ${unit}` },
      { label: "最大值", value: `- ${unit}` },
      { label: "標準差", value: `- ${unit}` },
    ];
  }

  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const formatValue = (value: number) => `${value.toFixed(3)} ${unit}`;

  return [
    { label: "樣本數", value: String(n) },
    { label: "平均值", value: formatValue(mean) },
    { label: "最小值", value: formatValue(min) },
    { label: "最大值", value: formatValue(max) },
    { label: "標準差", value: formatValue(stdDev) },
  ];
}

function buildHistogram(values: number[], binCount: number): HistogramBin[] {
  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (Math.abs(max - min) < 1e-9) {
    return [
      {
        start: min - 0.5,
        end: max + 0.5,
        midpoint: min,
        count: values.length,
      },
    ];
  }

  const width = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => {
    const start = min + index * width;
    const end = index === binCount - 1 ? max : start + width;
    return {
      start,
      end,
      midpoint: (start + end) / 2,
      count: 0,
    };
  });

  for (const value of values) {
    const rawIndex = Math.floor((value - min) / width);
    const index = clamp(rawIndex, 0, binCount - 1);
    bins[index].count += 1;
  }

  return bins;
}

function downloadSvgAsPng(svg: SVGSVGElement, filename: string) {
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svg);
  const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();

  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = CHART_W;
    canvas.height = CHART_H;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return;
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);

    canvas.toBlob((blob) => {
      URL.revokeObjectURL(url);
      if (!blob) return;
      const pngUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(pngUrl);
    }, "image/png");
  };

  image.src = url;
}

export default function App() {
  const [stage, setStage] = useState<Stage>("upload");
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  const [calP1, setCalP1] = useState<Point | null>(null);
  const [calP2, setCalP2] = useState<Point | null>(null);
  const [calValue, setCalValue] = useState<string>("");
  const [calUnit, setCalUnit] = useState<string>("nm");
  const [calibration, setCalibration] = useState<Calibration | null>(null);

  const canvasRef = useRef<MeasureCanvasHandle>(null);
  const chartSvgRef = useRef<SVGSVGElement | null>(null);

  const [mode, setMode] = useState<Mode>("pp");
  const [currentP1, setCurrentP1] = useState<Point | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [showHistogram, setShowHistogram] = useState(false);
  const [binCount, setBinCount] = useState(10);
  const [hoveredBin, setHoveredBin] = useState<number | null>(null);

  const calPxLen = useMemo(() => {
    if (!calP1 || !calP2) return null;
    return dist(calP1, calP2);
  }, [calP1, calP2]);

  const lastPreviewPx = useMemo(() => {
    if (!currentP1 || !hover) return null;
    return dist(currentP1, hover);
  }, [currentP1, hover]);

  const measuredValues = useMemo(() => {
    if (!calibration) return [];
    return measurements.map((measurement) => measurement.px * calibration.unitPerPx);
  }, [measurements, calibration]);

  const effectiveBinCount = useMemo(() => {
    if (measuredValues.length <= 1) return MIN_BIN_COUNT;
    return clamp(binCount, MIN_BIN_COUNT, Math.min(MAX_BIN_COUNT, measuredValues.length));
  }, [binCount, measuredValues.length]);

  const histogramBins = useMemo(
    () => buildHistogram(measuredValues, effectiveBinCount),
    [measuredValues, effectiveBinCount],
  );

  const summaryStats = useMemo(
    () => computeStats(measuredValues, calibration?.unit ?? "unit"),
    [measuredValues, calibration?.unit],
  );

  const chartMeta = useMemo(() => {
    const innerWidth = CHART_W - CHART_MARGIN.left - CHART_MARGIN.right;
    const innerHeight = CHART_H - CHART_MARGIN.top - CHART_MARGIN.bottom;
    const maxCount = Math.max(1, ...histogramBins.map((bin) => bin.count));
    const barSlotWidth = histogramBins.length > 0 ? innerWidth / histogramBins.length : innerWidth;
    const barWidth = Math.max(20, barSlotWidth * 0.78);

    return { innerWidth, innerHeight, maxCount, barSlotWidth, barWidth };
  }, [histogramBins]);

  const intervalWidthText = useMemo(() => {
    if (histogramBins.length === 0 || !calibration) return `- ${calibration?.unit ?? "unit"}`;
    const firstBin = histogramBins[0];
    return `${(firstBin.end - firstBin.start).toFixed(3)} ${calibration.unit}`;
  }, [histogramBins, calibration]);

  function resetAllToUpload() {
    setStage("upload");
    setImage(null);
    setCalP1(null);
    setCalP2(null);
    setCalValue("");
    setCalUnit("nm");
    setCalibration(null);
    setMode("pp");
    setCurrentP1(null);
    setMeasurements([]);
    setHover(null);
    setShowHistogram(false);
    setBinCount(10);
    setHoveredBin(null);
  }

  function backOneStep() {
    if (stage === "measure") {
      setStage("calibrate");
      setCurrentP1(null);
      setMeasurements([]);
      setHover(null);
      setShowHistogram(false);
      setHoveredBin(null);
      return;
    }
    if (stage === "calibrate") {
      setCalibration(null);
      setCalP1(null);
      setCalP2(null);
      setCalValue("");
      setCalUnit("nm");
      setStage("upload");
      return;
    }
  }

  async function onFileChange(file: File | null) {
    if (!file) return;
    const img = await loadImageFromFile(file);
    setImage(img);
    setStage("calibrate");
    setCalibration(null);
    setCalP1(null);
    setCalP2(null);
    setMeasurements([]);
    setCurrentP1(null);
    setShowHistogram(false);
    setHoveredBin(null);
  }

  function pickPoint(pImg: Point) {
    if (!image) return;

    if (stage === "calibrate") {
      if (!calP1) {
        setCalP1(pImg);
        setCalP2(null);
        return;
      }
      if (!calP2) {
        if (dist(calP1, pImg) < 1e-6) return;
        setCalP2(pImg);
        return;
      }
      setCalP1(pImg);
      setCalP2(null);
      return;
    }

    if (stage === "measure") {
      if (!calibration) return;
      if (!currentP1) {
        setCurrentP1(pImg);
        return;
      }
      const px = dist(currentP1, pImg);
      if (px < 1e-6) return;
      setMeasurements((ms) => [
        ...ms,
        { id: ms.length + 1, mode, p1: currentP1, p2: pImg, px },
      ]);
      setCurrentP1(null);
    }
  }

  function applyCalibration() {
    if (!calP1 || !calP2) return;
    const px = dist(calP1, calP2);
    const real = Number(calValue);
    if (!isFinite(real) || real <= 0) return;
    setCalibration({ unitPerPx: real / px, unit: calUnit || "unit" });
    setStage("measure");
    setCurrentP1(null);
    setMeasurements([]);
    setShowHistogram(false);
    setHoveredBin(null);
  }

  function deleteLast() {
    setMeasurements((ms) => ms.slice(0, -1));
    setCurrentP1(null);
  }

  function clearAll() {
    setMeasurements([]);
    setCurrentP1(null);
    setShowHistogram(false);
    setHoveredBin(null);
  }

  function downloadCsv() {
    if (!calibration) return;
    const csv = measurementsToCsv(measurements, calibration);
    downloadTextFile("sem_measurements.csv", csv);
  }

  function handleShowHistogram() {
    if (measurements.length === 0) return;
    setShowHistogram(true);
    setHoveredBin(null);
  }

  function downloadChartImage() {
    if (!chartSvgRef.current) return;
    downloadSvgAsPng(chartSvgRef.current, "measurement_histogram.png");
  }

  const minSlider = MIN_BIN_COUNT;
  const maxSlider = Math.max(MIN_BIN_COUNT, Math.min(MAX_BIN_COUNT, measuredValues.length || MIN_BIN_COUNT));

  return (
    <div className="app-shell">
      <h2 className="page-title">SEM Measurement (Lightweight)</h2>

      <div className="toolbar-row">
        <button onClick={backOneStep} disabled={stage === "upload"}>回上一步</button>
        <button onClick={resetAllToUpload}>重新開始</button>
        <button onClick={() => canvasRef.current?.downloadPng()} disabled={stage === "upload"}>下載量測圖</button>

        <div className="stage-indicator">
          Stage: <b>{stage}</b>
        </div>
      </div>

      {stage === "upload" && (
        <div className="panel">
          <div className="panel-title">上傳 SEM 圖（JPG/PNG）</div>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      {stage !== "upload" && (
        <>
          <MeasureCanvas
            ref={canvasRef}
            image={image}
            mode={stage === "calibrate" ? "pp" : mode}
            measurements={stage === "measure" ? measurements : []}
            currentP1={stage === "measure" ? currentP1 : null}
            onPickPoint={pickPoint}
            onHover={setHover}
          />

          <div className="control-row">
            {stage === "calibrate" && (
              <div className="panel flexible-panel">
                <div className="panel-title">比例尺校正</div>
                <div className="helper-text">
                  在圖上點兩點（比例尺兩端）。第三次點擊會重新開始選點。
                </div>

                <div className="inline-stats">
                  <div>Pixel distance:</div>
                  <b>{calPxLen ? calPxLen.toFixed(2) : "-"}</b>
                  <span className="muted-text">px</span>
                </div>

                <div className="form-row">
                  <label>實際長度</label>
                  <input
                    value={calValue}
                    onChange={(e) => setCalValue(e.target.value)}
                    placeholder="e.g. 200"
                    className="short-input"
                  />
                  <label>單位</label>
                  <input
                    value={calUnit}
                    onChange={(e) => setCalUnit(e.target.value)}
                    placeholder="nm"
                    className="short-input"
                  />
                  <button
                    onClick={applyCalibration}
                    disabled={!calP1 || !calP2 || !calValue || Number(calValue) <= 0}
                  >
                    套用校正並開始量測
                  </button>
                </div>
              </div>
            )}

            {stage === "measure" && (
              <>
                <div className="panel flexible-panel">
                  <div className="panel-title">量測控制</div>

                  <div className="button-row">
                    <span className="mode-label">模式：</span>
                    {(["pp", "pl", "ll"] as Mode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          setMode(m);
                          setCurrentP1(null);
                        }}
                        className={m === mode ? "active-mode" : ""}
                      >
                        {modeIcon(m)} {m}
                      </button>
                    ))}
                  </div>

                  <div className="helper-text">
                    目前單位：<b>{calibration?.unit}</b>
                    {lastPreviewPx && calibration ? (
                      <span>
                        {" "}｜預覽距離：<b>{(lastPreviewPx * calibration.unitPerPx).toFixed(3)}</b> {calibration.unit}
                      </span>
                    ) : null}
                  </div>

                  <div className="button-row">
                    <button onClick={deleteLast} disabled={measurements.length === 0}>刪除最後一筆</button>
                    <button onClick={clearAll} disabled={measurements.length === 0}>清空量測</button>
                    <button onClick={downloadCsv} disabled={measurements.length === 0}>下載 CSV</button>
                    <button onClick={handleShowHistogram} disabled={measurements.length === 0}>生成互動式長條圖</button>
                  </div>
                </div>

                <div className="panel table-panel">
                  <div className="panel-title">量測結果</div>
                  {measurements.length === 0 ? (
                    <div className="muted-text">尚無資料，請在圖上點兩點新增一筆量測。</div>
                  ) : (
                    <table className="measure-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>mode</th>
                          <th>pixel</th>
                          <th>distance ({calibration?.unit})</th>
                        </tr>
                      </thead>
                      <tbody>
                        {measurements.map((m) => (
                          <tr key={m.id}>
                            <td>{m.id}</td>
                            <td>{m.mode}</td>
                            <td>{m.px.toFixed(2)}</td>
                            <td>{(m.px * (calibration?.unitPerPx ?? 0)).toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>

          {stage === "measure" && showHistogram && calibration && (
            <div className="panel chart-panel">
              <div className="chart-header">
                <div>
                  <div className="panel-title">互動式長條圖</div>
                  <div className="helper-text">
                    X 軸為 distance（區間中值），Y 軸為次數。滑動拉桿可調整組距。
                  </div>
                </div>
                <button onClick={downloadChartImage} disabled={histogramBins.length === 0}>下載圖檔</button>
              </div>

              <div className="stats-grid">
                {summaryStats.map((stat) => (
                  <div key={stat.label} className="stat-card">
                    <div className="stat-label">{stat.label}</div>
                    <div className="stat-value">{stat.value}</div>
                  </div>
                ))}
              </div>

              <div className="slider-panel">
                <div className="slider-header">
                  <label htmlFor="bin-range">組距調整</label>
                  <span>
                    區間數：<b>{effectiveBinCount}</b> ｜ 每組寬度：<b>{intervalWidthText}</b>
                  </span>
                </div>
                <input
                  id="bin-range"
                  type="range"
                  min={minSlider}
                  max={maxSlider}
                  step={1}
                  value={clamp(binCount, minSlider, maxSlider)}
                  onChange={(e) => setBinCount(Number(e.target.value))}
                  className="wide-slider"
                />
              </div>

              <div className="chart-scroll">
                <svg
                  ref={chartSvgRef}
                  viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                  className="chart-svg"
                  role="img"
                  aria-label="Measurement histogram"
                >
                  <rect x="0" y="0" width={CHART_W} height={CHART_H} fill="#ffffff" rx="16" />
                  <text x={CHART_W / 2} y="18" textAnchor="middle" fontSize="16" fontWeight="700" fill="#111827">
                    測量距離分布圖
                  </text>

                  <line
                    x1={CHART_MARGIN.left}
                    y1={CHART_MARGIN.top}
                    x2={CHART_MARGIN.left}
                    y2={CHART_H - CHART_MARGIN.bottom}
                    stroke="#334155"
                    strokeWidth="1.5"
                  />
                  <line
                    x1={CHART_MARGIN.left}
                    y1={CHART_H - CHART_MARGIN.bottom}
                    x2={CHART_W - CHART_MARGIN.right}
                    y2={CHART_H - CHART_MARGIN.bottom}
                    stroke="#334155"
                    strokeWidth="1.5"
                  />

                  {Array.from({ length: chartMeta.maxCount + 1 }, (_, tick) => {
                    const y = CHART_MARGIN.top + chartMeta.innerHeight - (tick / chartMeta.maxCount) * chartMeta.innerHeight;
                    return (
                      <g key={tick}>
                        <line
                          x1={CHART_MARGIN.left}
                          y1={y}
                          x2={CHART_W - CHART_MARGIN.right}
                          y2={y}
                          stroke="#e2e8f0"
                          strokeDasharray="4 4"
                        />
                        <text x={CHART_MARGIN.left - 12} y={y + 4} textAnchor="end" fontSize="12" fill="#475569">
                          {tick}
                        </text>
                      </g>
                    );
                  })}

                  {histogramBins.map((bin, index) => {
                    const x = CHART_MARGIN.left + chartMeta.barSlotWidth * index + (chartMeta.barSlotWidth - chartMeta.barWidth) / 2;
                    const barHeight = (bin.count / chartMeta.maxCount) * chartMeta.innerHeight;
                    const y = CHART_MARGIN.top + chartMeta.innerHeight - barHeight;
                    const isHovered = hoveredBin === index;
                    return (
                      <g
                        key={`${bin.start}-${bin.end}`}
                        onMouseEnter={() => setHoveredBin(index)}
                        onMouseLeave={() => setHoveredBin((current) => (current === index ? null : current))}
                      >
                        <rect
                          x={x}
                          y={y}
                          width={chartMeta.barWidth}
                          height={Math.max(barHeight, 2)}
                          rx="8"
                          fill={isHovered ? "#2563eb" : "#60a5fa"}
                          stroke="#1d4ed8"
                          strokeWidth="1"
                        />
                        <text
                          x={x + chartMeta.barWidth / 2}
                          y={CHART_H - CHART_MARGIN.bottom + 18}
                          textAnchor="middle"
                          fontSize="11"
                          fill="#334155"
                        >
                          {bin.midpoint.toFixed(2)}
                        </text>
                        <text
                          x={x + chartMeta.barWidth / 2}
                          y={y - 8}
                          textAnchor="middle"
                          fontSize="12"
                          fontWeight="700"
                          fill="#1e293b"
                        >
                          {bin.count}
                        </text>
                        {isHovered && (
                          <g>
                            <rect
                              x={Math.max(20, x - 24)}
                              y={Math.max(28, y - 68)}
                              width="156"
                              height="52"
                              rx="10"
                              fill="#0f172a"
                              opacity="0.94"
                            />
                            <text x={Math.max(32, x - 12)} y={Math.max(48, y - 46)} fontSize="12" fill="#f8fafc">
                              中值：{bin.midpoint.toFixed(3)} {calibration.unit}
                            </text>
                            <text x={Math.max(32, x - 12)} y={Math.max(66, y - 28)} fontSize="12" fill="#f8fafc">
                              區間：{bin.start.toFixed(3)} - {bin.end.toFixed(3)}
                            </text>
                            <text x={Math.max(32, x - 12)} y={Math.max(84, y - 10)} fontSize="12" fill="#f8fafc">
                              次數：{bin.count}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}

                  <text
                    x={CHART_W / 2}
                    y={CHART_H - 18}
                    textAnchor="middle"
                    fontSize="13"
                    fontWeight="700"
                    fill="#1e293b"
                  >
                    distance ({calibration.unit})
                  </text>
                  <text
                    x="22"
                    y={CHART_H / 2}
                    textAnchor="middle"
                    fontSize="13"
                    fontWeight="700"
                    fill="#1e293b"
                    transform={`rotate(-90 22 ${CHART_H / 2})`}
                  >
                    次數
                  </text>
                </svg>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
