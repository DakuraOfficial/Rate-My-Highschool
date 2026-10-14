import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkNode, projectRoot, runNpm } from "./local-utils.mjs";

checkNode();
runNpm(["run", "install:ci"]);
if (!existsSync(path.join(projectRoot, ".dev.vars"))) {
  copyFileSync(path.join(projectRoot, ".dev.vars.example"), path.join(projectRoot, ".dev.vars"));
}
runNpm(["run", "build"]);
runNpm(["run", "db:migrate"]);
writeFileSync(path.join(projectRoot, ".sites-runtime/local-setup.json"), JSON.stringify({ version: 1 }) + "\n");
console.log("\nSetup complete. Run npm run dev, then open http://127.0.0.1:5173.\n");
