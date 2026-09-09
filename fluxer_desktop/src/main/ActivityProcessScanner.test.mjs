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
  test("parses a ConvertTo-Csv table with command lines containing commas", () => {
    const csv = [
      '"Name","CommandLine","ProcessId"',
      '"javaw.exe",""C:\\\\path\\\\javaw.exe" net.minecraft.client.main.Main --log,withcommas","1234"',
      '"osu!.exe",,"5678"',
      ""
    ].join("\r\n");
    const processes = __internals.parseWindowsWmicCsv(csv);
    assert.equal(processes.length, 2);
    assert.equal(processes[0].name, "javaw.exe");
    assert.ok(processes[0].commandLine?.includes("net.minecraft.client.main.main"));
    assert.ok(processes[0].commandLine?.includes("withcommas"));
    assert.equal(processes[1].name, "osu!.exe");
  });
  test("empty output yields no processes", () => {
    assert.equal(__internals.parseWindowsWmicCsv("").length, 0);
  });
});
describe("posix ps parser", () => {
  test("parses pid, comm and args", () => {
    const ps = [
      "  123 /usr/bin/java -cp x net.minecraft.client.main.Main",
      "  124 osu!",
      ""
    ].join("\n");
    const processes = __internals.parsePosixPs(ps);
    assert.equal(processes.length, 2);
    assert.equal(processes[0].name, "java");
    assert.ok(processes[0].commandLine?.startsWith("/usr/bin/java"));
    assert.equal(processes[1].name, "osu!");
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
