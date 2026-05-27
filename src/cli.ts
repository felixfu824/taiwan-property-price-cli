#!/usr/bin/env node
/**
 * tw-lvr — CLI for the lvr-pipeline engine.
 *
 *   tw-lvr extract --where "台北市信義區松德路169巷" --from 2024 --to 2026 [--refine]
 *               [--ptype 1,2] [--community 名稱] [--out data.json|data.csv|folder/] [--pretty]
 *   tw-lvr schema [--format table|json]
 *   tw-lvr --version | --help
 *
 * Output: JSON (default) or CSV to stdout or --out file.
 * Exit codes (agent-native, self-correcting): 0=OK/empty, 2=bad input,
 * 3=site changed, 4=network, 5=rate limited, 6=environment/browser, 7=partial.
 */
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  readFileSync,
  realpathSync,
  cpSync,
  rmSync,
  renameSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { extract, extractRefined, closeBrowser, type ExtractMeta } from "./index.js";
import type { OutcomeCode, QueryInput } from "./types.js";
import { GLOSSARY, type FieldLayer, type GlossaryEntry } from "./glossary.js";

const EXIT: Record<OutcomeCode, number> = {
  OK: 0, OK_EMPTY: 0, ERR_BAD_INPUT: 2, ERR_SITE_CHANGED: 3,
  ERR_NETWORK: 4, ERR_RATE_LIMITED: 5, ERR_ENV: 6, PARTIAL: 7,
};
const PACKAGE_NAME = "tw-lvr-cli";
const SKILL_NAME = "tw-lvr-cli";

function parseQueryType(args: Record<string, string | boolean>): "biz" | "sale" | null {
  const raw = args.presale ? "sale" : args.query ? String(args.query) : args.type ? String(args.type) : "biz";
  if (raw === "biz" || raw === "sale") return raw;
  return null;
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      // A value is anything that isn't another flag (--long or -short).
      if (next !== undefined && !next.startsWith("-")) { out[key] = next; i++; }
      else out[key] = true;
    } else if (a === "-h") {
      out.help = true;
    }
  }
  return out;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]).filter((k) => k !== "meta");
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function renderRows(
  rows: Record<string, unknown>[],
  fmt: string,
  pretty = false,
): string {
  if (fmt === "csv") return toCsv(rows);
  if (fmt === "json") return JSON.stringify(rows, null, pretty ? 2 : 0);
  throw new Error(`--format must be json or csv (got "${fmt}")`);
}

export function filterRowsByCommunity(
  rows: Record<string, unknown>[],
  community: string,
): Record<string, unknown>[] {
  if (!community) return rows;
  return rows.filter((r) => String(r.building ?? "").includes(community));
}

export function sortRowsNewestFirst(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.slice().sort((a, b) => String(b.txnDateRoc ?? "").localeCompare(String(a.txnDateRoc ?? "")));
}

export function limitRows(
  rows: Record<string, unknown>[],
  topRaw: string | boolean | undefined,
): Record<string, unknown>[] {
  const topN = topRaw !== undefined ? parseInt(String(topRaw), 10) : NaN;
  return Number.isFinite(topN) && topN > 0 ? rows.slice(0, topN) : rows;
}

/** Filesystem-safe slug for auto-named output files. */
export function slugify(s: string): string {
  const cleaned = (s || "").trim().replace(/[\s/\\:*?"<>|]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return cleaned || "lvr";
}

/**
 * Resolve the final output file path given a user --out value.
 * If `out` is an existing directory OR ends with a path separator, an
 * auto-named file `<labelSlug>_<from>-<to>.<ext>` is written inside it.
 * Returns the final file path; caller is responsible for mkdir + write.
 */
export function resolveOutPath(
  out: string,
  opts: { ext: string; label: string; from: string; to: string },
): string {
  const ext = opts.ext.replace(/^\./, "");
  const autoName = `${slugify(opts.label)}_${opts.from}-${opts.to}.${ext}`;
  const endsWithSep = out.endsWith("/") || out.endsWith("\\") || out.endsWith(sep);
  const isExistingDir = existsSync(out) && statSync(out).isDirectory();
  if (endsWithSep || isExistingDir) return join(out, autoName);
  return out;
}

/** Read the package version (best-effort; falls back to "unknown"). */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/cli.ts -> ../package.json ; dist/cli.js -> ../package.json
    const candidates = [
      resolve(here, "../package.json"),
      resolve(here, "../../package.json"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, "utf8")) as { name?: string; version?: string };
        if (pkg.name === "lvr-pipeline" || pkg.version) return pkg.version ?? "unknown";
      }
    }
  } catch { /* ignore */ }
  return "unknown";
}

