import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createBridgeState, startLocalDaemonWithFallback } from "../server/remote-bridge.mjs";

class FakeSocket {
  readyState = WebSocket.OPEN;
  sent = [];

  send(message) {
    this.sent.push(JSON.parse(message));
  }

  close() {
    this.readyState = WebSocket.CLOSED;
  }
}

test("bridge status reports connected profiles and selected route", () => {
  const bridge = createBridgeState({ token: "secret", packageVersion: "1.7.14" });
  const socket = new FakeSocket();

  bridge.registerExtension(socket, {
    type: "hello",
    contextId: "local-chrome",
    version: "1.0.7",
    compatRange: ">=1.7.0",
  });

  const status = bridge.getStatus("local-chrome");

  assert.equal(status.extensionConnected, true);
  assert.equal(status.contextId, "local-chrome");
  assert.deepEqual(status.profiles, [
    {
      contextId: "local-chrome",
      extensionConnected: true,
      extensionVersion: "1.0.7",
      extensionCompatRange: ">=1.7.0",
      pending: 0,
      lastSeenAt: status.profiles[0].lastSeenAt,
    },
  ]);
});

test("bridge routes command responses by command id", async () => {
  const bridge = createBridgeState({ token: "secret", packageVersion: "1.7.14" });
  const socket = new FakeSocket();

  bridge.registerExtension(socket, { type: "hello", contextId: "work" });

  const promise = bridge.sendCommand({ id: "cmd-1", action: "tabs", contextId: "work" });
  assert.deepEqual(socket.sent, [{ id: "cmd-1", action: "tabs", contextId: "work" }]);

  bridge.handleExtensionMessage(socket, { id: "cmd-1", ok: true, data: [{ id: 1, title: "Tab" }] });
  await assert.doesNotReject(async () => {
    const result = await promise;
    assert.deepEqual(result, { id: "cmd-1", ok: true, data: [{ id: 1, title: "Tab" }] });
  });
});

test("bridge rejects commands when requested profile is disconnected", async () => {
  const bridge = createBridgeState({ token: "secret", packageVersion: "1.7.14" });

  await assert.rejects(
    () => bridge.sendCommand({ id: "cmd-2", action: "tabs", contextId: "missing" }),
    /Browser profile "missing" is not connected/,
  );
});

test("daemon startup falls back to the next port when the default port is occupied", async () => {
  const attempted = [];
  const bridge = createBridgeState({ token: "secret", packageVersion: "1.7.14" });

  const result = await startLocalDaemonWithFallback({
    bridge,
    requestedPort: 19825,
    maxAttempts: 3,
    start: async ({ port }) => {
      attempted.push(port);
      if (port === 19825) {
        const err = new Error("address in use");
        err.code = "EADDRINUSE";
        throw err;
      }
      return { close() {} };
    },
  });

  assert.deepEqual(attempted, [19825, 19826]);
  assert.equal(result.port, 19826);
});

test("daemon startup does not hide non-port-conflict errors", async () => {
  const bridge = createBridgeState({ token: "secret", packageVersion: "1.7.14" });

  await assert.rejects(
    () => startLocalDaemonWithFallback({
      bridge,
      requestedPort: 19825,
      maxAttempts: 3,
      start: async () => {
        throw new Error("permission denied");
      },
    }),
    /permission denied/,
  );
});
