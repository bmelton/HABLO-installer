import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadSkillFixture } from "./fetch.mjs";
import { materializeSkill, overlaySkillMd } from "./overlay.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "testdata", "upstream-skill");

test("overlay strips docx/SharePoint and remaps interview UI", () => {
  const raw = fs.readFileSync(path.join(fixture, "SKILL.md"), "utf8");
  const out = overlaySkillMd(raw);
  assert.match(out, /HABLO overlay/);
  assert.match(out, /Pi chat/);
  assert.doesNotMatch(out, /AskUserQuestion/);
  assert.doesNotMatch(out, /## Sharing on SharePoint/);
  assert.match(out, /## Sharing \(HABLO\)/);
  assert.match(out, /Optional ADRs/);
  assert.match(out, /~\/tdds/);
  assert.match(out, /Do not block on/);
});

test("fixture load + materialize writes SKILL and template", () => {
  const loaded = loadSkillFixture(fixture, { readFileSync: fs.readFileSync, existsSync: fs.existsSync });
  assert.equal(loaded.ok, true);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "hablo-skill-"));
  materializeSkill(dest, loaded.files, { mkdirSync: fs.mkdirSync.bind(fs), writeFileSync: fs.writeFileSync.bind(fs) });
  assert.ok(fs.existsSync(path.join(dest, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(dest, "assets", "tdd-template.md")));
  assert.match(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8"), /HABLO overlay/);
});