function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..");
}

export function bundledSkillDir(): string {
  return resolve(packageRoot(), "skills", SKILL_NAME);
}

export function defaultSkillRoot(agent: string): string {
  if (agent === "codex") {
    // Codex discovers skills under ~/.agents/skills (current spec); the
    // legacy ~/.codex/skills path is no longer scanned by Codex CLI.
    const agentsHome = process.env.AGENTS_HOME || join(homedir(), ".agents");
    return join(agentsHome, "skills");
  }
  if (agent === "claude") {
    const claudeHome = process.env.CLAUDE_HOME || join(homedir(), ".claude");
    return join(claudeHome, "skills");
  }
  throw new Error(`--agent must be codex or claude (got "${agent}")`);
}

export function installBundledSkill(targetRoot: string): string {
  const src = bundledSkillDir();
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new Error(`bundled skill not found at ${src}`);
  }

  mkdirSync(targetRoot, { recursive: true });
  const dest = join(targetRoot, SKILL_NAME);
  const tmp = join(targetRoot, `.${SKILL_NAME}.tmp-${process.pid}-${Date.now()}`);
  rmSync(tmp, { recursive: true, force: true });
  cpSync(src, tmp, {
    recursive: true,
    dereference: true,
    filter: (source) => !source.endsWith(`${sep}.DS_Store`) && !source.endsWith("/.DS_Store"),
  });
  rmSync(dest, { recursive: true, force: true });
  renameSync(tmp, dest);
  return dest;
}

