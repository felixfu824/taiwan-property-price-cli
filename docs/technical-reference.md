# TW Property Price CLI Technical Reference

TW Property Price CLI (`tw-lvr-cli` on npm, `tw-lvr` on the command line) turns Taiwan Ministry of the Interior real-price registry data (`內政部不動產實價登錄`) into clean JSON or CSV for scripts, applications, and AI agents.

It is a deterministic CLI plus importable TypeScript library. It launches a short-lived headless Chromium session, follows the same public registry flow as the website, normalizes the returned transaction rows, and optionally adds analysis-oriented flags. It does not run a server and does not use a model in the extraction loop.

The tool is unaffiliated with the Ministry of the Interior (`內政部`) and is provided as-is.

## Scope

Use this tool when you need programmatic access to recent Taiwan property transaction rows:

- Fetch building-level transaction records for an address, road, district, building, or community.
- Write large result sets to disk as JSON or CSV.
- Feed structured transaction records into an app, backend, CI job, cron job, notebook, or agent workflow.
- Cross-check or supplement quarterly public-data ZIP workflows with rows available through the live registry site.

Covered today:

- Existing-home sale queries (`--query biz`, the default).
- Presale unit queries (`--query sale` or `--presale`).

Not covered today:

- Rental queries.
- Presale project registry queries.
- Browser UI replacement for a person checking one property manually.

For one-off human browsing, consumer websites such as 591 or Leju may be more convenient. TW Property Price CLI is designed for code and agent workflows.

## Requirements

- Node.js `>=18`.
- npm, bun, or `npx`.
- Playwright's `chromium-headless-shell` browser binary.

The npm package depends on `playwright-core`; the browser binary is intentionally installed separately.

## Install

Install the CLI globally with npm:

```bash
npm i -g tw-lvr-cli
```

Or with bun:

```bash
bun add -g tw-lvr-cli
```

Install the required headless browser once:

```bash
npx playwright install chromium-headless-shell
```

If the browser is missing, `tw-lvr` exits with code `6` (`ERR_ENV`) and prints the browser install command.

You can also run the package without a global CLI install:

```bash
npx -y tw-lvr-cli@latest extract --where "新竹市東區關新路" --from 2024 --to 2026 --top 3 --pretty
```

The one-off `npx` form still requires `chromium-headless-shell` to be installed.

## Quick Start

Fetch the three newest transactions for a road:

```bash
tw-lvr extract --where "新竹市東區關新路" --from 2024 --to 2026 --top 3 --pretty
```

Results are sorted newest first. A typical JSON record includes:

```json
{
  "building": "丹麥",
  "address": "新竹市關新路19巷99號二樓",
  "txnDateRoc": "114/12/27",
  "totalPriceWan": 2380,
  "siteAdjUnitPrice": 48.1445,
  "totalAreaPing": 49.43,
  "layout": "3房2廳2衛"
}
```

For more than a handful of rows, write results to disk:

```bash
tw-lvr extract --where "新北市板橋區文化路一段" --from 2023 --to 2026 --out transactions.csv
```

Use presale mode with either `--presale` or `--query sale`:

```bash
tw-lvr extract --where "苗栗縣竹南鎮" --from 2026 --to 2026 --presale --community "藏富天下" --top 5 --pretty
```

Add `--refine` when you want analysis-oriented fields such as adjusted unit price, exclusion flags, and confidence:

```bash
tw-lvr extract --where "台北市信義區松德路169巷" --from 2024 --to 2026 --refine --pretty
```

## Commands and Flags

### `extract`

`extract` is the main command.

```bash
tw-lvr extract --where <address> --from <YYYY> --to <YYYY>
               [--refine] [--ptype 1,2] [--query biz|sale | --presale]
               [--top N | --limit N] [--community <name>]
               [--out <file|dir/>] [--format json|csv] [--pretty]
```

Flags:

