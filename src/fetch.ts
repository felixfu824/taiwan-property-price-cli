/**
 * Fetch — the only impure stage. Drives a headless browser to carry lvr's
 * onload token sequence (which plain HTTP cannot replay), then intercepts the
 * QueryPrice JSON response.
 *
 * Runtime: one warm chrome-headless-shell process, reused across queries.
 * ~2.5s/query, ~200MB. No display, no AI-in-the-loop.
 */
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { QueryParams, RawRow, Result } from "./types.js";

const LIST_URL = "https://lvr.land.moi.gov.tw/jsp/list.jsp";
const QUERY_RE = /SERVICE\/QueryPrice\/[0-9a-f]{32}/;

let _browser: Browser | null = null;
let _ctx: BrowserContext | null = null;
let activeFetches = 0;
let closeInProgress: Promise<void> | null = null;
let idleWaiters: Array<() => void> = [];

async function beginFetch(): Promise<void> {
  if (closeInProgress) await closeInProgress;
  activeFetches += 1;
}

function endFetch(): void {
  activeFetches = Math.max(0, activeFetches - 1);
  if (activeFetches === 0) {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

async function waitForIdle(): Promise<void> {
  if (activeFetches === 0) return;
  await new Promise<void>((resolve) => idleWaiters.push(resolve));
}

/** Locate the chrome-headless-shell binary (env override or ms-playwright cache). */
export function resolveHeadlessShell(): string {
  if (process.env.LVR_HEADLESS_SHELL && existsSync(process.env.LVR_HEADLESS_SHELL))
    return process.env.LVR_HEADLESS_SHELL;
  try {
    const hit = execSync(
      `find "${process.env.HOME}/Library/Caches/ms-playwright" -name chrome-headless-shell -type f 2>/dev/null | head -1`,
      { encoding: "utf8" },
    ).trim();
    if (hit && existsSync(hit)) return hit;
  } catch { /* fall through */ }
  throw new Error(
    "chrome-headless-shell browser binary not found (this is the one non-JS dependency). " +
    "Fix: run `npx playwright install chromium-headless-shell` (downloads ~190MB into the " +
    "Playwright cache), then retry. Alternatively, point LVR_HEADLESS_SHELL at an existing " +
    "chrome-headless-shell binary. This is an environment setup issue (ERR_ENV), not a site change.",
  );
}

async function getContext(): Promise<BrowserContext> {
  if (_ctx) return _ctx;
  _browser = await chromium.launch({
    executablePath: resolveHeadlessShell(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
           "--disable-extensions", "--disable-background-networking", "--mute-audio", "--no-first-run"],
  });
  _ctx = await _browser.newContext();
  // Trim load: drop images/fonts/media + analytics. Keep JS/XHR (load-bearing).
  await _ctx.route("**/*", (route) => {
    const t = route.request().resourceType();
    const u = route.request().url();
    if (["image", "media", "font"].includes(t) || /google-analytics|googletagmanager|tawk/.test(u))
      return route.abort();
    return route.continue();
  });
  return _ctx;
}

/** Close the warm browser. Call on shutdown. */
export async function closeBrowser(): Promise<void> {
  if (closeInProgress) return closeInProgress;
  closeInProgress = (async () => {
    await waitForIdle();
    await _browser?.close().catch(() => {});
    _browser = null; _ctx = null;
  })();
  try {
    await closeInProgress;
  } finally {
    closeInProgress = null;
  }
}

/** Build the full lvr `form-data` localStorage object the page expects. */
function toFormData(p: QueryParams): Record<string, string> {
  return {
    qryType: p.qryType, city: p.city, town: p.town, ptype: p.ptype,
    starty: p.starty, startm: p.startm, endy: p.endy, endm: p.endm,
    doorno: p.doorno, tmoney_unit: "1", pmoney_unit: "1", unit: "2",
    ftype: "", p_build: "", price_s: "", price_e: "", unit_price_s: "", unit_price_e: "",
    area_s: "", area_e: "", buildyear_s: "", buildyear_e: "", pattern: "", community: "",
    floor: "", build_s: "", build_e: "", rent_type: "", rent_order: "",
    p_unusual_yn: "all", p_unusualcode: "", p_purpose: "", urban: "", nurban: "",
    aa12: "", QB41: "", show_avg: "",
  };
}

export interface FetchOptions { timeoutMs?: number; }

/** Run one query. Returns raw rows exactly as the site delivers them. */
export async function fetchRaw(params: QueryParams, opts: FetchOptions = {}): Promise<Result<RawRow[]>> {
  const timeout = opts.timeoutMs ?? 30000;
  await beginFetch();
  let ctx: BrowserContext;
  try {
    ctx = await getContext();
  } catch (e) {
    endFetch();
    return { code: "ERR_ENV", error: (e as Error).message };
  }
  const page = await ctx.newPage();
  try {
    const form = JSON.stringify(toFormData(params));
    await page.addInitScript(`try{localStorage.setItem('form-data', ${JSON.stringify(form)})}catch(e){}`);
    const respP = page
      .waitForResponse((r) => QUERY_RE.test(r.url()), { timeout })
      .catch(() => null);
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout }).catch(() => {});
    const resp = await respP;
    if (!resp) return { code: "ERR_SITE_CHANGED", error: "no QueryPrice response (onload sequence may have changed)" };
    const status = resp.status();
    if (status === 429) return { code: "ERR_RATE_LIMITED", error: `HTTP ${status}` };
    if (status >= 500) return { code: "ERR_SITE_CHANGED", error: `HTTP ${status} from QueryPrice` };
    const text = await resp.text();
    let rows: RawRow[];
    try { rows = JSON.parse(text); } catch { return { code: "ERR_SITE_CHANGED", error: "response not JSON" }; }
    if (!Array.isArray(rows)) return { code: "ERR_SITE_CHANGED", error: "response not an array" };
    if (rows.length === 0) return { code: "OK_EMPTY", data: [] };
    return { code: "OK", data: rows };
  } catch (e) {
    return { code: "ERR_NETWORK", error: (e as Error).message };
  } finally {
    await page.close().catch(() => {});
    endFetch();
  }
}
