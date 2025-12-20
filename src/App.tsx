import { useMemo, useState } from "react";
import MeasureCanvas from "./components/MeasureCanvas";
import type { Calibration, Measurement, Mode, Point, Stage } from "./core/types";
import { dist } from "./core/math";
import { downloadTextFile, measurementsToCsv } from "./core/csv";

function modeIcon(mode: Mode) {
  // 依你要求：都用「點＋線」風格，不用 ⟂
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

export default function App() {
  const [stage, setStage] = useState<Stage>("upload");
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  // Calibration step
  const [calP1, setCalP1] = useState<Point | null>(null);
  const [calP2, setCalP2] = useState<Point | null>(null);
  const [calValue, setCalValue] = useState<string>(""); // real length
  const [calUnit, setCalUnit] = useState<string>("nm");
  const [calibration, setCalibration] = useState<Calibration | null>(null);

  // Measurement step
  const [mode, setMode] = useState<Mode>("pp");
  const [currentP1, setCurrentP1] = useState<Point | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [hover, setHover] = useState<Point | null>(null);

  const calPxLen = useMemo(() => {
    if (!calP1 || !calP2) return null;
    return dist(calP1, calP2);
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
  }

  function backOneStep() {
    if (stage === "measure") {
      // 回到校正：清掉量測
      setStage("calibrate");
      setCurrentP1(null);
      setMeasurements([]);
      setHover(null);
      return;
    }
    if (stage === "calibrate") {
      // 回到上傳：清掉校正
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
  }

  function pickPoint(pImg: Point) {
    if (!image) return;

    if (stage === "calibrate") {
      // 兩點完成比例尺取樣
      if (!calP1) {
        setCalP1(pImg);
        setCalP2(null);
        return;
      }
      if (!calP2) {
        // 第二點
        if (dist(calP1, pImg) < 1e-6) return;
        setCalP2(pImg);
        return;
      }
      // 已經有兩點：第三次點擊就重新開始校正點位
      setCalP1(pImg);
      setCalP2(null);
      return;
    }

    if (stage === "measure") {
      if (!calibration) return; // 沒校正不給量（符合你需求）
      if (!currentP1) {
        setCurrentP1(pImg);
        return;
      }
      // finalize
      const px = dist(currentP1, pImg);
      if (px < 1e-6) return;
      setMeasurements(ms => [
        ...ms,
        { id: ms.length + 1, mode, p1: currentP1, p2: pImg, px },
      ]);
      setCurrentP1(null); // 回到新增狀態
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
  }

  function deleteLast() {
    setMeasurements(ms => ms.slice(0, -1));
    setCurrentP1(null);
  }

  function clearAll() {
    setMeasurements([]);
    setCurrentP1(null);
  }

  function downloadCsv() {
    if (!calibration) return;
    const csv = measurementsToCsv(measurements, calibration);
    downloadTextFile("sem_measurements.csv", csv);
  }

  return (
    <div style={{ maxWidth: 980, margin: "24px auto", padding: "0 16px", fontFamily: "system-ui" }}>
      <h2 style={{ margin: "0 0 12px" }}>SEM Measurement (Lightweight)</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={backOneStep} disabled={stage === "upload"}>回上一步</button>
        <button onClick={resetAllToUpload}>重新開始</button>

        <div style={{ marginLeft: 8, color: "#555" }}>
          Stage: <b>{stage}</b>
        </div>
      </div>

      {stage === "upload" && (
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, marginBottom: 12 }}>
          <div style={{ marginBottom: 8 }}>上傳 SEM 圖（JPG/PNG）</div>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={e => onFileChange(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      {stage !== "upload" && (
        <>
          <MeasureCanvas
            image={image}
            mode={stage === "calibrate" ? "pp" : mode}
            measurements={
              // 校正階段不顯示量測記錄
              stage === "measure" ? measurements : []
            }
            currentP1={
              stage === "measure" ? currentP1 : null
            }
            onPickPoint={pickPoint}
            onHover={setHover}
          />

          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            {stage === "calibrate" && (
              <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, flex: "1 1 520px" }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>比例尺校正</div>
                <div style={{ color: "#555", marginBottom: 8 }}>
                  在圖上點兩點（比例尺兩端）。第三次點擊會重新開始選點。
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div>Pixel distance:</div>
                  <b>{calPxLen ? calPxLen.toFixed(2) : "-"}</b>
                  <span style={{ color: "#888" }}>px</span>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                  <label>實際長度</label>
                  <input
                    value={calValue}
                    onChange={e => setCalValue(e.target.value)}
                    placeholder="e.g. 200"
                    style={{ width: 120 }}
                  />
                  <label>單位</label>
                  <input
                    value={calUnit}
                    onChange={e => setCalUnit(e.target.value)}
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
              <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, flex: "1 1 520px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 600 }}>量測模式</div>
                  {(["pp", "pl", "ll"] as Mode[]).map(m => (
                    <button
                      key={m}
                      onClick={() => { setMode(m); setCurrentP1(null); }}
                      style={{
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: m === mode ? "2px solid #111" : "1px solid #ccc",
                        background: m === mode ? "#f2f2f2" : "#fff",
                      }}
                      title={m}
                    >
                      {modeIcon(m)}
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: 10, color: "#555" }}>
                  校正：<b>{calibration?.unitPerPx ? `1px = ${(calibration.unitPerPx).toExponential(3)} ${calibration.unit}` : "-"}</b>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button onClick={deleteLast} disabled={measurements.length === 0}>刪除最後一筆</button>
                  <button onClick={clearAll} disabled={measurements.length === 0}>全部清空</button>
                  <button onClick={downloadCsv} disabled={measurements.length === 0 || !calibration}>下載 CSV</button>
                  <span style={{ color: "#555" }}>
                    已量測：<b>{measurements.length}</b> 筆
                  </span>
                  <span style={{ color: "#555" }}>
                    預覽(px)：<b>{lastPreviewPx ? lastPreviewPx.toFixed(2) : "-"}</b>
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
