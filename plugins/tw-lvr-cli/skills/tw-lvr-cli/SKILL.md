---
name: tw-lvr-cli
description: >-
  TW Property Price CLI (台灣實價登錄 CLI). Fetch the LATEST building-level real-estate transaction data
  from Taiwan's 內政部不動產實價登錄 (lvr.land.moi.gov.tw) as clean JSON. Use when the
  user wants recent transactions for an address, building, or 社區 (community) —
  especially rows newer than the quarterly open-data ZIP — building-level price
  comparisons, 查實價登錄, real price registry lookup, cross-check ZIP data, 補錄交易,
  or RENTAL registrations (租賃查詢, 租金行情, rent comps, gross-yield inputs) via --rent.
  Writes results to disk with --out so large pulls never enter the model's context.
  For programmatic / agent use; a human eyeballing one building should use 591 or 樂居.
---

# TW Property Price CLI (tw-lvr-cli) — latest Taiwan property transactions, as clean JSON

A deterministic, headless CLI. One command pulls building-level transactions
the way the government site loads them, then cleans and optionally refines them
into analysis-ready records. No server to run, no model in the loop.

**Lead benefit for agents:** keep the data out of your context window. The CLI
loads nothing into context until you invoke it via Bash, and `--out <file>`
writes results straight to disk so a large pull never streams through the model.

## When to use
- "查實價登錄 for [building/address]", "latest transactions for [社區]"
- Comparing recent sales across a building or community
- Rental registrations (租賃實價登錄): rent comps, 租金行情, buy-vs-rent / gross-yield inputs — use `--rent`
- Cross-checking / supplementing the quarterly open-data ZIP with newer rows
- Bulk / district-scale pulls where inlining every row would blow the context window
- Any task needing recent Taiwan property transactions in structured form

## How to run
```
tw-lvr extract --where "台北市信義區松德路169巷" --from 202401 --to 202612 [--refine] [--ptype 1,2] [--query biz|sale|rent] [--presale] [--rent] [--top N] [--community <name>] [--out file.json|file.csv|dir/] [--format json|csv] [--pretty]
```
Also: `tw-lvr glossary` (output fields, origins, formulas), `tw-lvr schema` (alias),
`tw-lvr upgrade` (CLI + Skill update commands), `tw-lvr skill install --agent codex|claude`,
`tw-lvr --version`, `tw-lvr --help`.

- **If `tw-lvr` is not on PATH:** run it with no install via
  `npx -y tw-lvr-cli@latest extract ...` (same flags), or install globally with
  `npm i -g tw-lvr-cli`. Either way, install the browser once:
  `npx playwright install chromium-headless-shell`. (From a cloned repo:
  `bun run build`, then `node dist/cli.js extract ...`.)
- To update a copied Skill, first update the package (`npm install -g tw-lvr-cli@latest` or
  `bun add -g tw-lvr-cli@latest`), then run `tw-lvr skill install --agent codex` or
  `tw-lvr skill install --agent claude`. `tw-lvr upgrade --agent codex` prints the one-line command.
- `--refine` adds Layer B: comparable/site-displayed unit price, exclusion flags, confidence.
- `--query biz` is the default buy/sell tab. Use `--query sale` or `--presale` for 預售屋 examples.
- `--rent` (alias `--query rent`) switches to 租賃查詢 and returns a LEASE schema
  (`monthlyRentTwd` 元/月, `unitRentTwdPing` 元/坪/月, furniture/mgmt-org booleans, lease
  period) — NOT the sale fields. Money is in 元, not 萬.
  **Rent coverage is continuous and current** (e.g. 信義區: 809/917/1,354/1,699 rows for
  2022–2025) but the reporting FORM changed on 2023-09-01, so field availability differs
  by era: `rentalType`/`rentalService`/`hasElevator`/`equipment`/`rentPeriod` exist only
  on post-2023-09 leases, while `useClass` exists only on pre-2023-09 ones. Check the
  `coverage:` stderr line before trending, and never claim a trend off a year with n<10.
  (Versions <0.2.0 of this tool dropped all post-Aug-2023 building leases — if a rent
  pull shows a cliff after 2023, upgrade the CLI.)
  **Road-level rent queries are narrowed client-side:** the LVR rent endpoint ignores
  the road/lane part of `--where`, so the engine fetches the whole district and filters
  by address substring — a stderr `note:` reports district rows → road rows. Omit the
  road for a deliberate district-wide pull.
  `--refine` works with `--rent` too (net-of-parking rent, exclusion flags, 出租型態).
