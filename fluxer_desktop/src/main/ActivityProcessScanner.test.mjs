import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
const require2 = createRequire(import.meta.url);
const esbuild = require2("esbuild");
function loadTs(relativePath) {
  const sourcePath = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = readFileSync(sourcePath, "utf8");
  const transformed = esbuild.transformSync(source, {
    loader: "ts",
    format: "cjs",
    platform: "node",
    target: "node20"
  }).code;
  const module = { exports: {} };
  new Function("module", "exports", "require", transformed)(module, module.exports, require2);
  return module.exports;
}
const { __internals } = loadTs("./ActivityProcessScanner.ts");
describe("windows csv parser", () => {
  test("parses quoted command lines and executable paths without mixing CSV columns", () => {
    const csv = [
      '"Name","CommandLine","ExecutablePath","ProcessId"',
      "\"JavaW.exe\",\"\"\"C:\\Games, Inc\\Java\\javaw.exe\"\" net.minecraft.client.main.Main --log,withcommas --label \"\"Quoted value\"\"\",\"C:\\Games, Inc\\Java\\javaw.exe\",\"1234\"",
      '"osu!.exe",,,"5678"',
      ""
    ].join("\r\n");
    const processes = __internals.parseWindowsWmicCsv(csv);
    assert.equal(processes.length, 2);
    assert.equal(processes[0].name, "javaw.exe");
    assert.equal(processes[0].pid, 1234);
    assert.equal(processes[0].commandLine, "\"c:\\games, inc\\java\\javaw.exe\" net.minecraft.client.main.main --log,withcommas --label \"quoted value\"");
    assert.equal(processes[0].executablePath, "C:\\Games, Inc\\Java\\javaw.exe");
    assert.deepEqual(processes[1], {name: "osu!.exe", pid: 5678});
  });
  test("empty output yields no processes", () => {
    assert.equal(__internals.parseWindowsWmicCsv("").length, 0);
  });
});

describe("process identity validation", () => {
  test("Windows retains only positive safe integer IDs while preserving legacy rows", () => {
    const csv = [
      '"Name","ProcessId"',
      '"known.exe","7"',
      '"zero.exe","0"',
      '"negative.exe","-1"',
      '"fraction.exe","1.5"',
      '"large.exe","9007199254740992"',
      '"missing.exe",""',
      '"text.exe","7junk"'
    ].join("\r\n");
    const rows = __internals.parseWindowsWmicCsv(csv);
    assert.equal(rows[0].pid, 7);
    assert.ok(rows.slice(1).every((row) => !Object.hasOwn(row, "pid")));
    assert.equal(rows.length, 7);
    assert.deepEqual(__internals.parseWindowsWmicCsv('"Name"\n"legacy.exe"'), [{ name: "legacy.exe" }]);
  });
  test("POSIX retains valid IDs and leaves invalid observations unbound", () => {
    const rows = __internals.parsePosixPs("7 game --play\n0 zero --play\n9007199254740992 large --play");
    assert.equal(rows[0].pid, 7);
    assert.ok(rows.slice(1).every((row) => !Object.hasOwn(row, "pid")));
    assert.equal(rows.length, 3);
  });
});

describe("posix ps parser", () => {
  test("parses pid, comm and args", () => {
    const ps = [
      "  123 /opt/Java/bin/java -cp x net.minecraft.client.main.Main",
      "  124 java /Games/Minecraft/client.jar",
      ""
    ].join("\n");
    const processes = __internals.parsePosixPs(ps);
    assert.equal(processes.length, 2);
    assert.equal(processes[0].name, "java");
    assert.equal(processes[0].pid, 123);
    assert.ok(processes[0].commandLine?.startsWith("/opt/java/bin/java"));
    assert.equal(processes[0].executablePath, "/opt/Java/bin/java");
    assert.deepEqual(processes[1], {name: "java", pid: 124, commandLine: "java /games/minecraft/client.jar"});
  });
  test("junk lines are skipped", () => {
    assert.equal(__internals.parsePosixPs("header only\nno match").length, 0);
  });
});
describe("live process scan", () => {
  test("lists real processes on this machine", async () => {
    const { listRunningProcesses } = loadTs("./ActivityProcessScanner.ts");
    const processes = await listRunningProcesses();
    assert.ok(processes.length > 5, `expected a real process list, got ${processes.length}`);
    assert.ok(processes.every((p) => p.name === p.name.toLowerCase()));
  });
});
