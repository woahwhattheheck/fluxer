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
  test("path suffix rule matches the normalized executable path without exposing it", () => {
    for (const executablePath of ["C:/Games/content/minecraft.exe", "C:\\Games\\Content\\Minecraft.EXE"]) {
      const matches = matchDetectableApplications(
        DETECTABLES,
        [{ name: "minecraft.exe", executablePath }],
        "win32"
      );
      assert.deepEqual(matches, [{ kind: "detected", name: "Minecraft", type: 0, icon: "minecraft.png" }]);
    }
  });
  test("path suffix rule rejects an unknown path and unrelated same-basename paths", () => {
    for (const executablePath of [undefined, "C:/Other/minecraft.exe", "C:/Games/notcontent/minecraft.exe"]) {
      const matches = matchDetectableApplications(
        DETECTABLES,
        [{ name: "minecraft.exe", ...(executablePath ? { executablePath } : {}) }],
        "win32"
      );
      assert.equal(matches.length, 0, `unexpected suffix match for ${executablePath}`);
    }
  });
  test("bare-name rules still match when the executable path is different or unavailable", () => {
    const applications = [{ name: "Minecraft", executables: [{ name: "minecraft.exe", os: "win32" }] }];
    for (const executablePath of [undefined, "C:/Games/content/minecraft.exe", "C:/Other/minecraft.exe"]) {
      const matches = matchDetectableApplications(
        applications,
        [{ name: "minecraft.exe", ...(executablePath ? { executablePath } : {}) }],
        "win32"
      );
      assert.equal(matches.length, 1);
    }
  });
  test("shared-runtime path rules require both the executable suffix and arguments", () => {
    const applications = [{
      name: "Minecraft",
      executables: [{ name: ">runtime/javaw.exe", os: "win32", arguments: "net.minecraft.client.main.Main" }]
    }];
    const process = {
      name: "javaw.exe",
      executablePath: "C:\\Games\\runtime\\javaw.exe",
      commandLine: '"C:\\Games\\runtime\\javaw.exe" net.minecraft.client.main.Main'
    };
    assert.equal(matchDetectableApplications(applications, [process], "win32").length, 1);
    for (const changed of [
      { executablePath: "C:/Other/javaw.exe" },
      { executablePath: undefined },
      { commandLine: "javaw.exe -jar server.jar" }
    ]) {
      assert.equal(matchDetectableApplications(applications, [{ ...process, ...changed }], "win32").length, 0);
    }
    const missingArguments = [{ name: "Minecraft", executables: [{ name: ">runtime/javaw.exe", os: "win32" }] }];
    assert.equal(matchDetectableApplications(missingArguments, [process], "win32").length, 0);
  });
  test("ordinary path rules retain their optional argument discriminator", () => {
    const applications = [{
      name: "Minecraft",
      executables: [{ name: "content/minecraft.exe", os: "win32", arguments: "--minecraft" }]
    }];
    const process = { name: "minecraft.exe", executablePath: "C:/Games/content/minecraft.exe" };
    assert.equal(matchDetectableApplications(applications, [{ ...process, commandLine: "--MINECRAFT" }], "win32").length, 1);
    assert.equal(matchDetectableApplications(applications, [process], "win32").length, 0);
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

describe("detected process identities", () => {
  test("all distinct PIDs survive a multi-process match while the application stays deduplicated", () => {
    const matches = matchDetectableApplications(DETECTABLES, [
      { name: "minecraft.windows.exe", pid: 11 },
      { name: "minecraft.windows.exe", pid: 12 },
      { name: "minecraft.windows.exe", pid: 11 },
      { name: "osu!.exe", pid: 22 }
    ], "win32");
    assert.equal(matches.length, 2);
    assert.deepEqual(matches[0].processIds, [11, 12]);
    assert.deepEqual(matches[1].processIds, [22]);
  });
  test("later matching catalogue definitions retain prior PIDs and override only application metadata", () => {
    const applications = [
      { name: "One Game", icon: "old.png", executables: [{ name: "old.exe", os: "win32" }] },
      { name: "One Game", icon: "new.png", executables: [{ name: "new.exe", os: "win32" }] }
    ];
    const matches = matchDetectableApplications(applications, [
      { name: "old.exe", pid: 11 },
      { name: "new.exe", pid: 12 }
    ], "win32");
    assert.deepEqual(matches, [{
      kind: "detected", name: "One Game", type: 0, icon: "new.png", processIds: [11, 12]
    }]);
  });
  test("PID-less and invalid-PID matches preserve their legacy activity shape", () => {
    const invalid = [undefined, 0, -1, 1.5, "12", Number.MAX_SAFE_INTEGER + 1];
    const matches = matchDetectableApplications(DETECTABLES, invalid.map((pid) => ({
      name: "osu!.exe", ...(pid === undefined ? {} : { pid })
    })), "win32");
    assert.deepEqual(matches, [{ kind: "detected", name: "osu!", type: 0, icon: "osu.png" }]);
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
