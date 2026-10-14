import { existsSync } from "node:fs";
import path from "node:path";
import { checkNode, projectRoot, runNpm } from "./local-utils.mjs";

checkNode();
const ready = ["node_modules/vinext/package.json", "dist/server/wrangler.json", ".sites-runtime/local-setup.json"]
  .every(file => existsSync(path.join(projectRoot, file)));
if (!ready) runNpm(["run", "setup"]);
console.log("\nOpen http://127.0.0.1:5173 after the server starts. Keep this window open.\n");
runNpm(["run", "dev"]);
