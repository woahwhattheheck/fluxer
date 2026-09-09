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
const { matchDetectableApplications, parseDetectables } = loadTs("./DetectableApplications.ts");
const DETECTABLES = [
  {
    name: "Minecraft",
    icon: "minecraft.png",
    executables: [
      { name: "minecraft.windows.exe", os: "win32" },
      { name: "content/minecraft.exe", os: "win32" },
      { name: ">javaw.exe", os: "win32", arguments: "net.minecraft.client.main.Main" },
      { name: ">java", os: "linux", arguments: "net.minecraft.client.main.Main" }
    ]
  },
  {
    name: "osu!",
    icon: "osu.png",
    executables: [
      { name: "osu!.exe", os: "win32" },
      { name: "osu!", os: "linux" }
    ]
  }
];
describe("matchDetectableApplications", () => {
  test("exact executable name matches on the right platform", () => {
    const matches = matchDetectableApplications(DETECTABLES, [{ name: "osu!.exe" }], "win32");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, "osu!");
    assert.equal(matches[0].kind, "detected");
  });
  test("same executable does not match on another platform", () => {
    const matches = matchDetectableApplications(DETECTABLES, [{ name: "osu!.exe" }], "linux");
    assert.equal(matches.length, 0);
  });
  test("path suffix rule matches bare basename", () => {
    const matches = matchDetectableApplications(DETECTABLES, [{ name: "minecraft.exe" }], "win32");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, "Minecraft");
  });
  test("runtime rule requires the arguments substring", () => {
    const rule = [{ name: "javaw.exe", commandLine: '"c:\\java\\javaw.exe" net.minecraft.client.main.Main --arg' }];
    const noArgs = [{ name: "javaw.exe", commandLine: '"c:\\java\\javaw.exe" -jar server.jar' }];
    assert.equal(matchDetectableApplications(DETECTABLES, rule, "win32").length, 1);
    assert.equal(matchDetectableApplications(DETECTABLES, noArgs, "win32").length, 0);
  });
  test("runtime rule without a command line never matches", () => {
    const matches = matchDetectableApplications(DETECTABLES, [{ name: "javaw.exe" }], "win32");
    assert.equal(matches.length, 0);
  });
  test("matching is case-insensitive on names and arguments", () => {
    const matches = matchDetectableApplications(
      DETECTABLES,
      [{ name: "JAVAW.EXE", commandLine: "NET.MINECRAFT.CLIENT.MAIN.MAIN" }],
      "win32"
    );
    assert.equal(matches.length, 1);
  });
  test("linux runtime rule matches java with minecraft args", () => {
    const matches = matchDetectableApplications(
      DETECTABLES,
      [{ name: "java", commandLine: "/usr/bin/java net.minecraft.client.main.Main" }],
      "linux"
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, "Minecraft");
  });
  test("multiple processes produce deduplicated activities", () => {
    const matches = matchDetectableApplications(
      DETECTABLES,
      [
        { name: "minecraft.windows.exe" },
        { name: "minecraft.windows.exe" },
        { name: "osu!.exe" }
      ],
      "win32"
    );
    assert.equal(matches.length, 2);
  });
  test("empty process list yields no activities", () => {
    assert.equal(matchDetectableApplications(DETECTABLES, [], "win32").length, 0);
  });
});
describe("parseDetectables", () => {
  test("parses the real schema-shaped payload", () => {
    const parsed = parseDetectables(DETECTABLES);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].executables.length, 4);
    assert.equal(parsed[0].executables[2].arguments, "net.minecraft.client.main.Main");
  });
  test("drops entries missing required fields", () => {
    const parsed = parseDetectables([
      { name: "NoIcon", executables: [{ name: "a.exe", os: "win32" }] },
      { name: "NoExecs", icon: "a.png", executables: [] },
      { name: "BadOs", icon: "a.png", executables: [{ name: "a.exe", os: "plan9" }] },
      null,
      42
    ]);
    assert.equal(parsed.length, 0);
  });
  test("non-array payload yields empty list", () => {
    assert.equal(parseDetectables(null).length, 0);
    assert.equal(parseDetectables({}).length, 0);
  });
});
