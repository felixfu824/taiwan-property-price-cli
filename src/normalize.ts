/**
 * lvr-pipeline — Normalize.
 *
 * Decodes the gov site's cryptic RawRow keys into the CleanRawRecord seam.
 * PURE: no I/O, no network. Faithful to source; NO judgement/adjustment
 * (that lives downstream in Refine).
 */
import type { RawRow, CleanRawRecord } from "./types.js";

/** Convert full-width digits (０-９, U+FF10–U+FF19) → half-width (0-9). */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  );
}

/** Parse a comma-formatted numeric string ("72,200,000") → number. Empty/NaN → 0. */
function parseNum(s: unknown): number {
  if (typeof s === "number") return Number.isFinite(s) ? s : 0;
  if (typeof s !== "string") return 0;
  const cleaned = s.replace(/,/g, "").trim();
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

const PING_TO_M2 = 3.30579;

/**
 * Pick the canonical address form from the `a` field.
 * `a` holds two forms separated by "#"; the second is the human-readable
 * (non-zero-padded) form. Returns half-width-digit version.
 */
function pickAddress(a: string): string {
  const raw = a.indexOf("#") >= 0 ? a.slice(a.indexOf("#") + 1) : a;
  return toHalfWidthDigits(raw).trim();
}

/** Extract the door number (e.g. "18" from "...169巷18號十樓"). "" if none. */
function extractAddrNum(halfWidthAddr: string): string {
  // The door number is the run of digits immediately before 號.
  const m = halfWidthAddr.match(/(\d+)號/);
  return m ? m[1] : "";
}

/**
 * Parse parking count from 交易標的 (`t`).
 * - no 車位 token            → 0
 * - 車位 followed by digits   → that number (e.g. "車位2" → 2)
 * - 車位 with no number       → 1 (list form default; ambiguous)
 */
function parseParkCount(t: string): number {
  if (!t.includes("車位")) return 0;
  const m = t.match(/車位\s*(\d+)/);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  return 1;
}

/**
 * Parse 主建物佔比 from "46.27%" → 46.27 (0-100). Empty/malformed → 0.
 */
function parsePct(s: string): number {
  if (!s) return 0;
  const n = Number(s.replace("%", "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** ROC "YYY/MM/DD" → western "YYYY-MM". Malformed → "". */
function rocToWesternYearMonth(roc: string): string {
  const m = roc.match(/^(\d{2,3})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
  if (!m) return "";
  const year = Number(m[1]) + 1911;
  const month = m[2].padStart(2, "0");
  return `${year}-${month}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function normalize(
  rows: RawRow[],
  meta?: { queryId?: string },
): CleanRawRecord[] {
  const fetchedAt = new Date().toISOString();

  return rows.map((row): CleanRawRecord => {
    const address = pickAddress(str(row.a));
    const addrNum = extractAddrNum(address);

    const txnDateRoc = str(row.e);
    const txnDate = rocToWesternYearMonth(txnDateRoc);

    const totalPriceWan = parseNum(row.tp) / 10000;

    const totalAreaPing = parseNum(row.s);
    const totalAreaM2 = totalAreaPing * PING_TO_M2;

    // TRUE raw unit price (parking still inside): 總價 / 總面積, in 萬元/坪.
    const rawUnitPrice =
      totalAreaPing > 0 ? round4(totalPriceWan / totalAreaPing) : 0;
    // The site's displayed unit price — field `p`. The companion `msg` field
    // tells whether this is parking-deducted or plain total/area.
    const siteUnitPriceRaw = parseNum(row.p);
    const siteAdjUnitPrice =
      siteUnitPriceRaw > 0 ? round4(siteUnitPriceRaw / 10000) : rawUnitPrice;

    const mainBuildingPct = parsePct(str(row.bs));
    const mainAreaM2 =
      mainBuildingPct > 0
        ? round2(totalAreaM2 * (mainBuildingPct / 100))
        : null;

    const parkPriceWan = parseNum(row.cp);

    const txnType = str(row.t);
    const parkCount = parseParkCount(txnType);

    return {
      // 社區簡稱 (community short name) from raw `bn`. Legitimately "" when the
      // building has no registered community — keep "" in that case.
      building: str(row.bn),
      buildingUnit: str(row.bu),
      address,
      addrNum,
      txnDate,
      txnDateRoc,
      totalPriceWan,
      rawUnitPrice,
      siteAdjUnitPrice,
      siteUnitPriceFormula: str(row.msg),
      totalAreaPing,
      totalAreaM2,
      mainBuildingPct,
      mainAreaM2,
      parkPriceWan,
      parkAreaM2: null,
      parkCount,
      txnType,
      floor: str(row.f),
      buildingType: str(row.b),
      mainUse: str(row.pu),
      layout: str(row.v),
      hasElevator: str(row.el) === "有",
      note: str(row.note),
      lat: typeof row.lat === "number" ? row.lat : parseNum(row.lat),
      lon: typeof row.lon === "number" ? row.lon : parseNum(row.lon),
      detailKey: str(row.sq),
      meta: { fetchedAt, queryId: meta?.queryId },
    };
  });
}
