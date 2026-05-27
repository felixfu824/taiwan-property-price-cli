/**
 * lvr-pipeline — shared contracts (the seam).
 *
 * This file is the SINGLE SOURCE OF TRUTH that every module programs against.
 * Module owners: DO NOT change these types without coordinating — Resolve,
 * Fetch, Normalize, and Refine all depend on them.
 *
 * Pipeline:  QueryInput --Resolve--> QueryParams --Fetch--> RawRow[]
 *            --Normalize--> CleanRawRecord[]  (THE SEAM)  --Refine--> RefinedRecord[]
 */

// ─────────────────────────────────────────────────────────────────────────
// Typed outcomes (cross-cutting). Callers branch on `code`, never parse prose.
// ─────────────────────────────────────────────────────────────────────────
export type OutcomeCode =
  | "OK"            // results returned
  | "OK_EMPTY"      // valid query, zero matches
  | "ERR_BAD_INPUT" // could not resolve address / params
  | "ERR_SITE_CHANGED" // signing/onload sequence failed — needs maintainer
  | "ERR_ENV"       // browser binary/sandbox/runtime setup failed
  | "ERR_NETWORK"   // transient — retry with backoff
  | "ERR_RATE_LIMITED" // throttled / blocked
  | "PARTIAL";      // some records failed downstream — see `partial`

export interface Result<T> {
  code: OutcomeCode;
  data?: T;
  error?: string;
  partial?: { ok: number; failed: number };
}

// ─────────────────────────────────────────────────────────────────────────
// Resolve: human description → exact gov query params
// ─────────────────────────────────────────────────────────────────────────
export interface QueryInput {
  /** e.g. "台北市信義區松德路169巷" (address) */
  where: string;
  /** start year, western, e.g. "2024" (Resolve converts to ROC) */
  from: string;
  /** end year, western, e.g. "2026" */
  to: string;
  /** property type codes, default "1,2" (房地). 3=土地 4=建物 5=車位 */
  ptype?: string;
  /** query type, default "biz" (買賣). "sale" = 預售屋. */
  queryType?: "biz" | "sale";
}

/** Output of Resolve / input of Fetch. Field names/values match what the
 *  lvr site's localStorage `form-data` expects. */
export interface QueryParams {
  qryType: string; // "biz" (買賣) | "rent" | "sale"(預售)
  city: string;    // e.g. "A" (臺北市)
  town: string;    // e.g. "A17" (信義區)
  doorno: string;  // e.g. "松德路169巷" (raw; Fetch handles encoding)
  starty: string;  // ROC year e.g. "113"
  startm: string;
  endy: string;
  endm: string;
  ptype: string;   // "1,2"
  /** human-readable echo of what was matched, for confirmation. */
  resolvedLabel: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Fetch: raw row exactly as the QueryPrice JSON response delivers it.
// 42 cryptic keys — Normalize (src/normalize.ts) decodes these into CleanRawRecord.
// ─────────────────────────────────────────────────────────────────────────
export interface RawRow {
  a: string;   // address (full-width, "#"-separated forms)
  e: string;   // txn date, ROC "YYY/MM/DD"
  tp: string;  // 總價 (元), comma-formatted
  cp: string;  // 車位總價 (萬)
  s: string;   // 總面積 (坪)
  p: string;   // 單價 (元/坪), raw — comma-formatted
  bs: string;  // 主建物佔比 "46.27%"
  b: string;   // 建物型態
  f: string;   // 樓別/樓高 "十層/二十二層"
  v: string;   // 格局 "3房2廳2衛"
  pu: string;  // 主要用途 "住家用"
  el: string;  // 電梯 "有"/"無"
  t: string;   // 交易標的 "房地(土地+建物)+車位"
  note: string;// 備註
  AA11: string;// 用途類別
  lat: number; lon: number;
  sq: string;  // per-row detail key
  msg: string; // adj-unit-price formula text
  [k: string]: unknown; // other keys (commid, m, mark, ...) — see fixture
}

// ─────────────────────────────────────────────────────────────────────────
// THE SEAM — Clean Raw Record. Normalize output / Refine input.
// Faithful to source; NO judgement/adjustment. Parking separated but raw.
// ─────────────────────────────────────────────────────────────────────────
export interface CleanRawRecord {
  building: string;            // community/building name ("" if unknown)
  buildingUnit: string;        // presale/building unit label from raw `bu`, e.g. A2棟0號
  address: string;             // half-width normalized door address
  addrNum: string;             // door number only (e.g. "18")
  txnDate: string;             // "YYYY-MM" western
  txnDateRoc: string;          // raw ROC e.g. "115/01/26"
  totalPriceWan: number;       // 總價 in 萬元
  rawUnitPrice: number;        // 萬元/坪, TRUE raw = 總價/總面積 (parking still inside)
  siteAdjUnitPrice: number;    // legacy name: site-reported 單價 in 萬元/坪; inspect siteUnitPriceFormula for parking basis
  siteUnitPriceFormula: string;// raw `msg`, e.g. 總價/總面積 or (總價-車位總價)/(總面積-車位總面積)
  totalAreaPing: number;
  totalAreaM2: number;
  mainBuildingPct: number;     // 主建物佔比 as 0-100
  mainAreaM2: number | null;   // null unless detail-fetched or derivable
  parkPriceWan: number;        // 車位總價 萬元 (0 ≠ "no parking")
  parkAreaM2: number | null;   // null unless detail-fetched
  parkCount: number;           // parsed from 交易標的 (車位N); flag ambiguous
  txnType: string;             // 交易標的
  floor: string;               // 樓別/樓高
  buildingType: string;
  mainUse: string;             // 主要用途
  layout: string;              // 格局
  hasElevator: boolean;
  note: string;                // 備註 (exclusion signals live here)
  lat: number; lon: number;
  detailKey: string;           // `sq` — for optional detail fetch
  meta: { fetchedAt: string; queryId?: string };
}

// ─────────────────────────────────────────────────────────────────────────
// Refine output — analysis-ready. Adds judgement + provenance.
// ─────────────────────────────────────────────────────────────────────────
export type ParkingRefSource = "reported" | "derived" | "district_fallback" | "curated";
export type ParkPriceSource = "none" | "reported" | "included_in_total";
export type Confidence = "high" | "medium" | "low";

export interface RefinedRecord extends CleanRawRecord {
  netPriceWan: number;         // total - separately reported parking price
  netAreaPing: number;         // total area - parking area
  adjUnitPrice: number;        // corrected 萬元/坪
  excluded: boolean;
  excludeReason: string;       // "親友交易" | "純車位" | "非住宅" | ""
  isPresale: boolean;
  parkPriceIncluded: boolean;  // parking exists but separate parking price is bundled/unreported
  parkPriceSource: ParkPriceSource; // provenance for the price subtraction side
  parkAreaUnreported: boolean; // parking area missing (derived/curated/fallback if adjusted)
  parkingRefSource: ParkingRefSource; // source for parking-area basis
  confidence: Confidence;      // derived rollup; degrades per inferred/ambiguous input
}
