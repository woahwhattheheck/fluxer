import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
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
const { ArRpcServer, __rpcInternals } = loadTs("./ArRpcServer.ts");
function frame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}
function once(socket) {
  return new Promise((resolve) => {
    socket.on("data", resolve);
  });
}
async function readReply(socket) {
  const chunk = await once(socket);
  const op = chunk.readUInt32LE(0);
  const length = chunk.readUInt32LE(4);
  const payload = JSON.parse(chunk.toString("utf8", 8, 8 + length));
  return { op, payload };
}
function pipeName(index) {
  return process.platform === "win32" ? `\\\\.\\pipe\\discord-ipc-${index}` : `${process.env.XDG_RUNTIME_DIR ?? "/tmp"}/discord-ipc-${index}`;
}
describe("ArRpcServer protocol", () => {
  for (const delivery of ["coalesced", "fragmented"]) {
    test(`Unicode activity preserves subsequent frames (${delivery})`, () => {
      const events = [];
      const replies = [];
      const socket = new EventEmitter();
      socket.write = (data) => { replies.push(data); return true; };
      const server = new ArRpcServer({
        onActivity: (activity, pid) => events.push({ activity, pid })
      });
      server.handleConnection(socket);
      const unicode = { name: "音楽 🎮", type: 0, details: "Playing 🎮 音楽" };
      const packet = Buffer.concat([
        frame(0, { v: 1, client_id: "123", pid: 4242 }),
        frame(1, { cmd: "SET_ACTIVITY", args: { pid: 4242, activity: unicode } }),
        frame(1, { cmd: "SET_ACTIVITY", args: { pid: 4242, activity: { name: "Following", type: 0 } } }),
        frame(3, {})
      ]);
      if (delivery === "coalesced") {
        socket.emit("data", packet);
      } else {
        // Cross every header/payload boundary, including inside UTF-8 characters.
        for (const byte of packet) socket.emit("data", Buffer.of(byte));
      }
      assert.deepEqual(events.map(({ activity }) => activity.name), [unicode.name, "Following"]);
      assert.equal(events[0].activity.details, unicode.details);
      assert.deepEqual(replies.map((reply) => reply.readUInt32LE(0)), [1, 4]);
      assert.equal(server.currentActivities()[0].name, "Following");
      socket.emit("close");
      assert.equal(server.currentActivities().length, 0);
    });
  }
  test("handshake, SET_ACTIVITY, clear, and ping over a real pipe", async () => {
    const events = [];
    const server = new ArRpcServer({
      onActivity: (activity, pid) => events.push({ activity, pid })
    });
    await server.start();
    try {
      const socket = connect(pipeName(0));
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.write(frame(0, { v: 1, client_id: "123", pid: 4242 }));
      const hs = await readReply(socket);
      assert.equal(hs.op, 1);
      assert.equal(hs.payload.cmd, "DISPATCH");
      socket.write(
        frame(1, {
          cmd: "SET_ACTIVITY",
          args: {
            pid: 4242,
            activity: {
              name: "Test Game",
              type: 0,
              state: "in menu",
              details: "playing",
              assets: { large_image: "big", large_text: "Big" },
              timestamps: { start: 17e8 }
            }
          }
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(events.length, 1);
      assert.equal(events[0].pid, 4242);
      const activity = events[0].activity;
      assert.equal(activity.name, "Test Game");
      assert.equal(activity.state, "in menu");
      assert.equal(server.currentActivities().length, 1);
      socket.write(frame(3, {}));
      const pong = await readReply(socket);
      assert.equal(pong.op, 4);
      socket.write(frame(1, { cmd: "SET_ACTIVITY", args: { pid: 4242, activity: null } }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(events.length, 2);
      assert.equal(events[1].activity, null);
      assert.equal(server.currentActivities().length, 0);
      socket.write(
        frame(1, { cmd: "SET_ACTIVITY", args: { pid: 4242, activity: { name: "Again", type: 0 } } })
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(server.currentActivities().length, 1);
      socket.destroy();
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(server.currentActivities().length, 0);
      const clearEvents = events.filter((event) => event.activity === null);
      assert.equal(clearEvents.length, 2);
    } finally {
      await server.stop();
    }
  });
  test("multiple pipes are served (ipc-0 .. ipc-9)", async () => {
    const server = new ArRpcServer({ onActivity: () => {
    } });
    await server.start();
    try {
      const socket = connect(pipeName(3));
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.write(frame(0, { v: 1, client_id: "x", pid: 7 }));
      const hs = await readReply(socket);
      assert.equal(hs.op, 1);
      socket.destroy();
    } finally {
      await server.stop();
    }
  });
  test("malformed JSON frames are ignored without crashing the server", async () => {
    const server = new ArRpcServer({ onActivity: () => {
    } });
    await server.start();
    try {
      const socket = connect(pipeName(1));
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      const garbage = Buffer.alloc(12);
      garbage.writeUInt32LE(1, 0);
      garbage.writeUInt32LE(4, 4);
      garbage.write("oops", 8, "utf8");
      socket.write(garbage);
      await new Promise((resolve) => setTimeout(resolve, 100));
      socket.write(frame(0, { v: 1, client_id: "x", pid: 9 }));
      const hs = await readReply(socket);
      assert.equal(hs.op, 1);
      socket.destroy();
    } finally {
      await server.stop();
    }
  });
});
describe("rpc frame codec", () => {
  test("encode + decode round trip", () => {
    const { encodeMessage, tryDecodeMessage } = __rpcInternals;
    const encoded = encodeMessage(1, { cmd: "PING" });
    const decoded = tryDecodeMessage(Buffer.concat([encoded, Buffer.from("trailing")]), 0);
    assert.deepEqual(decoded, { op: 1, payload: '{"cmd":"PING"}', frameLength: encoded.length });
  });
  test("decode returns null for partial buffers", () => {
    const { tryDecodeMessage } = __rpcInternals;
    assert.equal(tryDecodeMessage(Buffer.alloc(4), 0), null);
  });
  test("normalizeActivity rejects junk and keeps valid fields", () => {
    const { normalizeActivity } = __rpcInternals;
    assert.equal(normalizeActivity(null, 1), null);
    assert.equal(normalizeActivity("nope", 1), null);
    assert.equal(normalizeActivity({ name: 42 }, 1), null);
    const ok = normalizeActivity(
      { type: 0, details: "d", assets: { large_image: "li" }, timestamps: { start: 5 } },
      11
    );
    assert.equal(ok.pid, 11);
    assert.equal(ok.name, "");
    assert.deepEqual(ok.assets.large_image, "li");
  });
});
