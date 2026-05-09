import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createBridgeState } from "../server/remote-bridge.mjs";

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
