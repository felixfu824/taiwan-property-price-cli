# Troubleshooting

Use this when `tw-lvr` returns a surprising result: `OK_EMPTY`, a district that
looks wrong, a community filter miss, malformed JSON/CSV, or a browser/runtime
failure.

## Fast Triage

1. Re-run with a small, inspectable output:

```bash
tw-lvr extract --where "<same query>" --from <YYYYMM> --to <YYYYMM> --top 10 --out tmp/lvr-debug.json --pretty
```

2. Read stderr for the resolved address/query summary and note the exit code.
3. Inspect the first few `address`, `building`, `buildingUnit`, `txnDate`,
   `totalPriceWan`, `siteAdjUnitPrice`, and `siteUnitPriceFormula` fields.
4. Do not rely on exact row counts; government data changes.

## Exit-Code Meaning

| Code | Meaning | Agent action |
|---:|---|---|
| 0 | OK or valid empty result | inspect rows or broaden query if empty |
| 2 | `ERR_BAD_INPUT` | fix city/district/date/address spelling |
| 3 | `ERR_SITE_CHANGED` | report maintainer issue; do not invent a workaround |
| 4 | `ERR_NETWORK` | retry once, then ask user to try later |
| 5 | `ERR_RATE_LIMITED` | back off; avoid repeated live queries |
| 6 | `ERR_ENV` | install browser or rerun outside sandbox |
| 7 | `PARTIAL` | inspect per-record warnings/counts before analysis |

## Browser and Sandbox Failures

If the message mentions `chrome-headless-shell`, `ERR_ENV`, `MachPortRendezvous`,
or `bootstrap_check_in`, this is environment setup, not a data/site claim.

```bash
npx playwright install chromium-headless-shell
```

If a browser binary already exists, set `LVR_HEADLESS_SHELL` to its path. In
Codex/macOS sandboxes, live Chromium often needs an escalated/outside-sandbox
run.

## `OK_EMPTY` or Too Few Rows

- Remove floor/door precision: search `路/街/段/巷` before exact `號`.
- Widen the period; `--from` and `--to` are western `YYYYMM` values.
- Check `--ptype`; default is `1,2`. A narrow `--ptype` can hide rows.
- If the target is 預售屋, rerun with `--query sale` or `--presale`; the default
  `--query biz` searches the buy/sell tab.
- For community/building names, prefer a broad district/road query plus
  `--community "<name>"`. The current implementation filters `building` after
  fetch; it is not yet the site's native `commid` selector.
- For district-wide pulls, always use `--out` and `--top` while debugging.

## District Looks Wrong

Check the returned `address` prefix. If it does not match the intended locality,
do not trust the result. Run the known regression canaries:

```bash
tw-lvr extract --where "新北市板橋區文化路一段" --from 202401 --to 202612 --top 5 --out tmp/banqiao.json
tw-lvr extract --where "新北市新莊區中正路" --from 202401 --to 202612 --top 5 --out tmp/xinzhuang.json
```

Expected: 板橋 query returns 板橋區 rows; 新莊 query returns 新莊區 rows. If either
fails, treat it as a code-table/site-contract regression and report the command,
version, stderr, exit code, and first few returned addresses.

## Citywide 新竹市 and 嘉義市

LVR has one citywide town code for 新竹市 and one for 嘉義市. User input may include
`東區`/`西區`, but returned live addresses may start with `新竹市...` or `嘉義市...`
instead of the pseudo-district. That is expected. Validate against the city and
road, not district prefix.

## JSON, CSV, and Schema Checks

- Use `--format json` or `--format csv` explicitly when debugging.
- `tw-lvr schema` explains table output; `tw-lvr schema --format json` gives
  machine-readable field definitions.
- CSV intentionally omits `meta`; JSON includes it.
- Unsupported formats should fail instead of silently falling back.

## Matching Leju-Style Rows

Use `buildingUnit` together with date, community, total price, area, and floor.
Presale rows can share the same date, price, and area across multiple units.

Known smoke examples:

```bash
tw-lvr extract --where "苗栗縣竹南鎮" --from 202601 --to 202612 --presale --community "藏富天下" --top 5 --out tmp/zhunan-presale.json --pretty
tw-lvr extract --where "金門縣金湖鎮" --from 202201 --to 202212 --query sale --community "金湖印象" --top 10 --out tmp/kinmen-presale.json --pretty
```

If `siteUnitPriceFormula` is `總價/總面積`, the displayed unit price is
parking-included/plain total-area. If it is
`(總價-車位總價)/(總面積-車位總面積)`, the site deducted parking.

## What To Include In A Bug Report

- Full command and `tw-lvr --version`.
- Exit code, stdout/stderr, and whether `--out` wrote a file.
- First 3 `address` and `building` values, if any.
- Node/Bun version and OS.
- Whether `npx playwright install chromium-headless-shell` has been run.
- Whether the command ran inside Codex/Claude sandbox or a normal terminal.
