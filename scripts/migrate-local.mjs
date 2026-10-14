import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkNode, projectRoot, runNode } from "./local-utils.mjs";

checkNode();
const builtPath = path.join(projectRoot, "dist/server/wrangler.json");
if (!existsSync(builtPath)) throw new Error("Build the project first with npm run build, or run npm run setup.");
const built = JSON.parse(readFileSync(builtPath, "utf8"));
const database = built.d1_databases?.find(db => db.binding === "DB");
if (!database) throw new Error("The built project is missing its local DB binding.");
const configPath = path.join(projectRoot, ".sites-runtime/local-migrations.json");
writeFileSync(configPath, JSON.stringify({
  name: built.name,
  compatibility_date: built.compatibility_date,
  d1_databases: [{ ...database, migrations_dir: path.join(projectRoot, "drizzle") }],
}, null, 2) + "\n");
runNode([
  "--import", pathToFileURL(path.join(projectRoot, "scripts/sites-env.mjs")).href,
  path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
  "d1", "migrations", "apply", "DB", "--local", "--config", configPath,
  "--persist-to", path.join(projectRoot, ".wrangler/state"),
], { CI: "true" });
