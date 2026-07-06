/**
 * Resolve — human address description → exact lvr query params.
 *
 * PURE: no I/O, no network. Parses a Chinese address string, maps city +
 * district to the lvr site's city/town codes, extracts the road/lane portion,
 * and converts western YYYYMM periods to ROC year/month fields. Output feeds
 * Fetch (QueryParams).
 *
 * Code tables are the AUTHORITATIVE full set for all 22 Taiwan cities/counties
 * (臺澎金馬 included), compiled from the LVR town list captured directly from
 * lvr.land.moi.gov.tw. districtName → townCode is the inverse of the site's
 * townCode → districtName, with names normalized
 * (台→臺, 巿 U+5DFF→市 U+5E02) so user input matches regardless of variant glyph.
 *
 * Two cities have NO district sub-split on LVR — 新竹市 (O) and 嘉義市 (I) each
 * expose a single town (O01 / I01). For these, any 區 the user types is NOT a
 * district lookup; it flows into doorno instead. See CITYWIDE_ONLY below.
 */
import type { QueryInput, QueryParams, Result } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────
// Code tables. All 22 cities/counties. city display name → city code, and
// city code → (district name → town code). Generated from the authoritative
// LVR town list captured from lvr.land.moi.gov.tw, names normalized.
// ─────────────────────────────────────────────────────────────────────────

/** city display name (normalized to 臺) → city code */
const CITY_CODES: Record<string, string> = {
  臺北市: "A",
  臺中市: "B",
  基隆市: "C",
  臺南市: "D",
  高雄市: "E",
  新北市: "F",
  宜蘭縣: "G",
  桃園市: "H",
  嘉義市: "I",
  新竹縣: "J",
  苗栗縣: "K",
  南投縣: "M",
  彰化縣: "N",
  新竹市: "O",
  雲林縣: "P",
  嘉義縣: "Q",
  屏東縣: "T",
  花蓮縣: "U",
  臺東縣: "V",
  金門縣: "W",
  澎湖縣: "X",
  連江縣: "Z",
};