| Flag | Meaning |
|---|---|
| `--where <address>` | Address, road, district, building area, or locality to search. Required. |
| `--from <YYYY>` | Start year in western calendar. Required. The query starts in January of this year. |
| `--to <YYYY>` | End year in western calendar. Required. The query runs through December of this year. |
| `--refine` | Adds Layer B fields: adjusted/comparable unit price, exclusion flags, parking provenance, and confidence. |
| `--ptype <codes>` | Property type codes. Default is `1,2` (`房地`). Common site codes include `3` land, `4` building, and `5` parking. |
| `--query biz|sale` | Query type. `biz` is the default existing-home sale tab; `sale` is presale. |
| `--presale` | Alias for `--query sale`. |
| `--community <name>` | Post-filters returned rows where `building` includes the community/building name. |
| `--top N` | Keeps only the N newest transactions after sorting. |
| `--limit N` | Alias for `--top N`. |
| `--out <file|dir/>` | Writes output to a file or directory. If a directory is passed, the CLI auto-generates a filename from the resolved query label and year range. |
| `--format json|csv` | Output format. Defaults to JSON; inferred as CSV if `--out` ends in `.csv`. |
| `--pretty` | Pretty-prints JSON with indentation. |

Notes:

- Output is always sorted newest first by `txnDateRoc`.
- The resolved query label is printed to stderr as `resolved: ...`.
- Status and row counts are printed to stderr; data is printed to stdout unless `--out` is used.
- Large or dense queries should be split into year chunks. A practical default is five years or less per call.
- If an oversized response fails with `ERR_NETWORK`, retry with a smaller year window.

### `glossary` and `schema`

`glossary` explains output fields, origins, and formulas:

```bash
tw-lvr glossary
tw-lvr glossary --layer clean
tw-lvr glossary --layer refined
tw-lvr glossary --format json
```

`schema` is an alias kept for scripts:

```bash
tw-lvr schema --format json
```

`--layer` accepts `clean`, `refined`, or `all`. `--format` accepts `table` or `json`.

### `skill`

The npm package bundles an Agent Skill in `skills/tw-lvr-cli`.

Show the bundled skill path:

```bash
tw-lvr skill path
```

Install the bundled skill into a supported agent skill directory:

```bash
tw-lvr skill install --agent codex
tw-lvr skill install --agent claude
```

Override the destination root if needed:

```bash
tw-lvr skill install --agent codex --target /path/to/skills
```

### `upgrade`

Print package and Skill update commands:

```bash
tw-lvr upgrade
tw-lvr upgrade --manager npm --agent codex
tw-lvr upgrade --manager bun --agent claude
```

`update` is accepted as an alias for `upgrade`.

### Help and Version

```bash
tw-lvr --help
tw-lvr --version
```

## Output Model

The pipeline has two output layers.

Layer A, Clean Raw Records, is returned by default. It is a faithful normalized form of the source row: names, units, dates, and types are cleaned, but no analytical judgment is applied.

Layer B, Refined Records, is returned when `--refine` is used. It extends Clean Raw Records with comparable-price fields, exclusion flags, parking adjustment provenance, and confidence.

For the complete field dictionary, run:

```bash
tw-lvr glossary
```

Or for machine-readable definitions:

```bash
tw-lvr glossary --format json
```

### Core Clean Fields

