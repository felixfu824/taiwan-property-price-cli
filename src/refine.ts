/**
 * lvr-pipeline — Refine (Layer B, the correctness moat).
 *
 * Turns faithful CleanRawRecords into analysis-ready RefinedRecords by applying
 * the car-park / exclusion / unit-price judgement rules from the lvr-query skill.
 *
 * PURE: no I/O, no network. Deterministic. Never silently drops a record —
 * problematic rows are KEPT and flagged (excluded / low confidence).
 *
 * Rule source: ~/.claude/skills/lvr-query/SKILL.md
 *   - "Car Park Price Edge Cases" table
 *   - "Exclusion Rules"
 *   - "Unit Conversion" (1坪 = 3.30579 m²)
 *   - "Building Reference Data"
 */
import type {
  CleanRawRecord,
  RefinedRecord,
  Result,
  ParkingRefSource,
  ParkPriceSource,
  Confidence,
} from "./types.js";

/** 1 坪 = 3.30579 m² (from skill "Unit Conversion"). */
const PING_TO_M2 = 3.30579;

/**
 * District default parking area when no other basis exists. A typical Taipei
 * mechanical/平面 car-park stall transfers ~33–34 m²; 33.5 is a sane midpoint.
 * Named constant per spec (district_fallback path).
 */
export const DISTRICT_FALLBACK_PARK_AREA_M2 = 33.5;

export interface RefineOptions {
  /**
   * Curated per-building reference data. Keyed by building name OR an address
   * substring (matched case-insensitively against record.building / address).
   * Example: { "松德長虹": { parkAreaM2: 33.34, parkPriceWan: 350 } }
   */
  referenceData?: Record<string, { parkAreaM2: number; parkPriceWan: number }>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v) && v > 0).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid];
}

/**
 * Building key for batch grouping. normalize.ts leaves `building` empty, so we
 * fall back to the alley/road portion of the address (drop the door number and
 * floor) — records of the same complex share that prefix.
 */
function buildingKey(r: CleanRawRecord): string {
  if (r.building && r.building.trim() !== "") return r.building.trim();
  // Strip the door number ("...169巷18號十樓" → "...169巷") to group a complex.
  const m = r.address.match(/^(.*?)(?:\d+號.*)?$/);
  return (m ? m[1] : r.address).trim();
}

/**
 * Find a curated referenceData entry by heuristic match against the record's
 * building name and address. Returns the matched value or null.
 */
function matchCurated(
  r: CleanRawRecord,
  referenceData?: RefineOptions["referenceData"],
): { parkAreaM2: number; parkPriceWan: number } | null {
  if (!referenceData) return null;
  const hay = `${r.building} ${r.address}`.toLowerCase();
  for (const [key, val] of Object.entries(referenceData)) {
    const k = key.toLowerCase().trim();
    if (k === "") continue;
    if (hay.includes(k) || r.building.toLowerCase().trim() === k) return val;
  }
  return null;
}

const KINSHIP_RE = /親友|員工|特殊關係|共有人/;
const PRESALE_RE = /預售/;

/**
 * Lower a confidence level by one step, never below "low".
 */
function degrade(c: Confidence): Confidence {
  if (c === "high") return "medium";
  return "low";
}