- `--top N` (alias `--limit N`) returns only the N most recent transactions; output is always sorted newest-first.
- Output is JSON by default (CSV if `--out` ends in `.csv` or `--format csv`); to stdout or `--out`. `--pretty` means indented JSON for humans.
- **Prefer `--out` for anything beyond a handful of rows**, then read back only the slice you need
  (`--top N`, or `jq`/`grep`/a follow-up Read on the file). This is the core context-saving move:
  a district-wide pull writes to disk in one command instead of injecting every row into your context.
- The matched address is echoed to stderr ("resolved: …") — confirm it before trusting results.
  Note 新竹市 and 嘉義市 resolve CITYWIDE (LVR has no district codes for them) — for
  cross-district/cross-city comparisons treat each as one citywide unit; a "新竹市東區"
  input does not narrow to 東區 (see `references/troubleshooting.md`).
  A `coverage:` stderr line shows per-year row counts and the date span of what came back —
  read it before claiming any trend (it exposes thin years instantly). With `--refine`, a
  second `usable (non-excluded):` line shows the per-year counts that survive the exclusion
  flags — **apply the n<10 rule to the usable counts, not the raw ones** (a commercial-heavy
  road can lose a third of its rows to 非住宅). The n<10 rule applies to ANY quoted
  statistic — trend points, medians, percentiles, "your rent sits at Xth percentile" —
  not just year-over-year trending.
- **Time period (`--from`/`--to`) are WESTERN `YYYYMM` months** (e.g. `202401`).
  **If the user gives no period, default to the current month and the previous 24 months.**
- **Long spans / dense districts → chunk the month range.** One `extract` fetches the
  WHOLE district for the span (then filters), so a very large response fails with exit
  `4` `[ERR_NETWORK] ... evicted from inspector cache`. Verified ceiling: ~15k rows in
  one call is OK, ~17k fails — dense metros (e.g. 高雄鼓山, 台北信義) run ≈2k rows/yr, so
  ~7 years is the practical max there. **Default each call to ≤60 months; on ERR_NETWORK,
  halve the window and retry.** For longer history, split `[--from,--to]` into ≤60-month
  chunks, run each, concatenate, sort by `txnDateRoc` descending, de-dupe by `detailKey`,
  then apply `--top`/`--community` on the merged set.

## Reference materials

Load these only when needed:

- `references/tested-samples.md` — runnable sample commands mirrored from the test/canary suite. Use it for demos, publish validation, smoke tests, or when a user wants examples to try.
- `references/troubleshooting.md` — investigation playbook for `OK_EMPTY`, district mismatches, citywide 新竹市/嘉義市 quirks, community-filter surprises, CSV/JSON checks, and browser/env failures.

If results look strange, load `references/troubleshooting.md` before explaining
the data. Re-run with `--top 10 --out tmp/lvr-debug.json`, inspect `address` and
`building`, and treat locality mismatches as a correctness investigation rather
than as valid market evidence.

### Typed exit codes (self-correct on these)
`0` ok / no matches · `2` bad input (fix the address) · `3` site changed (needs maintainer) ·
`4` network (retry) · `5` rate limited (back off) · `6` environment/browser setup ·
`7` partial (inspect per-record fields).

Exit `6` has two shapes — the error text tells you which: browser binary **missing** →
`npx playwright install chromium-headless-shell`; browser **launched but killed**
(`browserType.launch`/`bootstrap_check_in`/`Permission denied`) → your sandbox is blocking
process spawn or networking — rerun the same command outside the sandbox / with escalated
permissions. This is an environment issue, NOT a site change (never diagnose exit 3 from it).
For multi-query batches: if the FIRST call needed escalation, run every remaining call in
the batch escalated too — don't eat the same failure N times.

## Interpreting the output
Each record (with `--refine`):
- `rawUnitPrice` — 萬元/坪, TRUE raw = 總價 / 總面積 (parking still included).
- `siteAdjUnitPrice` / `adjUnitPrice` — 萬元/坪, the site's displayed unit price. Inspect
  `siteUnitPriceFormula`: `(總價-車位總價)/(總面積-車位總面積)` means parking-deducted;
  `總價/總面積` means parking-included/plain total-area.
- `buildingUnit` — the raw unit label for presale/building-unit rows, e.g. `A2棟0號`;
  use it with `building`, date, price, and area to identify Leju-style rows.
- `excluded` + `excludeReason` — drop `親友交易` / `純車位` / `非住宅` from analysis.
- `isPresale` — 預售屋; keep but note.
- `parkPriceIncluded` + `parkPriceSource` — parking exists but no separate parking price is reported. In this case the numerator stays native; no invented official parking price is subtracted.
- `confidence` + `parkingRefSource` — provenance of the adjustment basis. Treat as a rollup signal, not an independent valuation model.
- `txnDate` ("YYYY-MM"), `totalPriceWan`, `totalAreaPing`, `floor`, `layout`, `note`.

Without `--refine` you get faithful Clean Raw Records (no judgement) — refine yourself if you prefer.

