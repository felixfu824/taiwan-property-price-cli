---
name: tw-lvr-cli
description: >-
  台灣實價登錄 CLI. Fetch the LATEST building-level real-estate transaction data
  from Taiwan's 內政部不動產實價登錄 (lvr.land.moi.gov.tw) as clean JSON. Use when the
  user wants recent transactions for an address, building, or 社區 (community) —
  especially rows newer than the quarterly open-data ZIP — building-level price
  comparisons, 查實價登錄, real price registry lookup, cross-check ZIP data, or 補錄交易.
  Writes results to disk with --out so large pulls never enter the model's context.
  For programmatic / agent use; a human eyeballing one building should use 591 or 樂居.
---

# tw-lvr-cli — latest Taiwan real-price transactions, as clean JSON

A deterministic, headless CLI. One command pulls building-level transactions
the way the government site loads them, then cleans and optionally refines them
into analysis-ready records. No server to run, no model in the loop.

**Lead benefit for agents:** keep the data out of your context window. The CLI
loads nothing into context until you invoke it via Bash, and `--out <file>`
writes results straight to disk so a large pull never streams through the model.

## When to use
- "查實價登錄 for [building/address]", "latest transactions for [社區]"
- Comparing recent sales across a building or community
- Cross-checking / supplementing the quarterly open-data ZIP with newer rows
- Bulk / district-scale pulls where inlining every row would blow the context window
- Any task needing recent Taiwan property transactions in structured form

## How to run
```
tw-lvr extract --where "台北市信義區松德路169巷" --from 2024 --to 2026 [--refine] [--ptype 1,2] [--query biz|sale] [--presale] [--top N] [--community <name>] [--out file.json|file.csv|dir/] [--format json|csv] [--pretty]
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
- `--top N` (alias `--limit N`) returns only the N most recent transactions; output is always sorted newest-first.
- Output is JSON by default (CSV if `--out` ends in `.csv` or `--format csv`); to stdout or `--out`. `--pretty` means indented JSON for humans.
- **Prefer `--out` for anything beyond a handful of rows**, then read back only the slice you need
  (`--top N`, or `jq`/`grep`/a follow-up Read on the file). This is the core context-saving move:
  a district-wide pull writes to disk in one command instead of injecting every row into your context.
- The matched address is echoed to stderr ("resolved: …") — confirm it before trusting results.
- **Time period (`--from`/`--to`) are WESTERN YEARS** (e.g. `2024`); the query spans January of `--from`
  through December of `--to`. **If the user gives no period, default to roughly the past 24 months: set
  `--from` to the current year minus 2 and `--to` to the current year.** (Year granularity means this is a
  slight superset of 24 months — narrow afterwards if the user wanted an exact window.)
- **Long spans / dense districts → chunk the year range.** One `extract` fetches the
  WHOLE district for the span (then filters), so a very large response fails with exit
  `4` `[ERR_NETWORK] ... evicted from inspector cache`. Verified ceiling: ~15k rows in
  one call is OK, ~17k fails — dense metros (e.g. 高雄鼓山, 台北信義) run ≈2k rows/yr, so
  ~7 years is the practical max there. **Default each call to ≤5 years; on ERR_NETWORK,
  halve the window and retry.** For longer history, split `[--from,--to]` into ≤5-year
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
`4` network (retry) · `5` rate limited (back off) · `6` environment/browser setup
(install the browser: `npx playwright install chromium-headless-shell`, or request Codex sandbox
escalation) · `7` partial (inspect per-record fields).

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

## Notes & limits
- Runtime: one transient headless browser (~2.5s/query, ~200MB). Requires the `chrome-headless-shell`
  browser binary — install with `npx playwright install chromium-headless-shell`, or set `LVR_HEADLESS_SHELL`.
- No `agent-browser` skill, logged-in Chrome profile, or interactive browser automation is required.
- In Codex, a macOS `MachPortRendezvous` / `bootstrap_check_in` permission error means the
  sandbox blocked Chromium. Rerun the command outside the sandbox/escalated; do not treat it
  as a site-change signal.
- Data source: 內政部 open data under the 政府資料開放授權條款 (OGDL / CC-BY). **Attribute 內政部** when redistributing.
- The data is de-identified by law (no owner names); do not attempt to re-identify owners.