/** city code → (district name → town code) */
const TOWN_CODES: Record<string, Record<string, string>> = {
  // A 臺北市
  A: {
    松山區: "A01",
    大安區: "A02",
    中正區: "A03",
    萬華區: "A05",
    大同區: "A09",
    中山區: "A10",
    文山區: "A11",
    南港區: "A13",
    內湖區: "A14",
    士林區: "A15",
    北投區: "A16",
    信義區: "A17",
  },
  // B 臺中市
  B: {
    中區: "B01",
    東區: "B02",
    南區: "B03",
    西區: "B04",
    北區: "B05",
    西屯區: "B06",
    南屯區: "B07",
    北屯區: "B08",
    豐原區: "B09",
    東勢區: "B10",
    大甲區: "B11",
    清水區: "B12",
    沙鹿區: "B13",
    梧棲區: "B14",
    后里區: "B15",
    神岡區: "B16",
    潭子區: "B17",
    大雅區: "B18",
    新社區: "B19",
    石岡區: "B20",
    外埔區: "B21",
    大安區: "B22",
    烏日區: "B23",
    大肚區: "B24",
    龍井區: "B25",
    霧峰區: "B26",
    太平區: "B27",
    大里區: "B28",
    和平區: "B29",
  },
  // C 基隆市
  C: {
    中正區: "C01",
    七堵區: "C02",
    暖暖區: "C03",
    仁愛區: "C04",
    中山區: "C05",
    安樂區: "C06",
    信義區: "C07",
  },
  // D 臺南市
  D: {
    東區: "D01",
    南區: "D02",
    北區: "D04",
    安南區: "D06",
    安平區: "D07",
    中西區: "D08",
    新營區: "D09",
    鹽水區: "D10",
    柳營區: "D11",
    白河區: "D12",
    後壁區: "D13",
    東山區: "D14",
    麻豆區: "D15",
    下營區: "D16",
    六甲區: "D17",
    官田區: "D18",
    大內區: "D19",
    佳里區: "D20",
    西港區: "D21",
    七股區: "D22",
    將軍區: "D23",
    北門區: "D24",
    學甲區: "D25",
    新化區: "D26",
    善化區: "D27",
    新市區: "D28",
    安定區: "D29",
    山上區: "D30",
    左鎮區: "D31",
    仁德區: "D32",
    歸仁區: "D33",
    關廟區: "D34",
    龍崎區: "D35",
    玉井區: "D36",
    楠西區: "D37",
    南化區: "D38",
    永康區: "D39",
  },
  // E 高雄市
  E: {
    鹽埕區: "E01",
    鼓山區: "E02",
    左營區: "E03",
    楠梓區: "E04",
    三民區: "E05",
    新興區: "E06",
    前金區: "E07",
    苓雅區: "E08",
    前鎮區: "E09",
    旗津區: "E10",
    小港區: "E11",
    鳳山區: "E12",
    林園區: "E13",
    大寮區: "E14",
    大樹區: "E15",
    大社區: "E16",
    仁武區: "E17",
    鳥松區: "E18",
    岡山區: "E19",
    橋頭區: "E20",
    燕巢區: "E21",
    田寮區: "E22",
    阿蓮區: "E23",
    路竹區: "E24",
    湖內區: "E25",
    茄萣區: "E26",
    永安區: "E27",
    彌陀區: "E28",
    梓官區: "E29",
    旗山區: "E30",
    美濃區: "E31",
    六龜區: "E32",
    甲仙區: "E33",
    杉林區: "E34",
    內門區: "E35",
    茂林區: "E36",
    桃源區: "E37",
    那瑪夏區: "E38",
  },
  // F 新北市
  F: {
    新莊區: "F01",
    林口區: "F02",
    五股區: "F03",
    蘆洲區: "F04",
    三重區: "F05",
    泰山區: "F06",
    新店區: "F07",
    石碇區: "F08",
    深坑區: "F09",
    坪林區: "F10",
    烏來區: "F11",
    板橋區: "F14",
    三峽區: "F15",
    鶯歌區: "F16",
    樹林區: "F17",
    中和區: "F18",
    土城區: "F19",
    瑞芳區: "F21",
    平溪區: "F22",
    雙溪區: "F23",
    貢寮區: "F24",
    金山區: "F25",
    萬里區: "F26",
    淡水區: "F27",
    汐止區: "F28",
    三芝區: "F30",
    石門區: "F31",
    八里區: "F32",
    永和區: "F33",
  },
  // G 宜蘭縣
  G: {
    宜蘭市: "G01",
    頭城鎮: "G02",
    礁溪鄉: "G03",
    壯圍鄉: "G04",
    員山鄉: "G05",
    羅東鎮: "G06",
    五結鄉: "G07",
    冬山鄉: "G08",
    蘇澳鎮: "G09",
    三星鄉: "G10",
    大同鄉: "G11",
    南澳鄉: "G12",
  },
  // H 桃園市
  H: {
    桃園區: "H01",
    大溪區: "H02",
    中壢區: "H03",
    楊梅區: "H04",
    蘆竹區: "H05",
    大園區: "H06",
    龜山區: "H07",
    八德區: "H08",
    龍潭區: "H09",
    平鎮區: "H10",
    新屋區: "H11",
    觀音區: "H12",
    復興區: "H13",
  },
  // I 嘉義市 — single town only (see CITYWIDE_ONLY); listed for completeness.
  I: {
    嘉義市: "I01",
  },
  // J 新竹縣
  J: {
    竹東鎮: "J02",
    關西鎮: "J03",
    新埔鎮: "J04",
    竹北市: "J05",
    湖口鄉: "J06",
    橫山鄉: "J08",
    新豐鄉: "J09",
    芎林鄉: "J10",
    寶山鄉: "J11",
    北埔鄉: "J12",
    峨眉鄉: "J13",
    尖石鄉: "J14",
    五峰鄉: "J15",
  },
  // K 苗栗縣
  K: {
    苗栗市: "K01",
    苑裡鎮: "K02",
    通霄鎮: "K03",
    公館鄉: "K04",
    銅鑼鄉: "K05",
    三義鄉: "K06",
    西湖鄉: "K07",
    頭屋鄉: "K08",
    竹南鎮: "K09",
    頭份市: "K10",
    造橋鄉: "K11",
    後龍鎮: "K12",
    三灣鄉: "K13",
    南庄鄉: "K14",
    大湖鄉: "K15",
    卓蘭鎮: "K16",
    獅潭鄉: "K17",
    泰安鄉: "K18",
  },
  // M 南投縣
  M: {
    南投市: "M01",
    埔里鎮: "M02",
    草屯鎮: "M03",
    竹山鎮: "M04",
    集集鎮: "M05",
    名間鄉: "M06",
    鹿谷鄉: "M07",
    中寮鄉: "M08",
    魚池鄉: "M09",
    國姓鄉: "M10",
    水里鄉: "M11",
    信義鄉: "M12",
    仁愛鄉: "M13",
  },
  // N 彰化縣
  N: {
    彰化市: "N01",
    鹿港鎮: "N02",
    和美鎮: "N03",
    北斗鎮: "N04",
    員林市: "N05",
    溪湖鎮: "N06",
    田中鎮: "N07",
    二林鎮: "N08",
    線西鄉: "N09",
    伸港鄉: "N10",
    福興鄉: "N11",
    秀水鄉: "N12",
    花壇鄉: "N13",
    芬園鄉: "N14",
    大村鄉: "N15",
    埔鹽鄉: "N16",
    埔心鄉: "N17",
    永靖鄉: "N18",
    社頭鄉: "N19",
    二水鄉: "N20",
    田尾鄉: "N21",
    埤頭鄉: "N22",
    芳苑鄉: "N23",
    大城鄉: "N24",
    竹塘鄉: "N25",
    溪州鄉: "N26",
  },
  // O 新竹市 — single town only (see CITYWIDE_ONLY); listed for completeness.
  O: {
    新竹市: "O01",
  },
  // P 雲林縣
  P: {
    斗六市: "P01",
    斗南鎮: "P02",
    虎尾鎮: "P03",
    西螺鎮: "P04",
    土庫鎮: "P05",
    北港鎮: "P06",
    古坑鄉: "P07",
    大埤鄉: "P08",
    莿桐鄉: "P09",
    林內鄉: "P10",
    二崙鄉: "P11",
    崙背鄉: "P12",
    麥寮鄉: "P13",
    東勢鄉: "P14",
    褒忠鄉: "P15",
    臺西鄉: "P16",
    元長鄉: "P17",
    四湖鄉: "P18",
    口湖鄉: "P19",
    水林鄉: "P20",
  },
  // Q 嘉義縣
  Q: {
    朴子市: "Q02",
    布袋鎮: "Q03",
    大林鎮: "Q04",
    民雄鄉: "Q05",
    溪口鄉: "Q06",
    新港鄉: "Q07",
    六腳鄉: "Q08",
    東石鄉: "Q09",
    義竹鄉: "Q10",
    鹿草鄉: "Q11",
    太保市: "Q12",
    水上鄉: "Q13",
    中埔鄉: "Q14",
    竹崎鄉: "Q15",
    梅山鄉: "Q16",
    番路鄉: "Q17",
    大埔鄉: "Q18",
    阿里山鄉: "Q20",
  },
  // T 屏東縣
  T: {
    屏東市: "T01",
    潮州鎮: "T02",
    東港鎮: "T03",
    恆春鎮: "T04",
    萬丹鄉: "T05",
    長治鄉: "T06",
    麟洛鄉: "T07",
    九如鄉: "T08",
    里港鄉: "T09",
    鹽埔鄉: "T10",
    高樹鄉: "T11",
    萬巒鄉: "T12",
    內埔鄉: "T13",
    竹田鄉: "T14",
    新埤鄉: "T15",
    枋寮鄉: "T16",
    新園鄉: "T17",
    崁頂鄉: "T18",
    林邊鄉: "T19",
    南州鄉: "T20",
    佳冬鄉: "T21",
    琉球鄉: "T22",
    車城鄉: "T23",
    滿州鄉: "T24",
    枋山鄉: "T25",
    三地門鄉: "T26",
    霧臺鄉: "T27",
    瑪家鄉: "T28",
    泰武鄉: "T29",
    來義鄉: "T30",
    春日鄉: "T31",
    獅子鄉: "T32",
    牡丹鄉: "T33",
  },
  // U 花蓮縣
  U: {
    花蓮市: "U01",
    光復鄉: "U02",
    玉里鎮: "U03",
    新城鄉: "U04",
    吉安鄉: "U05",
    壽豐鄉: "U06",
    鳳林鎮: "U07",
    豐濱鄉: "U08",
    瑞穗鄉: "U09",
    富里鄉: "U10",
    秀林鄉: "U11",
    萬榮鄉: "U12",
    卓溪鄉: "U13",
  },
  // V 臺東縣
  V: {
    臺東市: "V01",
    成功鎮: "V02",
    關山鎮: "V03",
    卑南鄉: "V04",
    大武鄉: "V05",
    太麻里鄉: "V06",
    東河鄉: "V07",
    長濱鄉: "V08",
    鹿野鄉: "V09",
    池上鄉: "V10",
    綠島鄉: "V11",
    延平鄉: "V12",
    海端鄉: "V13",
    達仁鄉: "V14",
    金峰鄉: "V15",
    蘭嶼鄉: "V16",
  },
  // W 金門縣
  W: {
    金湖鎮: "W01",
    金沙鎮: "W02",
    金城鎮: "W03",
    金寧鄉: "W04",
    烈嶼鄉: "W05",
    烏坵鄉: "W06",
  },
  // X 澎湖縣
  X: {
    馬公市: "X01",
    湖西鄉: "X02",
    白沙鄉: "X03",
    西嶼鄉: "X04",
    望安鄉: "X05",
    七美鄉: "X06",
  },
  // Z 連江縣
  Z: {
    南竿鄉: "Z01",
    北竿鄉: "Z02",
    莒光鄉: "Z03",
    東引鄉: "Z04",
  },
};

