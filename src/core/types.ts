export type Point = { x: number; y: number };

export type Stage = "upload" | "calibrate" | "measure";

export type Mode = "pp" | "pl" | "ll"; // point-point | point-line | line-line

export type Calibration = {
  unitPerPx: number; // real_unit / px
  unit: string; // e.g. "nm", "µm"
};

export type Measurement = {
  id: number;
  mode: Mode;
  p1: Point;
  p2: Point;
  px: number;
};
