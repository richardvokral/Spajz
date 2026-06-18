// Parse Rohlik's `textualAmount` (e.g. "6 ks", "200 g", "0,75 l", "1 kg") into a
// canonical { amount, unit } so the pantry can total contents. Returns null when
// it can't parse cleanly (caller then falls back to package counting).

export type ContentUnit = "pcs" | "g" | "ml";

export interface ParsedAmount {
  amount: number;
  unit: ContentUnit;
}

const UNITS: Record<string, { unit: ContentUnit; factor: number }> = {
  ks: { unit: "pcs", factor: 1 },
  ku: { unit: "pcs", factor: 1 }, // "kus"
  pcs: { unit: "pcs", factor: 1 },
  g: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 },
  dkg: { unit: "g", factor: 10 },
  dag: { unit: "g", factor: 10 },
  ml: { unit: "ml", factor: 1 },
  cl: { unit: "ml", factor: 10 },
  dl: { unit: "ml", factor: 100 },
  l: { unit: "ml", factor: 1000 },
};

export function parseTextualAmount(
  input: string | null | undefined
): ParsedAmount | null {
  if (!input) return null;
  // anchored: a single "<number> <unit>" — compound strings ("2x100 g") return null
  const m = input
    .trim()
    .toLowerCase()
    .match(/^([0-9][0-9.,\s]*)\s*([a-zá-ž]+)\.?$/);
  if (!m) return null;
  const amount = Number(m[1].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const spec = UNITS[m[2]];
  if (!spec) return null;
  return { amount: amount * spec.factor, unit: spec.unit };
}
