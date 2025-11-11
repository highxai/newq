import { randomBytes } from "node:crypto";

export const now = (): number => Date.now();

export const genId = (prefix = "job") =>
  `${prefix}_${randomBytes(6).toString("hex")}`;

export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

export const defaultBackoff = (attempts: number): number => {
  // exponential backoff in ms: cap 60s
  const base = 1000; // 1s
  return clamp(base * Math.pow(2, attempts - 1), 0, 60_000);
};
