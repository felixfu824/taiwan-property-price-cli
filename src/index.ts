/**
 * lvr-pipeline — composed engine API.
 *
 * Sale/presale (買賣/預售):
 *   extract:            QueryInput → CleanRawRecord[]   (Resolve → Fetch → Normalize)
 *   extractRefined:     QueryInput → RefinedRecord[]    (+ Refine, Layer B)
 * Rental (租賃, queryType:"rent"):
 *   extractRent:        QueryInput → CleanRentRecord[]  (Resolve → Fetch → normalizeRent)
 *   extractRentRefined: QueryInput → RefinedRentRecord[] (+ refineRent, Layer B)
 *
 * Importable by agents or an application. All functions return typed Result.
 */
import { resolve } from "./resolve.js";
import { fetchRaw, closeBrowser } from "./fetch.js";
import { normalize, normalizeRent, toHalfWidthDigits } from "./normalize.js";
import { refine, refineRent, type RefineOptions } from "./refine.js";
import type {
  QueryInput,
  CleanRawRecord,
  RefinedRecord,
  RentRawRow,
  CleanRentRecord,
  RefinedRentRecord,
  Result,
} from "./types.js";

export interface ExtractMeta {
  resolvedLabel?: string;
  /** Set when a rent query carried a road/lane: the doorno that was applied client-side. */
  rentRoadFilter?: string;
  /** District-wide row count before the client-side rent road filter. */
  rentDistrictRows?: number;
}

/**
 * LVR's rent endpoint accepts but IGNORES the 門牌 (doorno) param — a road-level
 * rent query returns the whole district (sale queries are filtered server-side).
 * So rent narrows to the road client-side with a substring match on address.
 */
export function filterRentByRoad(
  records: CleanRentRecord[],
  doorno: string,
): CleanRentRecord[] {
  if (!doorno) return records;
  // Addresses are half-width-digit normalized; doorno keeps the user's digits.
  const road = toHalfWidthDigits(doorno);
  return records.filter((rec) => rec.address.includes(road));
}

/** Layer A: latest building-level transactions as faithful Clean Raw Records. */
export async function extract(
  input: QueryInput,
  meta?: ExtractMeta,
): Promise<Result<CleanRawRecord[]>> {
  const r = resolve(input);
  if (r.code !== "OK" || !r.data) return { code: r.code, error: r.error };
  if (meta) meta.resolvedLabel = r.data.resolvedLabel;

  const raw = await fetchRaw(r.data);
  if (raw.code === "OK_EMPTY") return { code: "OK_EMPTY", data: [] };
  if (raw.code !== "OK" || !raw.data) return { code: raw.code, error: raw.error };

  const clean = normalize(raw.data, { queryId: r.data.resolvedLabel });
  return { code: "OK", data: clean };
}

/** Layer A + Layer B: analysis-ready records (car-park adjusted, exclusions flagged). */
export async function extractRefined(
  input: QueryInput,
  opts?: RefineOptions,
  meta?: ExtractMeta,
): Promise<Result<RefinedRecord[]>> {
  const e = await extract(input, meta);
  if (e.code === "OK_EMPTY") return { code: "OK_EMPTY", data: [] };
  if (e.code !== "OK" || !e.data) return { code: e.code, error: e.error };
  return refine(e.data, opts);
}

/** Rental Layer A: latest building-level LEASES as faithful Clean Rent Records. */
export async function extractRent(
  input: QueryInput,
  meta?: ExtractMeta,
): Promise<Result<CleanRentRecord[]>> {
  const r = resolve({ ...input, queryType: "rent" });
  if (r.code !== "OK" || !r.data) return { code: r.code, error: r.error };
  if (meta) meta.resolvedLabel = r.data.resolvedLabel;

  const raw = await fetchRaw(r.data);
  if (raw.code === "OK_EMPTY") return { code: "OK_EMPTY", data: [] };
  if (raw.code !== "OK" || !raw.data) return { code: raw.code, error: raw.error };

  const clean = normalizeRent(raw.data as unknown as RentRawRow[], {
    queryId: r.data.resolvedLabel,
  });
  if (!r.data.doorno) return { code: "OK", data: clean };

  // Road-level rent query: the site returned the whole district; narrow here.
  const road = filterRentByRoad(clean, r.data.doorno);
  if (meta) {
    meta.rentRoadFilter = r.data.doorno;
    meta.rentDistrictRows = clean.length;
  }
  if (road.length === 0) return { code: "OK_EMPTY", data: [] };
  return { code: "OK", data: road };
}

/** Rental Layer A + Layer B: analysis-ready leases (net-of-parking, exclusions flagged). */
export async function extractRentRefined(
  input: QueryInput,
  meta?: ExtractMeta,
): Promise<Result<RefinedRentRecord[]>> {
  const e = await extractRent(input, meta);
  if (e.code === "OK_EMPTY") return { code: "OK_EMPTY", data: [] };
  if (e.code !== "OK" || !e.data) return { code: e.code, error: e.error };
  return refineRent(e.data);
}

export { resolve, fetchRaw, normalize, normalizeRent, refine, refineRent, closeBrowser };
export type { RefineOptions };
export * from "./types.js";
