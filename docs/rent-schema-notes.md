# Rental (租賃) raw schema — captured 2026-07-02; two-form era model added 2026-07-05

Ground-truth capture of the `qryType=rent` QueryPrice response from
lvr.land.moi.gov.tw (list.jsp), so rental support is built against real fields,
not guesses. Probe artifacts (throwaway) lived under `tmp/rent-probe/`; the
distilled fixture is `test/fixtures/rent_response.json` (51 diverse rows, both
form eras).

## THE TWO-FORM ERA SPLIT (the single most load-bearing fact)

MOI switched the rental 申報書 format effective **112/09/01 (2023-09-01)**.
The interactive query keys the two eras to DIFFERENT `ptype` codes:

| era | 簽約日 | `ptype` codes | `t` (租賃標的) values |
|---|---|---|---|
| old form | ≤ 112/08 | 1,2,4 (buildings), 3 (土地), 5 (車位) | 建物 / 房地(土地+建物)(±車位) / 車位 / 土地 |
| new form | ≥ 112/09 | **6** (租賃房屋), **7** (租賃房屋+車位) | 租賃房屋 / 租賃房屋+車位 |

Querying with `ptype "1,2,3,4,5"` therefore returns **zero building leases
after Aug 2023** (only 車位/土地 keep flowing through 5/3) — which looks
exactly like a data cliff and was misdiagnosed as one on 2026-07-02. The
registry itself is healthy and current (信義區: 809/917/1,354/1,699 building
rows for 2022–2025 with the full code set; the site's own announcements
confirm updates through the current month).

Two server quirks, verified by direct QueryPrice probes (2026-07-05):

- Codes **6/7 alone return empty** — at least one legacy 1-5 code must be in
  the set. The site's own rent search sends 6,7 via a hidden `rent_ptype`
  field (default `"1,2,4,6,7"`) alongside `ptype`, but on list.jsp it is
  `ptype` that does the work.
- No overlap/double-count across the seam: monthly counts flow smoothly
  through 112/08→112/09 and all `sq` detail keys stay unique.

**The engine's rent default is `ptype "1,2,3,4,5,6,7"`** — full history, both
eras, plus 土地 and 車位.

## Query params (differences from 買賣/預售)

- `qryType: "rent"`.
- **`ptype` for rent means the 標的 category** — see the two-form table above.
  The working "give me everything" value is **`ptype: "1,2,3,4,5,6,7"`**.
- `f_type` (building-type checkbox filter: 01公寓…05住宅大樓/07套房/L土地/P車位) is
  **ignored by list.jsp** — it's a search-page display filter, not a query param.
- `rent_type` (出租型態 checkbox filter, values 1-5) / `rent_order` are accepted
  but not required; `rent_ptype` is the search page's hidden mirror of ptype.

## Raw row keys (rent)

Shares the sale envelope but **reuses keys with different meaning**. Fields
whose availability differs by form era are marked.

| key | rent meaning | notes |
|---|---|---|
| `a` | address (full-width) | land rows carry 地號, not door address |
| `e` | 簽約年月日 (ROC `YYY/MM/DD`) | |
| `tp` | **月租金 (元)** | NOT 萬; this is total monthly rent (租金總額) |
| `p` | **單價 = 租金/坪/月 (元)** | `tp / s` |
| `s` | 面積 (坪) | |
| `cp` | 車位租金 (元/月) | empty unless parking |
| `msg` | unit-rent formula | `總價/總面積`, or parking-deducted variant |
| `t` | 租賃標的 | old form: 建物 / 房地(土地+建物)(±車位) / 車位 / 土地; new form: 租賃房屋(±車位) |
| `b` | 建物型態 | 住宅大樓/華廈/公寓/店面/套房/… ("" for land) |
| `bn` / `commid` | 社區名 / 社區 id | |
| `f` | 樓別/樓高 | e.g. 八層/九層 |
| `v` | 格局 | e.g. 2房2廳2衛 |
| `pu` | 主要用途 | 住家用/商業用/…; new form adds 集合住宅/見使用執照/… |
| `AA11` | 用途類別 | 住/商/其他 — **old form only** (~94% empty on new-form rows) |
| `m` | **有無管理組織** | 有/無/"" |
| `fn` | old form: **有無附傢俱** 有/"" | new form: **附屬設備 comma list** (冷氣、熱水器、…、傢俱) — 傢俱 appears as a list item |
| `g` | **屋齡 (年)** | inferred; independent of floor |
| `rperiod` | 租賃期間 | `1150505~1200504`; ~100% filled new form, ~0% old form |
| `rtype` | **出租型態** | 整戶出租/分層出租/獨立套房/分租套房/分租雅房 — **new form only** (~85% filled there; "" old form) |
| `rserviec` | **租賃住宅服務** (sic, site typo) | 一般轉租/一般代管/一般包租/社會住宅代管/社會住宅包租轉租; "" = none. 社會住宅* = subsidized |
| `el` | **有無電梯** | 有/無 — new form only ("" old form) |
| `note` | 備註 | exclusion signals (親友/含管理費/含車位…); new form adds 續租案件 etc. |
| `lat`/`lon` | coords | |
| `sq` | detail key | |
| `type` | `"Rent"` | record-type tag |

Empty-always in rent (both eras): `es`, `bs`, `fi`, `AA12`.
Ambiguous / not surfaced: `ho` (mostly empty; correlates loosely with 房數 but
overlaps `v`), `r`, `j/k/l` (筆數-style counts). Left in the raw row but not
promoted into CleanRentRecord.

## 出租型態 (整戶/分層/獨立套房/分租套房/分租雅房)

Reported directly in the list JSON for new-form rows (`rtype`, promoted to
`rentalType`). Old-form rows never carry it — `rentKind` falls back to the
標的+建物型態 proxy there. Note room leases (獨立套房/分租套房/分租雅房) sit in
公寓/華廈/大樓/透天 building types; segmenting 套房 by `b` alone misses them
(信義區 new-form era: 1,435 of 4,197 rows are room leases by `rtype`).

## 租賃住宅服務 and market-rate comps

~2/3 of new-form rows involve a rental-service business. 社會住宅代管 /
社會住宅包租轉租 rows are **subsidized social-housing leases** at below-market
rent (信義區 2022–2026: median 1,028 元/坪 vs 市場 whole-flat ~1,300–2,100) —
drop `rentalService.startsWith("社會住宅")` rows before quoting market rent.