With `--rent`, each record instead carries the lease schema (see `tw-lvr glossary --rent`):
- `monthlyRentTwd` — 月租金 in 元/月 (NOT 萬). `unitRentTwdPing` — 元/坪/月.
- `rentTarget` — 租賃標的 (建物/房地/車位/土地 pre-2023-09; 租賃房屋(±車位) after);
  `buildingType`, `layout`, `floor` as in sale.
- `hasMgmtOrg` / `hasFurniture` — 有無管理組織 / 附傢俱. `buildingAgeYears` — 屋齡 (0 often = unreported).
- Post-2023-09 leases also carry: `rentalType` (出租型態: 整戶出租/分層出租/獨立套房/
  分租套房/分租雅房), `rentalService` (租賃住宅服務), `hasElevator`, `equipment`
  (附屬設備 list), and a filled `rentPeriod` (租賃期間).
- **`rentalService` starting with `社會住宅` = subsidized social-housing lease** (below
  market; e.g. 信義區 median ~1,028 元/坪 vs market whole-flat ~1,300–2,100). Drop these
  rows before quoting market rent — they can be ~1/3 of a district's registrations.
- **`useClass` (住/商/其他) is the site's ZONING bucket, NOT the lease's actual use** —
  信義計畫區-style 特定專用區 luxury towers land in 其他, and the field is empty on
  post-2023-09 rows anyway. Never filter residential on it; rely on `excluded` instead.
- With `--refine`: `netRentTwd` (minus separately-reported 車位租金), `adjUnitRentTwdPing`,
  `rentKind` (exactly one of 整棟/獨立 · 套房 · 分層/其他 · 車位 · 土地 — uses reported
  `rentalType` when present, so room leases inside 公寓/大樓 land in 套房 correctly),
  `excluded`/`excludeReason` (親友交易 / 純車位 / 非住宅 — the latter covers both non-住
  主要用途 and commercial 建物型態 like 店面/辦公商業大樓), `confidence`.
- **Residential MARKET-rate rent-comp recipe:** median `unitRentTwdPing` over
  non-`excluded` rows (adj ≈ raw for most residential leases), MINUS
  `rentKind === "套房"` (studios/rooms ~7坪 run far higher per-坪 and skew a blended
  median), MINUS `rentalService.startsWith("社會住宅")` (subsidized). **These two cuts
  OVERLAP** (a subsidized lease can also be a 套房) — for segment shares, build a MECE
  split in this order: (1) drop `excluded`, (2) peel off `社會住宅*` (any kind), (3) peel
  off remaining `套房`, (4) the rest = market whole-flat. Shares must sum to the
  non-excluded total; if they don't, you double-counted the overlap. Mind the
  2023-09 form seam when trending across it: the reporter mix changes (broker-only
  before; brokers + rental-service businesses after), so a level shift at the seam
  is partly compositional. **Worse: `rentalService`/`rentalType` are UNLABELED on
  pre-seam rows, so 社會住宅 CANNOT be peeled from a 2022–2023H1 baseline** — a
  "market-rate" series that crosses the seam compares a subsidized-contaminated
  baseline against a cleanly-stripped endpoint and overstates the rise. Diagnostic:
  compute the 社會住宅* share of ALL rows per year; if it jumps at the seam (it
  usually does — observed 17%→84% in one district), quote within-era trends and
  explicitly discount the cross-seam magnitude.
- **Single-listing fairness checks ("這租金合理嗎?"):** compare within the same
  `rentKind` AND a size band around the target (±~30-40% of its 坪數 — the 套房
  bucket alone spans ~6 to 28坪 with very different per-坪 economics), against
  non-excluded, non-社會住宅 comps; then place the quote in that set's
  quartiles/percentiles. **If the market-rate comp set falls below n≈10 after
  peeling 社會住宅***, escalate geography (road → district) instead of quoting
  thin numbers — narrow road/型態 cuts can be MAJORITY-subsidized (observed: 68%
  of one road's 獨立套房 registrations), far above the ~1/3 district-level share.

## Notes & limits
- Runtime: one transient headless browser (~2.5s/query, ~200MB). Requires the `chrome-headless-shell`
  browser binary — install with `npx playwright install chromium-headless-shell`, or set `LVR_HEADLESS_SHELL`.
- No `agent-browser` skill, logged-in Chrome profile, or interactive browser automation is required.
- In Codex, a macOS `MachPortRendezvous` / `bootstrap_check_in` permission error means the
  sandbox blocked Chromium. Rerun the command outside the sandbox/escalated; do not treat it
  as a site-change signal.
- Data source: 內政部 open data under the 政府資料開放授權條款 (OGDL / CC-BY). **Attribute 內政部** when redistributing.
- The data is de-identified by law (no owner names); do not attempt to re-identify owners.