export function refine(
  records: CleanRawRecord[],
  opts: RefineOptions = {},
): Result<RefinedRecord[]> {
  // ── Pass 1: build per-building median of REPORTED park area & price ────────
  const reportedAreasByBuilding = new Map<string, number[]>();
  for (const r of records) {
    const key = buildingKey(r);
    if (r.parkAreaM2 != null && r.parkAreaM2 > 0) {
      const arr = reportedAreasByBuilding.get(key) ?? [];
      arr.push(r.parkAreaM2);
      reportedAreasByBuilding.set(key, arr);
    }
  }

  let failed = 0;
  const out: RefinedRecord[] = records.map((r): RefinedRecord => {
    try {
      return refineOne(r, opts, reportedAreasByBuilding);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      // Never drop: emit a minimally-populated, low-confidence record.
      return {
        ...r,
        netPriceWan: r.totalPriceWan,
        netAreaPing: r.totalAreaPing,
        adjUnitPrice: r.rawUnitPrice,
        excluded: false,
        excludeReason: "",
        isPresale: PRESALE_RE.test(r.note),
        parkPriceIncluded: false,
        parkPriceSource: r.parkCount > 0 ? "reported" : "none",
        parkAreaUnreported: false,
        parkingRefSource: "district_fallback",
        confidence: "low",
        note: `${r.note}${r.note ? " " : ""}[refine error: ${msg}]`,
      };
    }
  });

  const allClean = failed === 0;
  return {
    code: allClean ? "OK" : "PARTIAL",
    data: out,
    ...(allClean ? {} : { partial: { ok: out.length - failed, failed } }),
  };
}

