import assert from "node:assert/strict";
import test from "node:test";
import { formatAge, formatFleetStatus, parseStatusAt, shortTaskId } from "../pi/extensions/hablo-fleet-status.mjs";

test("shortTaskId keeps compact ids and trims long originops-style ids", () => {
  assert.equal(shortTaskId("originops-4496-tooltip"), "4496-tooltip");
  assert.equal(shortTaskId("scout-1"), "scout-1");
});

test("formatAge and parseStatusAt", () => {
  assert.equal(formatAge(45), "45s");
  assert.equal(formatAge(125), "2m");
  assert.equal(formatAge(7200), "2h");
  assert.equal(parseStatusAt("working [at=100]: hi"), 100);
  assert.equal(parseStatusAt("done: PR"), undefined);
});

test("formatFleetStatus idle / working / stale", () => {
  const idle = formatFleetStatus("originops", { counts: { active_children: 0 }, active_children: [] }, 1000, new Map());
  assert.equal(idle.level, "ok");
  assert.match(idle.text, /idle/);

  const warn = formatFleetStatus(
    "originops",
    { counts: { active_children: 0, holds: 1 }, active_children: [] },
    1000,
    new Map(),
  );
  assert.equal(warn.level, "warn");
  assert.match(warn.text, /1 hold/);

  const details = new Map([
    ["originops-4496-tooltip", {
      lastStatus: "working [at=100]: discovering",
      busy: "v1 state=busy source=pi-ext",
      statusMtime: 100,
    }],
  ]);
  const working = formatFleetStatus(
    "originops",
    {
      counts: { active_children: 1 },
      active_children: [{ id: "originops-4496-tooltip", state: "working", doing: "harness busy (pi-ext)" }],
    },
    160,
    details,
    600,
  );
  assert.equal(working.level, "ok");
  assert.match(working.text, /1↑/);
  assert.match(working.text, /4496-tooltip:busy 1m/);

  const stale = formatFleetStatus(
    "originops",
    {
      counts: { active_children: 1 },
      active_children: [{ id: "originops-4496-tooltip", state: "working", doing: "harness busy (pi-ext)" }],
    },
    100 + 700,
    details,
    600,
  );
  assert.equal(stale.level, "stale");
  assert.match(stale.text, /STALE/);
});
