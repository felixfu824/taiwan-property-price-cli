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
  /** start period, western YYYYMM, e.g. "202401" (Resolve converts to ROC year/month) */
  from: string;
  /** end period, western YYYYMM, e.g. "202612" */
  to: string;
  /** property type codes. Sale default "1,2" (房地); 3=土地 4=建物 5=車位.
   *  Rent default "1,2,3,4,5,6,7" (all 標的 — the rent tab reuses ptype as the
   *  target-category filter; 6=租賃房屋 and 7=租賃房屋+車位 carry every building
   *  lease reported on the new form effective 112/09, and 6/7 need a 1-5 code
   *  alongside them or the query returns empty). */
  ptype?: string;
  /** query type, default "biz" (買賣). "sale" = 預售屋. "rent" = 租賃. */
  queryType?: "biz" | "sale" | "rent";
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

// ═════════════════════════════════════════════════════════════════════════
// RENTAL (租賃) PIPELINE — a PARALLEL seam, NOT the sale one.
//
// Rental rows share the sale JSON envelope but reuse keys with different
// meaning (tp = 月租金 in 元, not 總價 in 萬; p = 租金/坪/月). Pushing them
// through the sale Normalize/Refine produces garbage, so rent gets its own
// RentRawRow → CleanRentRecord → RefinedRentRecord path.
//
// Pipeline:  QueryInput(queryType:"rent") --Resolve--> QueryParams(qryType:"rent")
//            --Fetch--> RentRawRow[] --normalizeRent--> CleanRentRecord[]
//            (THE RENT SEAM) --refineRent--> RefinedRentRecord[]
//
// Schema captured 2026-07-02; see docs/rent-schema-notes.md.
// ═════════════════════════════════════════════════════════════════════════

/** Raw rental row exactly as the QueryPrice JSON delivers it (qryType=rent).
 *  Keys shared with RawRow but rent-specific meanings are annotated. */
export interface RentRawRow {
  a: string;    // address (full-width); land rows carry 地號 not door address
  e: string;    // 簽約日, ROC "YYY/MM/DD"
  tp: string;   // 月租金 (元), comma-formatted — total monthly rent (NOT 萬)
  p: string;    // 單價 = 租金/坪/月 (元), comma-formatted
  s: string;    // 面積 (坪)
  cp: string;   // 車位租金 (元/月); "" unless parking
  msg: string;  // unit-rent formula, e.g. 總價/總面積
  t: string;    // 租賃標的: 建物 / 房地(土地+建物)(+車位) / 車位 / 土地 (old form)
                //           租賃房屋 / 租賃房屋+車位 (new form, 簽約 ≥112/09)
  b: string;    // 建物型態 (住宅大樓/華廈/公寓/店面/套房/…); "" for land
  bn: string;   // 社區名
  commid: string; // 社區 id
  f: string;    // 樓別/樓高 "八層/九層"
  v: string;    // 格局 "2房2廳2衛"
  pu: string;   // 主要用途 "住家用"
  AA11: string; // 用途類別 住/商/其他 — old-form only; ~94% empty on new-form rows
  m: string;    // 有無管理組織 "有"/"無"
  fn: string;   // old form: 有無附傢俱 "有"/"". new form: 附屬設備 comma list
                // (e.g. "冷氣、熱水器、傢俱") — 傢俱 appears as a list item.
  g: string;    // 屋齡 (年)
  rperiod: string; // 租賃期間, ROC "1150505~1200504"; "" if unreported (old form
                   // ~0% filled; new form ~100%)
  rtype: string;   // 出租型態: 整戶出租/分層出租/獨立套房/分租套房/分租雅房;
                   // new-form rows only (~85% filled there), "" on old-form rows
  rserviec: string; // (sic, site typo) 租賃住宅服務: 一般轉租/一般代管/一般包租/
                    // 社會住宅代管/社會住宅包租轉租; "" = no service business
  el: string;      // 有無電梯 "有"/"無"; new-form rows only ("" on old form)
  note: string; // 備註 (exclusion signals live here)
  lat: number; lon: number;
  sq: string;   // per-row detail key
  type: string; // record-type tag, "Rent"
  [k: string]: unknown; // other keys (ho, r, j/k/l, id, …) — see fixture
}