function refineOne(
  r: CleanRawRecord,
  opts: RefineOptions,
  reportedAreasByBuilding: Map<string, number[]>,
): RefinedRecord {
  const key = buildingKey(r);
  const noteParts: string[] = [];

  let confidence: Confidence = "high";

  // ── Exclusions (flag, never drop) ─────────────────────────────────────────
  let excluded = false;
  let excludeReason = "";
  const isParkingOnly =
    (r.txnType.includes("車位") &&
      !r.txnType.includes("建物") &&
      !r.txnType.includes("土地")) ||
    (r.parkPriceWan > 0 && Math.abs(r.totalPriceWan - r.parkPriceWan) < 1e-6);
  if (KINSHIP_RE.test(r.note)) {
    excluded = true;
    excludeReason = "親友交易";
  } else if (isParkingOnly) {
    excluded = true;
    excludeReason = "純車位";
  } else if (r.mainUse && !r.mainUse.includes("住")) {
    excluded = true;
    excludeReason = "非住宅";
  }

  const isPresale = PRESALE_RE.test(r.note);

  // ── Parking price: native/parity-first, no invented official price ─────────
  const hasParking = r.parkCount > 0;
  const parkPriceIncluded = hasParking && r.parkPriceWan === 0;
  const parkPriceSource: ParkPriceSource =
    !hasParking ? "none" : parkPriceIncluded ? "included_in_total" : "reported";

  if (parkPriceIncluded) {
    // Prior ZIP research treats 車位總價=0 + parking present as bundled into the
    // total. Keep the numerator native: do not subtract an invented price.
    noteParts.push("park price included in total; no separate park price subtracted");
    confidence = degrade(confidence);
  }

  const netPriceWan = round2(r.totalPriceWan - (parkPriceIncluded ? 0 : r.parkPriceWan));

  // ── PREFER the site's displayed unit price when present ───────────────────
  // Web-sourced records carry `siteAdjUnitPrice` (legacy name) from raw field
  // `p`. Inspect `siteUnitPriceFormula` to know whether the site deducted
  // parking or used plain total/area.
  if (r.siteAdjUnitPrice > 0) {
    // Recover the site-implied net area from netPrice / siteAdj when a park is
    // present; otherwise total area already equals net area.
    let netAreaPing = r.totalAreaPing;
    if (hasParking && netPriceWan > 0) {
      const implied = round2(netPriceWan / r.siteAdjUnitPrice);
      if (Number.isFinite(implied) && implied > 0 && implied <= r.totalAreaPing) {
        netAreaPing = implied;
      }
    }
    const combinedNoteWeb =
      noteParts.length > 0
        ? `${r.note}${r.note ? " " : ""}[${noteParts.join("; ")}]`
        : r.note;
    // ── Live-path confidence semantics (honest signal, not a constant) ───────
    // The site's displayed unit price is the most authoritative figure we have,
    // so a clean live record is "high". But confidence still carries the real
    // signal computed above:
    //   - "low"    when the record is excluded (親友/純車位/非住宅) — the price
    //              should not be trusted for analysis regardless of accuracy.
    //   - "medium" when we degraded earlier (e.g. park price is bundled into
    //              the total → parkPriceIncluded).
    //   - "high"   otherwise (normal clean live record).
    let liveConfidence: Confidence = confidence;
    if (excluded) liveConfidence = "low";
    return {
      ...r,
      note: combinedNoteWeb,
      netPriceWan,
      netAreaPing,
      adjUnitPrice: r.siteAdjUnitPrice,
      excluded,
      excludeReason,
      isPresale,
      parkPriceIncluded,
      parkPriceSource,
      // Park area was reported/used by the site itself.
      parkAreaUnreported: false,
      parkingRefSource: "reported",
      confidence: liveConfidence,
    };
  }

  // ── FALLBACK (siteAdjUnitPrice <= 0, e.g. ZIP-sourced records) ────────────
  // Parking area resolution (priority: reported→derived→curated→fallback).
  let effectiveParkAreaM2: number;
  let parkingRefSource: ParkingRefSource;
  let parkAreaUnreported = false;

  if (!hasParking) {
    // No parking → no area adjustment.
    effectiveParkAreaM2 = 0;
    parkingRefSource = "reported";
  } else if (r.parkAreaM2 != null) {
    // 1. reported (high)
    effectiveParkAreaM2 = r.parkAreaM2;
    parkingRefSource = "reported";
  } else {
    parkAreaUnreported = true;
    const derivedArea = median(reportedAreasByBuilding.get(key) ?? []);
    const curated = matchCurated(r, opts.referenceData);
    if (derivedArea != null) {
      // 2. derived (medium)
      effectiveParkAreaM2 = derivedArea;
      parkingRefSource = "derived";
      confidence = degrade(confidence);
      noteParts.push(`park area derived ${round2(effectiveParkAreaM2)}㎡ (batch median)`);
    } else if (curated != null) {
      // 3. curated (medium)
      effectiveParkAreaM2 = curated.parkAreaM2;
      parkingRefSource = "curated";
      confidence = degrade(confidence);
      noteParts.push(`park area curated ${effectiveParkAreaM2}㎡`);
    } else {
      // 4. district_fallback (low)
      effectiveParkAreaM2 = DISTRICT_FALLBACK_PARK_AREA_M2;
      parkingRefSource = "district_fallback";
      confidence = "low";
      noteParts.push(`park area district fallback ${effectiveParkAreaM2}㎡`);
    }
  }

  // ── Net area & adjusted unit price ────────────────────────────────────────
  const netAreaPing = round2(r.totalAreaPing - effectiveParkAreaM2 / PING_TO_M2);

  let adjUnitPrice: number;
  if (netAreaPing > 0 && Number.isFinite(netAreaPing) && netPriceWan > 0) {
    adjUnitPrice = round2(netPriceWan / netAreaPing);
  } else {
    // Divide-by-zero / negative guard → fall back to raw unit price, low conf.
    adjUnitPrice = r.rawUnitPrice;
    confidence = "low";
    noteParts.push("net area/price non-positive — fell back to raw unit price");
  }

  const combinedNote =
    noteParts.length > 0
      ? `${r.note}${r.note ? " " : ""}[${noteParts.join("; ")}]`
      : r.note;

  // Excluded records are never trustworthy for analysis → "low" (mirrors the
  // live path). The rawUnitPrice fallback above already forced "low".
  if (excluded) confidence = "low";

  return {
    ...r,
    note: combinedNote,
    netPriceWan,
    netAreaPing,
    adjUnitPrice,
    excluded,
    excludeReason,
    isPresale,
    parkPriceIncluded,
    parkPriceSource,
    parkAreaUnreported,
    parkingRefSource,
    confidence,
  };
}
