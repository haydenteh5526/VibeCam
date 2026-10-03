/** A shot's edit recipe is retained with its untouched original. */
export type PhotoRecipe = {
  amount: number;
  exposure: number;
  warmth: number;
  character: number;
  dateStamp: boolean;
};

export const DEFAULT_RECIPE: PhotoRecipe = { amount: 1, exposure: 0, warmth: 0, character: 1, dateStamp: false };
const number = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;

export function normalizeRecipe(raw: unknown): PhotoRecipe {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    amount: number(r.amount, 0, 1, 1), exposure: number(r.exposure, -1.5, 1.5, 0),
    warmth: number(r.warmth, -1, 1, 0), character: number(r.character, 0, 1.5, 1),
    dateStamp: r.dateStamp === true,
  };
}

export function sameRecipe(a: PhotoRecipe, b: PhotoRecipe): boolean {
  return a.amount === b.amount && a.exposure === b.exposure && a.warmth === b.warmth
    && a.character === b.character && a.dateStamp === b.dateStamp;
}
