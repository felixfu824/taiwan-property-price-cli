// Run via: node scripts/sync-codex-plugin.mjs  (or: npm run sync)
// Sync the canonical Agent Skill (skills/tw-lvr-cli) into the self-contained
// Codex plugin subdirectory (plugins/tw-lvr-cli/skills/tw-lvr-cli).
//
// WHY: Codex's marketplace resolver only discovers a plugin in a SUBDIRECTORY
// that is self-contained (carries its own .codex-plugin/plugin.json + skills/).
// The repo root is the Claude plugin + the canonical skill source; this script
// mirrors that one skill into the Codex plugin dir so there is a single source
// of truth. Run after editing the skill: `npm run sync`. The
// test/codex-plugin-sync.test.ts drift guard fails if the mirror is stale.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "skills", "tw-lvr-cli");
const destParent = join(root, "plugins", "tw-lvr-cli", "skills");
const dest = join(destParent, "tw-lvr-cli");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const pluginDescription = `${packageJson.description} Requires the chrome-headless-shell browser binary (npx playwright install chromium-headless-shell).`;

const skipDS = (p) => !p.endsWith("/.DS_Store") && !p.endsWith("\\.DS_Store");

function updatePluginManifest(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.version = packageJson.version;
  manifest.description = pluginDescription;
  manifest.keywords = packageJson.keywords;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

mkdirSync(destParent, { recursive: true });
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true, dereference: true, filter: skipDS });
console.log(`synced skill -> ${dest.replace(root + "/", "")}`);

updatePluginManifest(join(root, ".claude-plugin", "plugin.json"));
updatePluginManifest(join(root, "plugins", "tw-lvr-cli", ".codex-plugin", "plugin.json"));
console.log("synced plugin manifest metadata");
