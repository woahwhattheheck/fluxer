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
      assert.deepEqual(replies.map((reply) => reply.readUInt32LE(0)), [1, 1, 1, 4]);
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

function directClient(server, clientId = "123456789012345678", handshake = true) {
  const socket = new EventEmitter();
  const replies = [];
  socket.destroyed = false;
  socket.write = (packet) => {
    const length = packet.readUInt32LE(4);
    replies.push({
      op: packet.readUInt32LE(0),
      payload: JSON.parse(packet.toString("utf8", 8, 8 + length))
    });
    return true;
  };
  socket.destroy = () => {
    if (!socket.destroyed) {
      socket.destroyed = true;
      socket.emit("close");
    }
  };
  server.handleConnection(socket);
  const client = { socket, replies, send: (op, payload) => socket.emit("data", frame(op, payload)) };
  if (handshake) client.send(0, { v: 1, client_id: clientId });
  return client;
}

describe("ArRpcServer documented commands", () => {
  test("READY enables a client with the documented handshake and correlates SET_ACTIVITY replies", () => {
    const events = [];
    const server = new ArRpcServer({ onActivity: (activity, pid) => events.push({ activity, pid }) });
    const client = directClient(server);
    assert.equal(client.replies[0].payload.cmd, "DISPATCH");
    assert.equal(client.replies[0].payload.evt, "READY");
    assert.equal(client.replies[0].payload.data.v, 1);
    assert.deepEqual(client.replies[0].payload.data.config, {});
    const activity = { details: "Competitive | In a Match", timestamps: { start: 1700000000 } };
    client.send(1, { cmd: "SET_ACTIVITY", args: { pid: 9999, activity }, nonce: "set-1" });
    assert.equal(events[0].pid, 9999);
    assert.equal(events[0].activity.pid, 9999);
    assert.equal(events[0].activity.details, activity.details);
    // The official client supplies no name. This transport does not invent
    // application metadata; resolving a display name is a separate integration.
    assert.equal(events[0].activity.name, "");
    assert.deepEqual(client.replies.at(-1).payload, {
      cmd: "SET_ACTIVITY", data: activity, evt: null, nonce: "set-1"
    });
    // discord-rpc's JsonWriteRichPresenceObj omits activity when clearing.
    client.send(1, { cmd: "SET_ACTIVITY", args: { pid: 9999 }, nonce: "clear-1" });
    assert.equal(server.currentActivities().length, 0);
    assert.deepEqual(events.at(-1), { activity: null, pid: 9999 });
    assert.deepEqual(client.replies.at(-1).payload, {
      cmd: "SET_ACTIVITY", data: null, evt: null, nonce: "clear-1"
    });
    client.socket.destroy();
  });

  test("different client process IDs remain independent and disconnect clears only their own activity", () => {
    const events = [];
    const server = new ArRpcServer({ onActivity: (activity, pid) => events.push({ activity, pid }) });
    const first = directClient(server, "first");
    const second = directClient(server, "second");
    first.send(1, { cmd: "SET_ACTIVITY", args: { pid: 101, activity: { name: "First" } }, nonce: "first" });
    second.send(1, { cmd: "SET_ACTIVITY", args: { pid: 202, activity: { name: "Second" } }, nonce: "second" });
    assert.deepEqual(server.currentActivities().map((activity) => activity.pid), [101, 202]);
    first.socket.destroy();
    assert.deepEqual(server.currentActivities().map((activity) => activity.pid), [202]);
    assert.deepEqual(events.at(-1), { activity: null, pid: 101 });
    second.socket.destroy();
    assert.equal(server.currentActivities().length, 0);
    assert.deepEqual(events.at(-1), { activity: null, pid: 202 });
  });

  test("an older same-PID connection cannot clear or disconnect away a replacement activity", () => {
    const events = [];
    const server = new ArRpcServer({ onActivity: (activity, pid) => events.push({ activity, pid }) });
    const first = directClient(server);
    const second = directClient(server);
    first.send(1, { cmd: "SET_ACTIVITY", args: { pid: 303, activity: { name: "Old" } } });
    second.send(1, { cmd: "SET_ACTIVITY", args: { pid: 303, activity: { name: "New" } } });
    first.send(1, { cmd: "SET_ACTIVITY", args: { pid: 303, activity: null }, nonce: "old-clear" });
    first.socket.destroy();
    assert.deepEqual(server.currentActivities().map((activity) => activity.name), ["New"]);
    assert.equal(events.filter((event) => event.activity === null).length, 0);
    second.socket.destroy();
    assert.deepEqual(events.at(-1), { activity: null, pid: 303 });
  });

  test("a valid PID change removes the previous activity before publishing the new one", () => {
    const events = [];
    const server = new ArRpcServer({ onActivity: (activity, pid) => events.push({ activity, pid }) });
    const client = directClient(server);
    client.send(1, { cmd: "SET_ACTIVITY", args: { pid: 404, activity: { name: "Old process" } } });
    client.send(1, { cmd: "SET_ACTIVITY", args: { pid: 405, activity: { name: "New process" } } });
    assert.deepEqual(server.currentActivities().map((activity) => activity.pid), [405]);
    assert.deepEqual(events[1], { activity: null, pid: 404 });
    client.socket.destroy();
  });

  test("unrelated commands and malformed payloads preserve the current activity and return correlated errors", () => {
    const server = new ArRpcServer({ onActivity: () => {} });
    const client = directClient(server);
    client.send(1, { cmd: "SET_ACTIVITY", args: { pid: 505, activity: { name: "Keep" } } });
    client.send(1, { cmd: "SUBSCRIBE", evt: "ACTIVITY_JOIN", nonce: "unsupported" });
    assert.equal(client.replies.at(-1).payload.evt, "ERROR");
    assert.equal(client.replies.at(-1).payload.cmd, "SUBSCRIBE");
    assert.equal(client.replies.at(-1).payload.nonce, "unsupported");
    assert.equal(client.replies.at(-1).payload.data.code, 4002);
    for (const payload of [null, [], "junk", { nonce: "not-a-command" }]) client.send(1, payload);
    const garbage = Buffer.alloc(12);
    garbage.writeUInt32LE(1, 0);
    garbage.writeUInt32LE(4, 4);
    garbage.write("oops", 8, "utf8");
    client.socket.emit("data", garbage);
    for (const args of [
      "junk",
      { pid: 0, activity: null },
      { pid: -1, activity: null },
      { pid: 1.5, activity: null },
      { pid: 506, activity: { name: 42 } },
      { pid: 506, activity: [] }
    ]) client.send(1, { cmd: "SET_ACTIVITY", args, nonce: "invalid" });
    assert.deepEqual(server.currentActivities().map((activity) => [activity.pid, activity.name]), [[505, "Keep"]]);
    assert.equal(client.replies.at(-1).payload.evt, "ERROR");
    assert.equal(client.replies.at(-1).payload.nonce, "invalid");
    client.socket.destroy();
  });

  test("CLOSE clears the client before any following coalesced command is processed", () => {
    const events = [];
    const server = new ArRpcServer({ onActivity: (activity, pid) => events.push({ activity, pid }) });
    const client = directClient(server);
    client.send(1, { cmd: "SET_ACTIVITY", args: { pid: 606, activity: { name: "Before close" } } });
    client.socket.emit("data", Buffer.concat([
      frame(2, {}),
      frame(1, { cmd: "SET_ACTIVITY", args: { pid: 606, activity: { name: "After close" } } })
    ]));
    assert.equal(client.socket.destroyed, true);
    assert.equal(server.currentActivities().length, 0);
    assert.deepEqual(events.at(-1), { activity: null, pid: 606 });
    assert.equal(events.length, 2);
  });

  test("PING echoes its payload and stop emits one cleanup per active client", async () => {
    const events = [];
    const server = new ArRpcServer({ onActivity: (activity, pid) => events.push({ activity, pid }) });
    const first = directClient(server);
    const second = directClient(server);
    first.send(1, { cmd: "SET_ACTIVITY", args: { pid: 707, activity: { name: "First" } } });
    second.send(1, { cmd: "SET_ACTIVITY", args: { pid: 708, activity: { name: "Second" } } });
    first.send(3, { challenge: "ping-1" });
    assert.deepEqual(first.replies.at(-1), { op: 4, payload: { challenge: "ping-1" } });
    await server.stop();
    assert.equal(server.currentActivities().length, 0);
    assert.deepEqual(events.filter((event) => event.activity === null).map((event) => event.pid), [707, 708]);
  });

  test("legacy bare activities still require an explicit activity field and a valid PID", () => {
    const server = new ArRpcServer({ onActivity: () => {} });
    const client = directClient(server, "legacy", false);
    client.send(0, { v: 1, client_id: "legacy", pid: 808 });
    client.send(1, { activity: { name: "Legacy" } });
    assert.equal(server.currentActivities()[0].pid, 808);
    client.send(1, {});
    assert.equal(server.currentActivities()[0].name, "Legacy");
    client.send(1, { activity: null });
    assert.equal(server.currentActivities().length, 0);
    client.socket.destroy();
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
