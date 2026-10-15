export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MoverDef {
  w: number;
  h: number;
  from: [number, number];
  to: [number, number];
  period: number; // seconds for a full back-and-forth
  phase: number; // 0..1
}

export type ZoneType = "accel" | "brake";

export interface ZoneDef {
  rect: Rect;
  type: ZoneType;
  dir: [number, number]; // accel only
  power: number;
}

export interface CoinDef {
  x: number;
  y: number;
}

export interface NoteDef {
  x: number;
  y: number;
  id: string;
  text?: string;
}

export interface LevelDef {
  id: string;
  name: string;
  description?: string;
  size: [number, number];
  ballRadius?: number;
  start: [number, number];
  goal: Rect;
  walls: Rect[];
  sticky?: Rect[];
  bouncy?: Rect[];
  spikes?: Rect[];
  coins?: CoinDef[];
  notes?: NoteDef[];
  zones?: ZoneDef[];
  movers?: MoverDef[];
  parTime?: number;
}

export interface ConfigDef {
  ballRadius: number;
  gravity: number;
  restitution: number;
  bouncyRestitution: number;
  bouncyMinSpeed: number;
  maxSpeed: number;
  wheelSensitivity: number;
  dragSensitivity: number;
  keyRotationSpeed: number;
  substep: number;
}