/**
 * Cities with NO district sub-split on LVR: only a single city-wide town code.
 * A user-typed 區 (e.g. 新竹市東區, 嘉義市西區) is NOT a separate town here — it
 * flows into doorno. Map: cityCode → the single city-wide town code.
 */
const CITYWIDE_ONLY: Record<string, string> = {
  O: "O01", // 新竹市 — no 東區/北區 town split
  I: "I01", // 嘉義市 — no 東區/西區 town split
};

/**
 * Normalize for consistent lookups against the LVR table:
 *   台 (U+53F0) → 臺 (U+81FA)   — LVR uses 臺.
 *   巿 (U+5DFF) → 市 (U+5E02)   — LVR stores 頭份巿 with the variant glyph.
 */
function normalizeChar(s: string): string {
  return s.replace(/台/g, "臺").replace(/巿/g, "市");
}

/** Extract the city portion (anything ending in 市 or 縣 at the start). */
function matchCity(addr: string): { name: string; rest: string } | null {
  const m = addr.match(/^(.{1,3}?[市縣])(.*)$/);
  if (!m) return null;
  return { name: m[1], rest: m[2] };
}

/**
 * Resolve the district by matching against the city's town table.
 *
 * A simple non-greedy `[區鄉鎮市]` regex mis-splits names whose first chars are
 * themselves a district suffix — e.g. 前鎮區 would stop at 前鎮 (鎮). So we try
 * every candidate prefix that ends in a district suffix and pick the FIRST one
 * that exists in the table; if none match, fall back to the shortest suffixed
 * prefix so the caller can emit a precise "unknown district" error.
 */
