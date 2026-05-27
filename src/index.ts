/**
 * lvr-pipeline — composed engine API.
 *
 * extract:        QueryInput → CleanRawRecord[]   (Resolve → Fetch → Normalize)
 * extractRefined: QueryInput → RefinedRecord[]    (+ Refine, Layer B)
 *
 * Importable by agents or an application. All functions return typed Result.
 */
import { resolve } from "./resolve.js";
import { fetchRaw, closeBrowser } from "./fetch.js";
import { normalize } from "./normalize.js";
import { refine, type RefineOptions } from "./refine.js";
import type { QueryInput, CleanRawRecord, RefinedRecord, Result } from "./types.js";

export interface ExtractMeta { resolvedLabel?: string }

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

export { resolve, fetchRaw, normalize, refine, closeBrowser };
export type { RefineOptions };
export * from "./types.js";
