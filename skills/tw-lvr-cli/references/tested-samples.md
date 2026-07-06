# Tested Samples

These commands mirror the project's test and live-canary coverage. Exact row
counts change as the government data changes, so validate invariants: exit code,
schema shape, address/locality prefix, sort order, and file creation.

## Quick Smoke

```bash
tw-lvr --help
tw-lvr schema --format json
tw-lvr extract --where "台北市信義區松德路169巷" --from 202401 --to 202612 --top 3 --pretty
tw-lvr extract --where "台北市信義區松德路169巷" --from 202401 --to 202612 --top 3 --format csv
tw-lvr extract --where "台北市信義區松德路169巷" --from 202401 --to 202612 --top 3 --out samples/songde.json
tw-lvr extract --where "苗栗縣竹南鎮" --from 202601 --to 202612 --presale --community "藏富天下" --top 5 --out samples/zhunan-presale.json
tw-lvr extract --where "台北市大安區" --from 202201 --to 202612 --rent --refine --top 5 --pretty
```

Expected: help and schema exit 0; JSON parses; CSV has escaped scalar fields and
omits `meta`; `--out` creates the file and keeps stdout small. The `--rent` sample
returns lease records (`monthlyRentTwd` in 元, `rentTarget`, `hasFurniture`) with
continuous per-year counts on the `coverage:` stderr line — a cliff after 2023
means an old (<0.2.0) CLI that lacked the new-form ptype codes.

## Live Canaries

Use `--top 5 --out <file>` for large/coarse queries.

| Command core | Expected invariant |
|---|---|
| `--where "臺北市信義區信義路五段"` | returned `address` values are 信義區 records |
| `--where "新北市板橋區文化路一段"` | returned `address` values are 板橋區 records, not 新莊區 |
| `--where "新北市新莊區中正路"` | returned `address` values are 新莊區 records |
| `--where "高雄市苓雅區" --top 5` | returned `address` values are 苓雅區 records |
| `--where "新竹縣竹北市光明六路"` | returned `address` values are 竹北市 records |
| `--where "嘉義市西區友愛路"` | returned `address` values start with 嘉義市; LVR is citywide here |
| `--where "臺北市信義區信義路五段" --community "信義香榭"` | every output row has `building` containing 信義香榭 |
| `--where "苗栗縣竹南鎮" --presale --community "藏富天下"` | returns presale rows with `buildingUnit` such as B2/A2 and `siteUnitPriceFormula=總價/總面積` |
| `--where "金門縣金湖鎮" --query sale --community "金湖印象"` | returns presale rows for 金湖印象; use `buildingUnit` to match listing rows |
| `--where "台北市信義區信義路五段" --from 202201 --to 202612 --rent` | every `address` contains 信義路五段 (rent road filter is client-side; stderr `note:` shows district→road counts) |
| `--where "台北市信義區" --from 202401 --to 202612 --rent --top 5` | `coverage:` shows non-trivial 2024+ counts (hundreds+/yr) incl. `rentTarget` 租賃房屋 building leases, not just 車位/土地 |

Example:

```bash
tw-lvr extract --where "新北市板橋區文化路一段" --from 202401 --to 202612 --top 5 --out samples/banqiao.json --pretty
```

## Input Quirk Samples

These are useful when checking address parsing.

| Input | Expected behavior |
|---|---|
| `台北市信義區松德路169巷` | `台` normalizes to `臺`; resolves as 臺北市信義區 |
| `臺北市信義區信義路五段１６９號` | full-width door number before `號` is stripped; road remains 信義路五段 |
| `臺北市信義區松德路１６９巷` | full-width digits inside `巷` are kept as part of the road/lane |
| `苗栗縣頭份巿中央路` | variant glyph `巿` normalizes to `市`; resolves to 頭份市 |
| `高雄市前鎮區中山二路` | `前鎮區` stays intact; do not split on the `鎮` character |
| `新竹市東區關新路` | 新竹市 has one citywide LVR town code; returned addresses may start 新竹市, not 東區 |
| `嘉義市西區友愛路` | 嘉義市 has one citywide LVR town code; returned addresses may start 嘉義市, not 西區 |
| `新竹縣竹北市光明六路` | `竹北市` is a district-level town under 新竹縣 |

## Bad Input Samples

These should fail clearly with `ERR_BAD_INPUT` and exit code 2.

```bash
tw-lvr extract --where "信義路五段" --from 202401 --to 202612
tw-lvr extract --where "臺北市" --from 202401 --to 202612
tw-lvr extract --where "臺北市不存在區信義路五段" --from 202401 --to 202612
tw-lvr extract --where "臺北市信義區信義路五段" --from abc --to 202612
```