export function upgradeInstructions(opts: { manager?: string; agent?: string } = {}): string {
  const manager = opts.manager;
  const agent = opts.agent;
  const managers =
    manager === "npm" ? ["npm"] :
    manager === "bun" ? ["bun"] :
    manager === undefined ? ["npm", "bun"] :
    (() => { throw new Error(`--manager must be npm or bun (got "${manager}")`); })();
  const agents =
    agent === "codex" ? ["codex"] :
    agent === "claude" ? ["claude"] :
    agent === undefined ? ["codex", "claude"] :
    (() => { throw new Error(`--agent must be codex or claude (got "${agent}")`); })();

  const installCmd = (m: string) =>
    m === "bun" ? `bun add -g ${PACKAGE_NAME}@latest` : `npm install -g ${PACKAGE_NAME}@latest`;

  const lines: string[] = [];
  lines.push(`tw-lvr ${readVersion()}`);
  lines.push("");
  lines.push("Upgrade the CLI + bundled Skill package:");
  for (const m of managers) lines.push(`  ${installCmd(m)}`);
  lines.push("");
  lines.push("Refresh the copied agent Skill after the package upgrade:");
  for (const a of agents) lines.push(`  tw-lvr skill install --agent ${a}`);
  lines.push("");
  lines.push("One-line update:");
  for (const m of managers) {
    for (const a of agents) lines.push(`  ${installCmd(m)} && tw-lvr skill install --agent ${a}`);
  }
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function glossarySection(title: string, entries: GlossaryEntry[]): string {
  const header = ["field", "origin", "official", "meaning"];
  const rows = entries.map((e) => [
    e.field,
    e.origin,
    e.official ? "yes" : "no",
    truncate(`${e.unit ? `[${e.unit}] ` : ""}${e.definition}`, 68),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [title, fmt(header), sep, ...rows.map(fmt)].join("\n");
}

export function schemaTable(
  entries: GlossaryEntry[],
  opts: { layer?: FieldLayer | "all" } = {},
): string {
  const layer = opts.layer ?? "all";
  const clean = entries.filter((e) => e.layer === "clean");
  const refined = entries.filter((e) => e.layer === "refined");
  if (layer === "clean") return glossarySection("CLEAN FIELDS (always present)", clean);
  if (layer === "refined") return glossarySection("REFINED FIELDS (--refine only)", refined);
  return [
    glossarySection("CLEAN FIELDS (always present)", clean),
    glossarySection("REFINED FIELDS (--refine only)", refined),
  ].join("\n\n");
}

const USAGE =
  "usage: tw-lvr extract --where <addr> --from <year> --to <year> [--refine] [--ptype 1,2]\n" +
  "                      [--query biz|sale|--presale] [--community <name>] [--top N|--limit N]\n" +
  "                      [--out file|folder/] [--pretty] [--format json|csv]\n" +
  "       tw-lvr glossary [--layer clean|refined|all] [--format table|json]\n" +
  "       tw-lvr schema [--format table|json]   # alias for glossary\n" +
  "       tw-lvr skill path | skill install --agent codex|claude [--target skills-dir]\n" +
  "       tw-lvr upgrade [--manager npm|bun] [--agent codex|claude]\n" +
  "       tw-lvr --version | --help";

function printHelp(): void {
  const lines: string[] = [];
  lines.push("tw-lvr — latest Taiwan 實價登錄 (real-price registry) transactions as clean JSON.");
  lines.push("");
  lines.push(USAGE);
  lines.push("");
  lines.push("COMMANDS");
  lines.push("  extract     Fetch building-level transactions for an address/year range.");
  lines.push("  glossary    Explain output fields, origins, and formulas.");
  lines.push("  schema      Alias for glossary, kept for scripts.");
  lines.push("  skill       Show or install the bundled Agent Skill.");
  lines.push("  upgrade     Print the package + Skill update commands.");
  lines.push("");
  lines.push("FLAGS (extract)");
  lines.push("  --where <addr>     Address to search, e.g. \"台北市信義區松德路169巷\" (required).");
  lines.push("  --from <year>      Start year, WESTERN, e.g. 2024. Query spans Jan of --from (required).");
  lines.push("  --to <year>        End year, WESTERN, e.g. 2026. Query spans through Dec of --to (required).");
  lines.push("  --refine           Add Layer B: car-park-adjusted unit price, exclusion flags, confidence.");
  lines.push("  --ptype <codes>    Property type codes, default 1,2 (房地). 3=土地 4=建物 5=車位.");
  lines.push("  --query <kind>     biz (default, 買賣) or sale (預售屋).");
  lines.push("  --presale          Alias for --query sale.");
  lines.push("  --community <name> Post-filter: keep only records whose building name includes <name>.");
  lines.push("  --top N            Return only the N most recent transactions (alias: --limit N).");
  lines.push("  --limit N          Alias for --top.");
  lines.push("  --out <path>       Write to a file, or a folder/ (auto-names <label>_<from>-<to>.<ext>).");
  lines.push("  --format <fmt>     json (default) or csv. Inferred from --out extension if omitted.");
  lines.push("  --pretty           Pretty-print JSON output with indentation.");
  lines.push("  --agent <name>     For skill/upgrade: codex or claude.");
  lines.push("  --manager <name>   For upgrade: npm or bun.");
  lines.push("  --version          Print version and exit.");
  lines.push("  -h, --help         Show this help and exit.");
  lines.push("");
  lines.push("EXIT CODES");
  lines.push("  0 ok/empty · 2 bad input · 3 site changed · 4 network · 5 rate limited · 6 env/browser · 7 partial");
  lines.push("");
  lines.push("EXAMPLES");
  lines.push("  tw-lvr extract --where \"台北市信義區松德路169巷\" --from 2024 --to 2026 --refine --pretty");
  lines.push("  tw-lvr extract --where \"台北市大安區\" --from 2024 --to 2026 --community \"敦南琢真\" --out ./out/");
  lines.push("  tw-lvr extract --where \"新北市板橋區文化路\" --from 2025 --to 2026 --top 20 --format csv --out latest.csv");
  lines.push("  tw-lvr extract --where \"苗栗縣竹南鎮\" --from 2026 --to 2026 --presale --community \"藏富天下\"");
  lines.push("  tw-lvr glossary --layer refined");
  lines.push("  tw-lvr upgrade --agent codex");
  lines.push("  tw-lvr skill install --agent codex");
  lines.push("");
  lines.push("Run `tw-lvr glossary` for output fields, origins, and formulas.");
  process.stdout.write(lines.join("\n") + "\n");
}

async function runUpgrade(args: Record<string, string | boolean>): Promise<void> {
  try {
    const manager = args.manager ? String(args.manager) : undefined;
    const agent = args.agent ? String(args.agent) : undefined;
    process.stdout.write(upgradeInstructions({ manager, agent }) + "\n");
    process.exit(0);
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}

async function runSkill(args: Record<string, string | boolean>): Promise<void> {
  const subcmd = process.argv[3];
  if (args.help || subcmd === "help") {
    process.stdout.write(
      "usage: tw-lvr skill path\n" +
      "       tw-lvr skill install --agent codex|claude [--target skills-dir]\n\n" +
      "Copies the bundled skills/tw-lvr-cli folder from the installed package.\n",
    );
    process.exit(0);
  }
  if (subcmd === "path") {
    process.stdout.write(bundledSkillDir() + "\n");
    process.exit(0);
  }
  if (subcmd === "install") {
    try {
      const agent = args.agent ? String(args.agent) : "";
      const targetRoot = args.target ? String(args.target) : defaultSkillRoot(agent);
      const dest = installBundledSkill(targetRoot);
      process.stderr.write(`installed skill: ${dest}\n`);
      process.exit(0);
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    }
  }
  console.error("error: expected `tw-lvr skill path` or `tw-lvr skill install ...`");
  process.exit(2);
}

async function runGlossary(args: Record<string, string | boolean>): Promise<void> {
  const fmt = args.format ? String(args.format) : "table";
  const layer = args.layer ? String(args.layer) : "all";
  if (!["all", "clean", "refined"].includes(layer)) {
    console.error(`error: --layer must be clean, refined, or all (got "${layer}")`);
    process.exit(2);
  }
  const entries = layer === "all" ? GLOSSARY : GLOSSARY.filter((e) => e.layer === layer);
  if (fmt === "json") {
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
  } else if (fmt === "table") {
    process.stdout.write(schemaTable(GLOSSARY, { layer: layer as FieldLayer | "all" }) + "\n");
  } else {
    console.error(`error: --format must be table or json (got "${fmt}")`);
    process.exit(2);
  }
  process.exit(0);
}

async function runExtract(args: Record<string, string | boolean>): Promise<void> {
  if (!args.where || !args.from || !args.to) {
    console.error("error: --where, --from, --to are required");
    console.error(USAGE);
    process.exit(2);
  }
  const input: QueryInput = {
    where: String(args.where), from: String(args.from), to: String(args.to),
    ptype: args.ptype ? String(args.ptype) : undefined,
    queryType: parseQueryType(args) ?? undefined,
  };
  if (input.queryType == null) {
    console.error(`error: --query must be biz or sale (got "${String(args.query ?? args.type)}")`);
    process.exit(2);
  }
  const meta: ExtractMeta = {};
  const res = args.refine ? await extractRefined(input, undefined, meta) : await extract(input, meta);

  if (meta.resolvedLabel) console.error(`resolved: ${meta.resolvedLabel}`);
  if (res.code !== "OK" && res.code !== "OK_EMPTY" && res.code !== "PARTIAL") {
    console.error(`[${res.code}] ${res.error ?? ""}`);
    await closeBrowser();
    process.exit(EXIT[res.code]);
  }
  let data = (res.data ?? []) as unknown as Record<string, unknown>[];
  const totalFetched = data.length;

  // --community: post-filter on the building field (substring match).
  const community = args.community ? String(args.community) : "";
  if (community) {
    data = filterRowsByCommunity(data, community);
    if (data.length === 0) {
      console.error(
        `OK_EMPTY: 0 of ${totalFetched} record(s) match --community "${community}". ` +
        `Hint: broaden --where (e.g. drop the lane/street to a district) or check the community name.`,
      );
      await closeBrowser();
      process.exit(EXIT.OK_EMPTY);
    }
  }

  // Always newest-first (most recent transaction on top). txnDateRoc is zero-padded
  // "YYY/MM/DD" with uniform-width ROC years, so lexicographic desc == chronological desc.
  data = sortRowsNewestFirst(data);
  // --top N / --limit N: SQL-LIMIT-style trim to the N most recent.
  const topRaw = args.top ?? args.limit;
  const rows = limitRows(data, topRaw);
  const communityNote = community ? ` matching "${community}" (of ${totalFetched})` : "";
  console.error(`${res.code}: ${data.length} record(s)${communityNote}` + (rows.length < data.length ? `, showing top ${rows.length}` : "") + (res.partial ? ` (ok=${res.partial.ok} failed=${res.partial.failed})` : ""));

  const outPath = args.out ? String(args.out) : "";
  const fmt = args.format ? String(args.format) : (outPath.endsWith(".csv") ? "csv" : "json");
  if (fmt !== "json" && fmt !== "csv") {
    console.error(`error: --format must be json or csv (got "${fmt}")`);
    await closeBrowser();
    process.exit(2);
  }
  const ext = fmt === "csv" ? "csv" : "json";
  const text = renderRows(rows, fmt, Boolean(args.pretty));
  if (outPath) {
    const finalPath = resolveOutPath(outPath, {
      ext, label: meta.resolvedLabel || String(args.where), from: String(args.from), to: String(args.to),
    });
    mkdirSync(dirname(finalPath), { recursive: true });
    writeFileSync(finalPath, text);
    console.error(`wrote ${finalPath}`);
  } else {
    process.stdout.write(text + "\n");
  }

  await closeBrowser();
  process.exit(EXIT[res.code]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = process.argv[2];

  if (args.version && (cmd === undefined || cmd.startsWith("-"))) {
    process.stdout.write(readVersion() + "\n");
    process.exit(0);
  }
  if (args.help && (
    cmd === undefined ||
    cmd.startsWith("-") ||
    cmd === "extract" ||
    cmd === "schema" ||
    cmd === "glossary" ||
    cmd === "upgrade" ||
    cmd === "update" ||
    cmd === "skill"
  )) {
    printHelp();
    process.exit(0);
  }
  if (cmd === "schema" || cmd === "glossary") { await runGlossary(args); return; }
  if (cmd === "upgrade" || cmd === "update") { await runUpgrade(args); return; }
  if (cmd === "skill") { await runSkill(args); return; }
  if (cmd === "extract") { await runExtract(args); return; }

  // No (or unknown) command: show help to stderr and exit 2 (unless --help/--version above).
  console.error(USAGE);
  process.exit(cmd === undefined ? 2 : 2);
}

// Only run the CLI when invoked directly, not when imported (e.g. by tests).
const invokedDirectly = (() => {
  try {
    const entry = process.argv[1] ? resolve(process.argv[1]) : "";
    const self = fileURLToPath(import.meta.url);
    const entryReal = entry ? realpathSync(entry) : "";
    const selfReal = realpathSync(self);
    return (
      entry === self ||
      entry === self.replace(/\.ts$/, ".js") ||
      entry === self.replace(/\.js$/, ".ts") ||
      entryReal === selfReal ||
      entryReal === selfReal.replace(/\.ts$/, ".js") ||
      entryReal === selfReal.replace(/\.js$/, ".ts")
    );
  } catch { return false; }
})();

if (invokedDirectly) {
  main().catch(async (e) => { console.error("fatal:", e?.message ?? e); await closeBrowser(); process.exit(1); });
}