function matchDistrict(
  rest: string,
  table: Record<string, string>,
): { name: string; rest: string } | null {
  let firstSuffixed: { name: string; rest: string } | null = null;
  for (let i = 1; i <= rest.length && i <= 5; i++) {
    const head = rest.slice(0, i);
    if (!/[區鄉鎮市]$/.test(head)) continue;
    const candidate = { name: head, rest: rest.slice(i) };
    if (firstSuffixed === null) firstSuffixed = candidate;
    if (table[head]) return candidate;
  }
  return firstSuffixed;
}

/**
 * Strip a trailing door-level 號 segment, keeping road + lane + alley.
 * e.g. "松德路169巷18號" → "松德路169巷"; "松德路169巷" → "松德路169巷".
 * Also drops anything after (and including) the 號 (e.g. 之/樓 suffixes).
 */
function stripDoorNumber(doorno: string): string {
  const idx = doorno.indexOf("號");
  if (idx === -1) return doorno;
  const head = doorno.slice(0, idx);
  return head.replace(/[0-9０-９]+$/, "");
}

interface ParsedPeriod {
  year: number;
  month: number;
}

interface ResolvedPeriodRange {
  starty: string;
  startm: string;
  endy: string;
  endm: string;
}

function parseWesternYearMonth(raw: string): ParsedPeriod | null {
  if (!/^\d{6}$/.test(raw)) return null;
  const year = Number.parseInt(raw.slice(0, 4), 10);
  const month = Number.parseInt(raw.slice(4, 6), 10);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** Western YYYYMM → ROC year/month conversion with strict validity guards. */
function resolvePeriodRange(
  input: QueryInput,
): ResolvedPeriodRange & { err?: Result<QueryParams> } {
  const from = parseWesternYearMonth(input.from);
  const to = parseWesternYearMonth(input.to);
  const empty = { starty: "", startm: "", endy: "", endm: "" };
  if (!from || !to) {
    return {
      ...empty,
      err: {
        code: "ERR_BAD_INPUT",
        error: `invalid date range: from=${input.from} to=${input.to}; expected western YYYYMM with month 01-12`,
      },
    };
  }

  const fromKey = from.year * 100 + from.month;
  const toKey = to.year * 100 + to.month;
  if (fromKey > toKey) {
    return {
      ...empty,
      err: {
        code: "ERR_BAD_INPUT",
        error: `invalid date range: from=${input.from} is after to=${input.to}`,
      },
    };
  }

  return {
    starty: String(from.year - 1911),
    startm: String(from.month),
    endy: String(to.year - 1911),
    endm: String(to.month),
  };
}

function queryType(input: QueryInput): "biz" | "sale" | "rent" {
  return input.queryType ?? "biz";
}

/**
 * Default ptype per query type. Sale/presale default to "1,2" (房地). Rent
 * reuses ptype as the 標的-category filter and needs the FULL set
 * "1,2,3,4,5,6,7": codes 1-5 carry old-form leases (≤112/08) + 土地(3)/車位(5);
 * codes 6 (租賃房屋) and 7 (租賃房屋+車位) carry every building lease reported
 * on the new form effective 112/09/01 — omitting them silently drops all
 * post-Aug-2023 building rentals (see docs/rent-schema-notes.md). The site's
 * own rent search sends 6,7 via its hidden rent_ptype field. Codes 6/7 alone
 * (without a 1-5 code present) return empty — always keep a 1-5 code in the set.
 */
function defaultPtype(input: QueryInput): string {
  if (input.ptype) return input.ptype;
  return queryType(input) === "rent" ? "1,2,3,4,5,6,7" : "1,2";
}

export function resolve(input: QueryInput): Result<QueryParams> {
  const whereRaw = (input.where ?? "").trim();
  if (!whereRaw) {
    return { code: "ERR_BAD_INPUT", error: "where (address) is empty" };
  }

  const where = normalizeChar(whereRaw);

  const cityMatch = matchCity(where);
  if (!cityMatch) {
    return {
      code: "ERR_BAD_INPUT",
      error: `could not find a city (市/縣) in address: ${whereRaw}`,
    };
  }

  const cityCode = CITY_CODES[cityMatch.name];
  if (!cityCode) {
    return {
      code: "ERR_BAD_INPUT",
      error: `unknown city: ${cityMatch.name}`,
    };
  }

  // ── City-wide-only cities (新竹市 O / 嘉義市 I): no district split. ──────────
  // The single city-wide town code is used. The user typically still types a
  // 區 (東區/西區/北區); that 區 is NOT an LVR town, so we DROP it and keep only
  // the road portion as doorno (matching how LVR indexes these single-town
  // cities). A bare city with no remainder is ambiguous → bad input.
  if (CITYWIDE_ONLY[cityCode]) {
    let remainder = cityMatch.rest.trim();
    if (!remainder) {
      return {
        code: "ERR_BAD_INPUT",
        error: `could not find a district/road in address: ${whereRaw}`,
      };
    }
    // Strip a leading pseudo-district (e.g. 東區/西區/北區) — it's not a town.
    const leadingDistrict = remainder.match(/^(.{1,4}?區)(.+)$/);
    if (leadingDistrict) remainder = leadingDistrict[2];
    const townCode = CITYWIDE_ONLY[cityCode];
    const doorno = stripDoorNumber(remainder);
    const { starty, startm, endy, endm, err } = resolvePeriodRange(input);
    if (err) return err;
    const ptype = defaultPtype(input);
    const resolvedLabel = doorno ? `${cityMatch.name} ${doorno}` : cityMatch.name;
    const data: QueryParams = {
      qryType: queryType(input),
      city: cityCode,
      town: townCode,
      doorno,
      starty,
      startm,
      endy,
      endm,
      ptype,
      resolvedLabel,
    };
    return { code: "OK", data };
  }

  const districtTable = TOWN_CODES[cityCode] ?? {};
  const districtMatch = matchDistrict(cityMatch.rest, districtTable);
  if (!districtMatch) {
    return {
      code: "ERR_BAD_INPUT",
      error: `could not find a district (區/鄉/鎮) in address: ${whereRaw}`,
    };
  }

  const townCode = districtTable[districtMatch.name];
  if (!townCode) {
    return {
      code: "ERR_BAD_INPUT",
      error: `unknown district for ${cityMatch.name}: ${districtMatch.name}`,
    };
  }

  // doorno = road/lane portion after the district, with door 號 stripped.
  const doorno = stripDoorNumber(districtMatch.rest.trim());

  const { starty, startm, endy, endm, err } = resolvePeriodRange(input);
  if (err) return err;

  const ptype = defaultPtype(input);

  const resolvedLabel = doorno
    ? `${cityMatch.name} ${districtMatch.name} ${doorno}`
    : `${cityMatch.name} ${districtMatch.name}`;

  const data: QueryParams = {
    qryType: queryType(input),
    city: cityCode,
    town: townCode,
    doorno,
    starty,
    startm,
    endy,
    endm,
    ptype,
    resolvedLabel,
  };

  return { code: "OK", data };
}
