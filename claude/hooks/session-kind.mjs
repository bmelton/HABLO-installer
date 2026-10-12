#!/usr/bin/env node
// HABLO: SessionStart — record whether this Claude session is interactive (for ask vs deny).
// Also warns loudly when HABLO_GUARD=off. managed by HABLO-installer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch { /* empty */ }
let event = {};
try { event = JSON.parse(raw || "{}"); } catch { /* ignore */ }

const sessionId = String(event.session_id || event.sessionId || `pid-${process.pid}`);
const dir = path.join(os.homedir(), ".hablo", "guard-cache", "sessions");
try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }

const attended = !process.env.FM_TASK_ID;
const kind = process.env.FM_TASK_ID ? "crewmate" : (process.env.HABLO_PROJECT ? "captain" : "solo");
const record = {
  attended,
  kind,
  project: process.env.HABLO_PROJECT || "",
  at: new Date().toISOString(),
};
try {
  fs.writeFileSync(path.join(dir, `${sessionId}.json`), JSON.stringify(record) + "\n");
} catch { /* ignore */ }

if (process.env.HABLO_GUARD === "off") {
  process.stderr.write("HABLO_GUARD=off: this Claude session is UNGUARDED. Tool calls will not be checked.\n");
}

process.exit(0);
