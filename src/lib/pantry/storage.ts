// Browser-localStorage pantry store for the MVP. No server, no database.

import type { OrderLineItem } from "@/lib/rohlik/types";

const PANTRY_KEY = "spajz.pantry.v1";
const IMPORTED_KEY = "spajz.importedOrderIds.v1";

export interface PantryItem {
  key: string; // productId ?? slug(name) — merge/dedup key
  name: string;
  quantity: number;
  unit: string | null;
  lastBought: string; // ISO date
}

export type Pantry = Record<string, PantryItem>;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function itemKey(i: OrderLineItem): string {
  if (i.productId) return i.productId;
  const slug = slugify(i.name);
  return slug.length > 0 ? slug : i.name;
}

export function loadPantry(): Pantry {
  if (!hasWindow()) return {};
  try {
    const raw = window.localStorage.getItem(PANTRY_KEY);
    return raw ? (JSON.parse(raw) as Pantry) : {};
  } catch {
    return {};
  }
}

export function savePantry(p: Pantry): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(PANTRY_KEY, JSON.stringify(p));
}

/**
 * Merge order items into the pantry. Existing key -> sum quantity, keep the
 * later lastBought. New key -> insert.
 */
export function addItemsToPantry(
  items: OrderLineItem[],
  orderedAt: string | null
): Pantry {
  const pantry = loadPantry();
  const boughtAt = orderedAt ?? new Date().toISOString();

  for (const item of items) {
    const key = itemKey(item);
    const existing = pantry[key];
    if (existing) {
      existing.quantity += item.quantity;
      if (boughtAt > existing.lastBought) existing.lastBought = boughtAt;
    } else {
      pantry[key] = {
        key,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        lastBought: boughtAt,
      };
    }
  }

  savePantry(pantry);
  return pantry;
}

export function loadImportedOrderIds(): string[] {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(IMPORTED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function isOrderImported(orderId: string): boolean {
  return loadImportedOrderIds().includes(orderId);
}

export function markOrderImported(orderId: string): void {
  if (!hasWindow()) return;
  const ids = loadImportedOrderIds();
  if (!ids.includes(orderId)) {
    ids.push(orderId);
    window.localStorage.setItem(IMPORTED_KEY, JSON.stringify(ids));
  }
}

export function clearPantry(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(PANTRY_KEY);
  window.localStorage.removeItem(IMPORTED_KEY);
}
