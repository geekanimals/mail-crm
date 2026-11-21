// "1,234" / "$12.50" / "" -> number
export function toNumber(value) {
  if (typeof value === "number") return isFinite(value) ? value : 0;
  const n = parseFloat(String(value ?? "").replace(/[,$\s]/g, ""));
  return isFinite(n) ? n : 0;
}

export const round2 = (n) => Math.round(n * 100) / 100;