| Field | Meaning |
|---|---|
| `building` | Community or building name from the site, empty if unknown. |
| `buildingUnit` | Presale/building unit label when available, for example `A2棟0號`. |
| `address` | Human-readable transaction address normalized to half-width digits. |
| `addrNum` | Door number parsed from `address`. |
| `txnDate` | Transaction month in western calendar, formatted as `YYYY-MM`. |
| `txnDateRoc` | Raw transaction date in ROC calendar, formatted as `YYY/MM/DD`. |
| `totalPriceWan` | Total transaction price in `萬元`; may include parking. |
| `rawUnitPrice` | Raw `萬元/坪`, computed as `totalPriceWan / totalAreaPing`, with parking still bundled. |
| `siteAdjUnitPrice` | Site-reported unit price in `萬元/坪`; inspect `siteUnitPriceFormula` to know whether parking was deducted. |
| `siteUnitPriceFormula` | Site formula text for displayed unit price, such as `總價/總面積` or `(總價-車位總價)/(總面積-車位總面積)`. |
| `totalAreaPing` | Total transferred floor area in ping. |
| `totalAreaM2` | Total transferred floor area in square metres. |
| `mainBuildingPct` | Main-building area percentage. |
| `mainAreaM2` | Main-building area in square metres when derivable. |
| `parkPriceWan` | Reported parking price in `萬元`; zero does not necessarily mean no parking. |
| `parkAreaM2` | Parking area when available; may be `null`. |
| `parkCount` | Best-effort parking-space count parsed from transaction subject text. |
| `txnType` | Transaction subject, for example `房地(土地+建物)+車位`. |
| `floor` | Transferred floor and total floors. |
| `buildingType` | Building type such as residential tower, apartment, or suite. |
| `mainUse` | Main use, for example `住家用`. |
| `layout` | Room layout, for example `3房2廳2衛`. |
| `hasElevator` | Boolean elevator flag. |
| `note` | Registry note text; exclusion signals often appear here. |
| `lat` / `lon` | Coordinates from the live site response. |
| `detailKey` | Opaque site detail key from the source row. |
| `meta` | Provenance object such as `fetchedAt` and `queryId`; omitted from CSV output. |

### Refined Fields

These fields are added only with `--refine`.

| Field | Meaning |
|---|---|
| `netPriceWan` | Price numerator after subtracting separately reported parking price. If parking price is bundled or unreported, the numerator stays as `totalPriceWan`. |
| `netAreaPing` | Area denominator after reported or inferred parking area is removed. |
| `adjUnitPrice` | Comparable unit-price field in `萬元/坪`; usually mirrors the site-displayed unit price when present. |
| `excluded` | `true` when the row should be dropped from comparable-price analysis. |
| `excludeReason` | Exclusion reason, such as `親友交易`, `純車位`, `非住宅`, or an empty string. |
| `isPresale` | `true` when the row is identified as presale. |
| `parkPriceIncluded` | `true` when parking exists but no separate parking price is reported. |
| `parkPriceSource` | Price subtraction provenance: `none`, `reported`, or `included_in_total`. |
| `parkAreaUnreported` | `true` when parking exists but parking area is missing. |
| `parkingRefSource` | Parking-area adjustment basis: `reported`, `derived`, `district_fallback`, or `curated`. |
| `confidence` | Rollup signal for adjusted figures: `high`, `medium`, or `low`. This is a data-quality flag, not a valuation model. |

## Exit Codes

| Code | Outcome | Meaning |
|---:|---|---|
| `0` | `OK` / `OK_EMPTY` | Successful query, including valid queries with zero matches. |
| `2` | `ERR_BAD_INPUT` | Invalid address, year range, query type, output format, or CLI usage. |
| `3` | `ERR_SITE_CHANGED` | Source site contract changed; maintainer investigation required. |
| `4` | `ERR_NETWORK` | Network failure or oversized response. Retry, then reduce the query window if needed. |
| `5` | `ERR_RATE_LIMITED` | Source site throttled or blocked the request. Back off before retrying. |
| `6` | `ERR_ENV` | Browser binary, sandbox, or runtime environment problem. |
| `7` | `PARTIAL` | Some downstream records failed while others succeeded. Inspect counts and output before analysis. |

## Architecture

```text
Resolve -> Fetch -> Normalize -> Refine
```

### Resolve

Parses a human-readable address and western year range into the query parameters expected by the public registry site.

Input:

- `where`: address or locality string, such as `台北市信義區松德路169巷`.
- `from` / `to`: western years, such as `2024` and `2026`.
- `ptype`: property type codes, default `1,2`.
- `queryType`: `biz` or `sale`.

Output includes city/town codes, door/address text, ROC year/month fields, property type codes, and a human-readable `resolvedLabel`.

### Fetch

Launches a transient headless Chromium session and captures the site's raw `QueryPrice` transaction rows. The browser is closed after the query.

The fetch stage uses the public `lvr.land.moi.gov.tw` website flow. It does not require a logged-in browser profile, cookies, an MCP server, or an interactive browser automation session.

### Normalize

Converts raw site rows into typed Clean Raw Records:

