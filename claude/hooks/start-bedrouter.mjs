#!/usr/bin/env node
// HABLO: SessionStart hook — start bedrouter if nothing is listening on the configured port.
// managed by HABLO-installer (claude/hooks/start-bedrouter.mjs). Never stops the daemon.
// Placeholders __BEDROUTER_*__ / __HABLO_BEDROUTER_BIN__ are stamped at install time.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import os from "node:os";

const port = Number(process.env.BEDROUTER_PORT || "__BEDROUTER_PORT__");
const brHome = process.env.BEDROUTER_HOME || "__BEDROUTER_HOME__";
const bin = process.env.HABLO_BEDROUTER_BIN || "__HABLO_BEDROUTER_BIN__";

function listening() {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port }, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });
}

if (await listening()) process.exit(0);
if (!bin || bin.includes("__HABLO_") || !fs.existsSync(bin)) {
  // Soft-fail: do not block the Claude session if the shim is missing.
  process.exit(0);
}
const child = spawn(bin, ["serve"], {
  detached: true,
  stdio: "ignore",
  cwd: path.isAbsolute(brHome) ? brHome : path.join(os.homedir(), ".bedrouter"),
  env: { ...process.env },
});
child.unref();
process.exit(0);
