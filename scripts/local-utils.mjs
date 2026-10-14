import { spawnSync } from "node:child_process";
import { projectRoot } from "./sites-env.mjs";

export { projectRoot };

export function checkNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error("Install Node.js 22.13 or newer before running this project.");
  }
}

export function runNode(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) process.exit(result.status || 1);
}

export function runNpm(args) {
  if (!process.env.npm_execpath) {
    throw new Error("Run this command through npm, for example: npm run setup.");
  }
  runNode([process.env.npm_execpath, ...args]);
}