- Normalized field names.
- Prices in `萬元`.
- Areas in ping and square metres.
- ROC dates preserved as `txnDateRoc`, with western month in `txnDate`.
- Parsed address, door number, parking count, elevator flag, and other structured values.

Normalize does not apply subjective exclusions or comparable-price judgment.

### Refine

Runs only when `--refine` or the `extractRefined()` API is used. It adds:

- Net price and net area.
- Adjusted unit price.
- Exclusion flags and reasons.
- Presale and parking provenance flags.
- Confidence rollup.

`confidence` and exclusion fields are intended for analysis hygiene. They are not appraisal outputs.

## Library API

The package exports the same engine used by the CLI.

```ts
import { extract, extractRefined } from "tw-lvr-cli";
import type { CleanRawRecord, RefinedRecord, QueryInput, Result } from "tw-lvr-cli";

const input: QueryInput = {
  where: "新竹市東區關新路",
  from: "2024",
  to: "2026",
};

const raw: Result<CleanRawRecord[]> = await extract(input);
const rows = raw.data ?? [];

console.log(rows[0]?.totalPriceWan);

const refined: Result<RefinedRecord[]> = await extractRefined(input);
```

Public exports include:

```ts
export { extract, extractRefined, resolve, fetchRaw, normalize, refine, closeBrowser };
export type { QueryInput, CleanRawRecord, RefinedRecord, Result, OutcomeCode, RefineOptions };
```

`extract(input)` returns `Promise<Result<CleanRawRecord[]>>`.

`extractRefined(input)` returns `Promise<Result<RefinedRecord[]>>`.

Callers should branch on `result.code` rather than parsing error text.

### QueryInput

```ts
interface QueryInput {
  where: string;
  from: string;
  to: string;
  ptype?: string;
  queryType?: "biz" | "sale";
}
```

### Result Codes

```ts
type OutcomeCode =
  | "OK"
  | "OK_EMPTY"
  | "ERR_BAD_INPUT"
  | "ERR_SITE_CHANGED"
  | "ERR_ENV"
  | "ERR_NETWORK"
  | "ERR_RATE_LIMITED"
  | "PARTIAL";
```

## Plugin Usage

The repository ships a Claude/Codex-compatible plugin containing an Agent Skill. The Skill is the instruction layer; the `tw-lvr` CLI does the data extraction.

Claude Code:

```text
/plugin marketplace add felixfu824/taiwan-property-price-cli
/plugin install tw-lvr-cli@tw-lvr-cli
```

Codex:

```bash
codex plugin marketplace add felixfu824/taiwan-property-price-cli
codex plugin add tw-lvr-cli@tw-lvr-cli
```

The npm package also bundles the Skill, so users can copy it into an agent skill directory:

```bash
tw-lvr skill install --agent codex
tw-lvr skill install --agent claude
```

After upgrading the npm package, refresh the copied Skill:

```bash
npm install -g tw-lvr-cli@latest
tw-lvr skill install --agent codex
```

Or print agent-specific update commands:

```bash
tw-lvr upgrade --agent codex
```

## Agent Usage

Agents should treat `tw-lvr` as an external data tool:

1. Run `tw-lvr extract` from the shell.
2. Use `--out` for anything beyond a few rows.
3. Read back only the required slice of the output file.
4. Avoid pasting district-scale JSON or CSV into the model context.

Recommended agent pattern:

```bash
tw-lvr extract --where "新北市板橋區文化路一段" --from 2023 --to 2026 --out tmp/banqiao.json
```

Then inspect with normal file tools:

```bash
jq '.[0:10] | map({building, address, txnDateRoc, totalPriceWan, siteAdjUnitPrice, totalAreaPing})' tmp/banqiao.json
```

For broad or dense searches:

- Use `--out`.
- Query at most five years per call by default.
- On `ERR_NETWORK`, halve the year window and retry.
- Concatenate chunked outputs, sort by `txnDateRoc` descending, and de-duplicate by `detailKey` if building a merged history.
- Use `--top N`, `jq`, or a follow-up file read to keep context small.

If the user gives no period, a practical agent default is the current year and the previous two years. Because the CLI accepts whole years, this is an approximate 24-month window and may include extra months.