// ─────────────────────────────────────────────────────────────────────────
// THE RENT SEAM — Clean Rent Record. normalizeRent output / refineRent input.
// Faithful to source; NO judgement (that lives in refineRent).
// ─────────────────────────────────────────────────────────────────────────
export interface CleanRentRecord {
  building: string;            // 社區名 ("" if none)
  address: string;             // half-width normalized address
  addrNum: string;             // door number only ("" for land 地號 rows)
  txnDate: string;             // "YYYY-MM" western
  txnDateRoc: string;          // raw ROC e.g. "112/08/01"
  monthlyRentTwd: number;      // 月租金 (元) — total, parking still inside
  unitRentTwdPing: number;     // 單價, 元/坪/月 (site-reported `p`)
  unitRentFormula: string;     // raw `msg`
  rawUnitRentTwdPing: number;  // TRUE raw = 月租金/面積 (parking still inside)
  areaPing: number;
  areaM2: number;
  parkRentTwd: number;         // 車位租金 (元/月); 0 if none
  rentTarget: string;          // 租賃標的 (raw `t`)
  buildingType: string;        // 建物型態
  mainUse: string;             // 主要用途
  useClass: string;            // 用途類別 (住/商/其他)
  layout: string;              // 格局
  floor: string;               // 樓別/樓高
  hasMgmtOrg: boolean;         // 有無管理組織
  hasFurniture: boolean;       // 附傢俱: old form fn="有"; new form 傢俱 in equipment list
  hasElevator: boolean | null; // 有無電梯 (new-form rows); null = unreported (all old-form)
  equipment: string;           // 附屬設備 comma list (new-form rows); "" on old form
  rentalType: string;          // 出租型態 (raw `rtype`): 整戶出租/分層出租/獨立套房/
                               // 分租套房/分租雅房; "" when unreported (all old-form rows)
  rentalService: string;       // 租賃住宅服務 (raw `rserviec`): 一般轉租/一般代管/一般包租/
                               // 社會住宅代管/社會住宅包租轉租; "" = none. 社會住宅* rows
                               // are subsidized — segment out for market-rate comps.
  buildingAgeYears: number | null; // 屋齡 (raw `g`); null if unknown
  rentPeriod: string;          // 租賃期間 raw "YYYMMDD~YYYMMDD" ("" if none)
  note: string;                // 備註
  lat: number; lon: number;
  detailKey: string;           // `sq`
  meta: { fetchedAt: string; queryId?: string };
}

// ─────────────────────────────────────────────────────────────────────────
// refineRent output — analysis-ready. Rent has NO car-park unit-price moat,
// so Layer B here is light: net-of-parking rent, a coarse 出租型態, exclusion
// flags, and a confidence rollup.
// ─────────────────────────────────────────────────────────────────────────
export type RentKind = "整棟/獨立" | "套房" | "分層/其他" | "車位" | "土地";

export interface RefinedRentRecord extends CleanRentRecord {
  netRentTwd: number;          // 月租金 − separately reported 車位租金
  netAreaPing: number;         // area − parking area (parking area unknown → = area)
  adjUnitRentTwdPing: number;  // corrected 元/坪/月 (net rent / net area)
  rentKind: RentKind;          // coarse 出租型態: from rentalType when reported
                               // (new form; 雅房 folds into 套房), else proxied
                               // from 標的 + 建物型態 (old form)
  excluded: boolean;
  excludeReason: string;       // "親友交易" | "純車位" | "非住宅" | ""
  parkRentIncluded: boolean;   // parking present but its rent is bundled in the total
  confidence: Confidence;      // degrades for exclusions / bundled parking / inferred age
}
