import { useMemo, useRef, useState } from "react";
import MeasureCanvas from "./components/MeasureCanvas";
import type { MeasureCanvasHandle } from "./components/MeasureCanvas";
import type { Calibration, Measurement, Mode, Point, Stage } from "./core/types";
import { dist } from "./core/math";
import { downloadTextFile, measurementsToCsv } from "./core/csv";
import "./App.css";

type HistogramBin = {
  start: number;
  end: number;
  midpoint: number;
  count: number;
};

type SummaryStats = {
  sampleSize: number;
  mean: number;
  min: number;
  max: number;
  stdDev: number;
};

const CHART_WIDTH = 920;
const CHART_HEIGHT = 420;
const CHART_MARGIN = { top: 24, right: 24, bottom: 72, left: 64 };

function modeIcon(mode: Mode) {
  switch (mode) {
    case "pp": return "●──●";
    case "pl": return "●──┃";
    case "ll": return "┃──┃";
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

function formatValue(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function computeStats(values: number[]): SummaryStats | null {
  if (values.length === 0) return null;

  const sampleSize = values.length;
  const sum = values.reduce((acc, value) => acc + value, 0);
  const mean = sum / sampleSize;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / sampleSize;

  return {
    sampleSize,
    mean,
    min,
    max,
    stdDev: Math.sqrt(variance),
  };
}

function buildHistogram(values: number[], binWidth: number): HistogramBin[] {
  if (values.length === 0 || !Number.isFinite(binWidth) || binWidth <= 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (Math.abs(max - min) < Number.EPSILON) {
    return [{
      start: min - binWidth / 2,
      end: min + binWidth / 2,
      midpoint: min,
      count: values.length,
    }];
  }

  const start = Math.floor(min / binWidth) * binWidth;
  const end = Math.ceil(max / binWidth) * binWidth;
  const binCount = Math.max(1, Math.ceil((end - start) / binWidth));
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: start + index * binWidth,
    end: start + (index + 1) * binWidth,
    midpoint: start + (index + 0.5) * binWidth,
    count: 0,
  }));

  for (const value of values) {
    const rawIndex = Math.floor((value - start) / binWidth);
    const index = Math.min(bins.length - 1, Math.max(0, rawIndex));
    bins[index].count += 1;
  }

  return bins;
}

function downloadSvgAsPng(svg: SVGSVGElement, fileName: string) {
  const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(svg);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  const image = new Image();

  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = CHART_WIDTH;
    canvas.height = CHART_HEIGHT;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(svgUrl);
      return;
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) {
        URL.revokeObjectURL(svgUrl);
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      URL.revokeObjectURL(svgUrl);
    }, "image/png");
  };

  image.src = svgUrl;
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
  const [showChart, setShowChart] = useState(false);
  const [hoveredBinIndex, setHoveredBinIndex] = useState<number | null>(null);

  const measurementValues = useMemo(() => {
    if (!calibration) return [];
    return measurements.map((measurement) => measurement.px * calibration.unitPerPx);
  }, [measurements, calibration]);

  const stats = useMemo(() => computeStats(measurementValues), [measurementValues]);

  const sliderConfig = useMemo(() => {
    if (measurementValues.length === 0) {
      return { min: 0.1, max: 1, step: 0.01, defaultValue: 0.1 };
    }

    const min = Math.min(...measurementValues);
    const max = Math.max(...measurementValues);
    const range = Math.max(max - min, Math.abs(max) || 1);
    const sliderMin = Math.max(range / 80, 0.001);
    const sliderMax = Math.max(range * 1.2, sliderMin * 2);
    const sliderStep = Math.max(sliderMin / 20, 0.0001);
    const defaultValue = Math.min(sliderMax, Math.max(sliderMin, range / Math.max(1, Math.sqrt(measurementValues.length))));

    return { min: sliderMin, max: sliderMax, step: sliderStep, defaultValue };
  }, [measurementValues]);

  const [binWidth, setBinWidth] = useState<number>(0.1);

  const histogram = useMemo(
    () => buildHistogram(measurementValues, binWidth),
    [measurementValues, binWidth],
  );

  const chartMetrics = useMemo(() => {
    const innerWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
    const innerHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
    const maxCount = Math.max(1, ...histogram.map((bin) => bin.count));
    const barGap = histogram.length > 12 ? 6 : 10;
    const barWidth = histogram.length === 0 ? innerWidth : Math.max(14, (innerWidth - barGap * Math.max(0, histogram.length - 1)) / Math.max(1, histogram.length));

    return { innerWidth, innerHeight, maxCount, barGap, barWidth };
  }, [histogram]);

  const calPxLen = useMemo(() => {
    if (!calP1 || !calP2) return null;
    return dist(calP1, calP2);
  }, [calP1, calP2]);

  const calibrationPreviewMeasurements = useMemo<Measurement[]>(() => {
    if (!calP1 || !calP2) return [];
    return [{
      id: 0,
      mode: "pp",
      p1: calP1,
      p2: calP2,
      px: dist(calP1, calP2),
    }];
  }, [calP1, calP2]);

  const lastPreviewPx = useMemo(() => {
    if (!currentP1 || !hover) return null;
    return dist(currentP1, hover);
  }, [currentP1, hover]);

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
    setShowChart(false);
    setHoveredBinIndex(null);
  }

  function backOneStep() {
    if (stage === "measure") {
      setStage("calibrate");
      setCurrentP1(null);
      setMeasurements([]);
      setHover(null);
      setShowChart(false);
      setHoveredBinIndex(null);
      return;
    }
    if (stage === "calibrate") {
      setCalibration(null);
      setCalP1(null);
      setCalP2(null);
      setCalValue("");
      setCalUnit("nm");
      setStage("upload");
      setShowChart(false);
      setHoveredBinIndex(null);
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
    setShowChart(false);
    setHoveredBinIndex(null);
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
      setMeasurements((items) => [
        ...items,
        { id: items.length + 1, mode, p1: currentP1, p2: pImg, px },
      ]);
      setCurrentP1(null);
      return;
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
    setShowChart(false);
    setHoveredBinIndex(null);
  }

  function deleteLast() {
    setMeasurements((items) => items.slice(0, -1));
    setCurrentP1(null);
    setHoveredBinIndex(null);
  }

  function clearAll() {
    setMeasurements([]);
    setCurrentP1(null);
    setShowChart(false);
    setHoveredBinIndex(null);
  }

  function downloadCsv() {
    if (!calibration) return;
    const csv = measurementsToCsv(measurements, calibration);
    downloadTextFile("sem_measurements.csv", csv);
  }

  function handleShowChart() {
    setBinWidth(sliderConfig.defaultValue);
    setShowChart(true);
    setHoveredBinIndex(null);
  }

  const activeBin = hoveredBinIndex === null ? null : histogram[hoveredBinIndex] ?? null;

  return (
    <div className="app-shell">
      <h2 className="app-title">SEM Measurement (Lightweight)</h2>

      <div className="toolbar-row">
        <button onClick={backOneStep} disabled={stage === "upload"}>回上一步</button>
        <button onClick={resetAllToUpload}>重新開始</button>

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
            measurements={stage === "measure" ? measurements : calibrationPreviewMeasurements}
            currentP1={stage === "measure" ? currentP1 : calP1}
            onPickPoint={pickPoint}
            onHover={setHover}
          />

          <div className="toolbar-row chart-spacing">
            {stage === "calibrate" && (
              <div className="panel stretch-panel">
                <div className="panel-title">比例尺校正</div>
                <div className="helper-text">
                  在圖上點兩點（比例尺兩端）。第三次點擊會重新開始選點。
                </div>

                <div className="inline-data-row">
                  <div>Pixel distance:</div>
                  <b>{calPxLen ? calPxLen.toFixed(2) : "-"}</b>
                  <span className="muted-text">px</span>
                </div>

                <div className="inline-data-row compact-top">
                  <label>實際長度</label>
                  <input
                    value={calValue}
                    onChange={(e) => setCalValue(e.target.value)}
                    placeholder="e.g. 200"
                    style={{ width: 120 }}
                  />
                  <label>單位</label>
                  <input
                    value={calUnit}
                    onChange={(e) => setCalUnit(e.target.value)}
                    placeholder="nm / µm"
                    style={{ width: 80 }}
                  />
                  <button onClick={applyCalibration} disabled={!calP1 || !calP2 || !calValue}>
                    套用校正並進入量測
                  </button>
                </div>
              </div>
            )}

            {stage === "measure" && (
              <div className="panel stretch-panel">
                <div className="inline-data-row">
                  <div className="panel-title">量測模式</div>
                  {(["pp", "pl", "ll"] as Mode[]).map((value) => (
                    <button
                      key={value}
                      onClick={() => { setMode(value); setCurrentP1(null); }}
                      className={`mode-button${value === mode ? " active" : ""}`}
                      title={value}
                    >
                      {modeIcon(value)}
                    </button>
                  ))}
                </div>

                <div className="helper-text compact-top">
                  校正：<b>{calibration?.unitPerPx ? `1px = ${calibration.unitPerPx.toExponential(3)} ${calibration.unit}` : "-"}</b>
                </div>

                <div className="inline-data-row compact-top">
                  <button onClick={deleteLast} disabled={measurements.length === 0}>刪除最後一筆</button>
                  <button onClick={clearAll} disabled={measurements.length === 0}>全部清空</button>
                  <button onClick={downloadCsv} disabled={measurements.length === 0 || !calibration}>下載 CSV</button>
                  <button onClick={() => canvasRef.current?.downloadPng()} disabled={measurements.length === 0}>下載 PNG</button>
                  <button onClick={handleShowChart} disabled={measurementValues.length === 0}>生成互動式長條圖</button>
                  <span className="muted-text">
                    已量測：<b>{measurements.length}</b> 筆
                  </span>
                  <span className="muted-text">
                    預覽(px)：<b>{lastPreviewPx ? lastPreviewPx.toFixed(2) : "-"}</b>
                  </span>
                </div>
              </div>
            )}
          </div>

          {stage === "measure" && stats && (
            <div className="panel chart-spacing">
              <div className="panel-title">統計摘要</div>
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-label">樣本數</span>
                  <strong>{stats.sampleSize}</strong>
                </div>
                <div className="stat-card">
                  <span className="stat-label">平均值</span>
                  <strong>{formatValue(stats.mean)} {calibration?.unit}</strong>
                </div>
                <div className="stat-card">
                  <span className="stat-label">最小值</span>
                  <strong>{formatValue(stats.min)} {calibration?.unit}</strong>
                </div>
                <div className="stat-card">
                  <span className="stat-label">最大值</span>
                  <strong>{formatValue(stats.max)} {calibration?.unit}</strong>
                </div>
                <div className="stat-card">
                  <span className="stat-label">標準差</span>
                  <strong>{formatValue(stats.stdDev)} {calibration?.unit}</strong>
                </div>
              </div>
            </div>
          )}

          {stage === "measure" && showChart && calibration && (
            <div className="panel chart-panel chart-spacing">
              <div className="chart-header">
                <div>
                  <div className="panel-title">互動式長條圖</div>
                  <div className="helper-text">
                    X 軸為 distance 區間中值（{calibration.unit}），Y 軸為次數。滑鼠移到柱狀可查看區間資訊。
                  </div>
                </div>
                <button onClick={() => chartSvgRef.current && downloadSvgAsPng(chartSvgRef.current, "measurement_histogram.png")}>下載圖檔</button>
              </div>

              <div className="slider-panel">
                <div className="slider-label-row">
                  <label htmlFor="bin-width">組距調整</label>
                  <span>
                    目前組距：<b>{formatValue(binWidth, 4)} {calibration.unit}</b>
                  </span>
                </div>
                <input
                  id="bin-width"
                  className="bin-slider"
                  type="range"
                  min={sliderConfig.min}
                  max={sliderConfig.max}
                  step={sliderConfig.step}
                  value={binWidth}
                  onChange={(e) => setBinWidth(Number(e.target.value))}
                />
              </div>

              <div className="chart-wrapper">
                <svg
                  ref={chartSvgRef}
                  viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                  className="histogram-svg"
                  role="img"
                  aria-label="Measurement histogram"
                >
                  <rect x="0" y="0" width={CHART_WIDTH} height={CHART_HEIGHT} fill="#ffffff" rx="16" />
                  <line
                    x1={CHART_MARGIN.left}
                    y1={CHART_MARGIN.top + chartMetrics.innerHeight}
                    x2={CHART_MARGIN.left + chartMetrics.innerWidth}
                    y2={CHART_MARGIN.top + chartMetrics.innerHeight}
                    stroke="#1f2937"
                    strokeWidth="2"
                  />
                  <line
                    x1={CHART_MARGIN.left}
                    y1={CHART_MARGIN.top}
                    x2={CHART_MARGIN.left}
                    y2={CHART_MARGIN.top + chartMetrics.innerHeight}
                    stroke="#1f2937"
                    strokeWidth="2"
                  />

                  {Array.from({ length: chartMetrics.maxCount + 1 }, (_, tick) => {
                    const y = CHART_MARGIN.top + chartMetrics.innerHeight - (tick / chartMetrics.maxCount) * chartMetrics.innerHeight;
                    return (
                      <g key={`y-${tick}`}>
                        <line
                          x1={CHART_MARGIN.left}
                          y1={y}
                          x2={CHART_MARGIN.left + chartMetrics.innerWidth}
                          y2={y}
                          stroke="#e5e7eb"
                          strokeWidth="1"
                        />
                        <text x={CHART_MARGIN.left - 12} y={y + 4} textAnchor="end" fontSize="12" fill="#4b5563">
                          {tick}
                        </text>
                      </g>
                    );
                  })}

                  {histogram.map((bin, index) => {
                    const x = CHART_MARGIN.left + index * (chartMetrics.barWidth + chartMetrics.barGap);
                    const height = (bin.count / chartMetrics.maxCount) * chartMetrics.innerHeight;
                    const y = CHART_MARGIN.top + chartMetrics.innerHeight - height;
                    const isActive = hoveredBinIndex === index;
                    return (
                      <g key={`${bin.start}-${bin.end}`}>
                        <rect
                          x={x}
                          y={y}
                          width={chartMetrics.barWidth}
                          height={Math.max(1, height)}
                          rx="8"
                          fill={isActive ? "#2563eb" : "#60a5fa"}
                          stroke={isActive ? "#1d4ed8" : "#2563eb"}
                          strokeWidth="1.5"
                          onMouseEnter={() => setHoveredBinIndex(index)}
                          onMouseLeave={() => setHoveredBinIndex((current) => current === index ? null : current)}
                        />
                        <text
                          x={x + chartMetrics.barWidth / 2}
                          y={CHART_MARGIN.top + chartMetrics.innerHeight + 22}
                          textAnchor="middle"
                          fontSize="11"
                          fill="#4b5563"
                        >
                          {formatValue(bin.midpoint)}
                        </text>
                      </g>
                    );
                  })}

                  <text
                    x={CHART_MARGIN.left + chartMetrics.innerWidth / 2}
                    y={CHART_HEIGHT - 18}
                    textAnchor="middle"
                    fontSize="14"
                    fill="#111827"
                  >
                    distance ({calibration.unit}) — 區間中值
                  </text>
                  <text
                    x="18"
                    y={CHART_MARGIN.top + chartMetrics.innerHeight / 2}
                    textAnchor="middle"
                    fontSize="14"
                    fill="#111827"
                    transform={`rotate(-90 18 ${CHART_MARGIN.top + chartMetrics.innerHeight / 2})`}
                  >
                    次數
                  </text>
                </svg>

                <div className="tooltip-card">
                  {activeBin ? (
                    <>
                      <div><b>區間：</b>{formatValue(activeBin.start)} ~ {formatValue(activeBin.end)} {calibration.unit}</div>
                      <div><b>中值：</b>{formatValue(activeBin.midpoint)} {calibration.unit}</div>
                      <div><b>次數：</b>{activeBin.count}</div>
                    </>
                  ) : (
                    <div className="muted-text">將滑鼠移到長條上查看詳細資料。</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