Agents should verify stderr's `resolved: ...` line before relying on results. If returned addresses do not match the intended locality, treat the output as a query-resolution issue, not market evidence.

## Data and License

Data source:

- Taiwan Ministry of the Interior real-price registry open data (`內政部不動產實價登錄`).
- License: Open Government Data License (`政府資料開放授權條款`, OGDL), convertible to CC BY 4.0.
- Attribution to `內政部` is required when redistributing data.
- Registry data is de-identified by law; do not attempt to re-identify owners or parties.

Code:

- Apache-2.0. See `LICENSE` and `NOTICE`.

Privacy:

- Runs locally.
- Sends no telemetry.
- Collects no personal data.
- Creates no account.
- Writes output only to stdout or the local path passed with `--out`.
- Outbound network requests are limited to the public registry site (`lvr.land.moi.gov.tw`) for fetching public transaction rows.

Disclaimer:

- Not affiliated with, endorsed by, or sponsored by `內政部`.
- Provided as-is, without warranty.

## Troubleshooting

### `chrome-headless-shell` is missing

Symptom:

- Exit code `6`.
- Error mentions `ERR_ENV`, `chrome-headless-shell`, or browser setup.

Fix:

```bash
npx playwright install chromium-headless-shell
```

If a compatible browser binary already exists, set `LVR_HEADLESS_SHELL` to its path.

### Browser sandbox failure

Symptom:

- Error mentions `MachPortRendezvous`, `bootstrap_check_in`, or sandboxed Chromium startup.

Fix:

- Treat this as an environment problem, not a source-site change.
- Run outside the sandbox or with the host tool's approved escalation mechanism.

### `OK_EMPTY` or too few rows

Try:

- Remove exact floor or door-number precision.
- Search by road, lane, district, or city before narrowing.
- Widen the year range.
- Confirm that `--from` and `--to` are western years.
- Check `--ptype`; the default is `1,2`.
- Use `--presale` or `--query sale` for presale units.
- For community names, use a broad road or district query plus `--community "<name>"`.

Debug with a small file:

```bash
tw-lvr extract --where "<same query>" --from <YYYY> --to <YYYY> --top 10 --out tmp/lvr-debug.json --pretty
```

Inspect `address`, `building`, `buildingUnit`, `txnDateRoc`, `totalPriceWan`, `siteAdjUnitPrice`, and `siteUnitPriceFormula`.

### Response too large

Symptom:

- Exit code `4`.
- Error code `ERR_NETWORK`.
- Error may mention an oversized response or inspector-cache eviction.

Fix:

- Split the query into smaller year windows.
- Use five years or less per call by default.
- For very dense districts, reduce further.

### Rate limited

Symptom:

- Exit code `5`.
- Error code `ERR_RATE_LIMITED`.

Fix:

- Back off and retry later.
- Avoid repeated live queries in a tight loop.

### Source site changed

Symptom:

- Exit code `3`.
- Error code `ERR_SITE_CHANGED`.

Fix:

- Open a GitHub issue with the full command, `tw-lvr --version`, exit code, stderr, and a small sample of returned rows if any.
- Do not treat site-change errors as valid market data.

### District looks wrong

Check the returned `address` prefix. If it does not match the intended locality, do not trust the result.

For Hsinchu City and Chiayi City, the registry uses citywide town codes. User input may include pseudo-districts such as `東區` or `西區`, while returned live addresses may start with `新竹市...` or `嘉義市...`. Validate against the city and road in those cases.

### CSV and JSON checks

- Use `--format json` or `--format csv` explicitly when debugging.
- CSV omits the nested `meta` object.
- JSON includes `meta`.
- Unsupported output formats fail with exit code `2` instead of silently falling back.

### Bug reports

Include:

- Full command.
- `tw-lvr --version`.
- Exit code.
- stdout and stderr.
- Whether `--out` wrote a file.
- First three `address` and `building` values, if present.
- Node or Bun version.
- Operating system.
- Whether `npx playwright install chromium-headless-shell` has been run.
- Whether the command ran inside an agent sandbox or a normal terminal.

