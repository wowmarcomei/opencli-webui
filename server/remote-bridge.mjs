import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_CONTEXT_ID = "default";

export class BridgeCommandFailure extends Error {
  constructor(message, errorCode, errorHint, status = 400) {
    super(message);
    this.name = "BridgeCommandFailure";
    this.errorCode = errorCode;
    this.errorHint = errorHint;
    this.status = status;
  }
}

export function createBridgeState({ token = "", tokenRequired = false, packageVersion = "0.0.0" } = {}) {
  const extensionProfiles = new Map();
  const pending = new Map();
  const logs = [];

  function activeProfiles() {
    return [...extensionProfiles.values()].filter((entry) => entry.ws.readyState === WebSocket.OPEN);
  }

  function isTokenAccepted(receivedToken) {
    if (!tokenRequired && !token) return true;
    return typeof receivedToken === "string" && receivedToken.length > 0 && receivedToken === token;
  }

  function pushLog(entry) {
    logs.push(entry);
    if (logs.length > 200) logs.shift();
  }

  function resolveExtensionConnection(contextId) {
    const requestedContextId = typeof contextId === "string" && contextId.trim() ? contextId.trim() : undefined;
    if (requestedContextId) {
      const connection = extensionProfiles.get(requestedContextId);
      if (connection?.ws.readyState === WebSocket.OPEN) return { connection };
      return {
        errorCode: "profile_disconnected",
        error: `Browser profile "${requestedContextId}" is not connected.`,
        errorHint: "Open that Chrome profile and make sure the OpenCLI remote extension is enabled.",
        status: 503,
      };
    }

    const connected = activeProfiles();
    if (connected.length === 1) return { connection: connected[0] };
    if (connected.length > 1) {
      return {
        errorCode: "profile_required",
        error: "Multiple Browser Bridge profiles are connected; choose one with --profile.",
        errorHint: "Select a connected profile in OpenCLI WebUI, or set OPENCLI_PROFILE for the server process.",
        status: 409,
      };
    }

    return {
      errorCode: "extension_not_connected",
      error: "Extension not connected. Install and connect the OpenCLI remote browser extension.",
      status: 503,
    };
  }

  function registerExtension(ws, hello = {}) {
    const contextId = typeof hello.contextId === "string" && hello.contextId.trim()
      ? hello.contextId.trim()
      : DEFAULT_CONTEXT_ID;

    const previous = extensionProfiles.get(contextId);
    if (previous && previous.ws !== ws) {
      previous.ws.close();
    }

    const existing = [...extensionProfiles.entries()].find(([, entry]) => entry.ws === ws);
    if (existing && existing[0] !== contextId) extensionProfiles.delete(existing[0]);

    const current = extensionProfiles.get(contextId);
    const connection = {
      contextId,
      ws,
      extensionVersion: typeof hello.version === "string" ? hello.version : current?.extensionVersion ?? null,
      extensionCompatRange: typeof hello.compatRange === "string" ? hello.compatRange : current?.extensionCompatRange ?? null,
      lastSeenAt: Date.now(),
    };
    extensionProfiles.set(contextId, connection);
    return connection;
  }

  function unregisterExtension(ws) {
    for (const [contextId, connection] of extensionProfiles.entries()) {
      if (connection.ws !== ws) continue;
      extensionProfiles.delete(contextId);

      for (const [id, waiting] of pending) {
        if (waiting.contextId !== contextId) continue;
        clearTimeout(waiting.timer);
        pending.delete(id);
        waiting.reject(new BridgeCommandFailure(
          `Browser profile "${contextId}" disconnected`,
          "profile_disconnected",
          "Reconnect the OpenCLI remote browser extension, then retry.",
          503,
        ));
      }
    }
  }

  function handleExtensionMessage(ws, message) {
    if (message?.type === "hello") {
      return registerExtension(ws, message);
    }

    if (message?.type === "log") {
      pushLog({
        level: typeof message.level === "string" ? message.level : "info",
        msg: typeof message.msg === "string" ? message.msg : "",
        ts: typeof message.ts === "number" ? message.ts : Date.now(),
      });
      return null;
    }

    if (!message?.id || !pending.has(message.id)) return null;
    const waiting = pending.get(message.id);
    clearTimeout(waiting.timer);
    pending.delete(message.id);
    waiting.resolve(message);
    return null;
  }

  function getStatus(contextId) {
    const route = resolveExtensionConnection(contextId);
    const profiles = activeProfiles().map((profile) => ({
      contextId: profile.contextId,
      extensionConnected: true,
      extensionVersion: profile.extensionVersion ?? undefined,
      extensionCompatRange: profile.extensionCompatRange ?? undefined,
      pending: [...pending.values()].filter((entry) => entry.contextId === profile.contextId).length,
      lastSeenAt: profile.lastSeenAt,
    }));

    return {
      ok: true,
      pid: process.pid,
      uptime: process.uptime(),
      daemonVersion: packageVersion,
      extensionConnected: !!route.connection,
      extensionVersion: route.connection?.extensionVersion ?? undefined,
      extensionCompatRange: route.connection?.extensionCompatRange ?? undefined,
      contextId: route.connection?.contextId ?? contextId,
      profileRequired: route.errorCode === "profile_required",
      profileDisconnected: route.errorCode === "profile_disconnected",
      profiles,
      pending: pending.size,
      memoryMB: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
    };
  }

  async function sendCommand(body) {
    if (!body?.id) {
      throw new BridgeCommandFailure("Missing command id", "bad_request", undefined, 400);
    }

    const route = resolveExtensionConnection(typeof body.contextId === "string" ? body.contextId : undefined);
    if (!route.connection) {
      throw new BridgeCommandFailure(route.error, route.errorCode, route.errorHint, route.status);
    }

    if (pending.has(body.id)) {
      throw new BridgeCommandFailure("Duplicate command id already pending; retry", "duplicate_command", undefined, 409);
    }

    const timeoutMs = typeof body.timeout === "number" && body.timeout > 0
      ? body.timeout * 1000
      : DEFAULT_COMMAND_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(body.id);
        reject(new Error(`Command timeout (${timeoutMs / 1000}s)`));
      }, timeoutMs);

      pending.set(body.id, { contextId: route.connection.contextId, resolve, reject, timer });

      try {
        route.connection.ws.send(JSON.stringify(body));
      } catch (err) {
        clearTimeout(timer);
        pending.delete(body.id);
        reject(err);
      }
    });
  }

  function getLogs(level) {
    return level ? logs.filter((entry) => entry.level === level) : [...logs];
  }

  function clearLogs() {
    logs.length = 0;
  }

  return {
    clearLogs,
    getLogs,
    getStatus,
    handleExtensionMessage,
    isTokenAccepted,
    pushLog,
    registerExtension,
    sendCommand,
    packageVersion,
    tokenRequired: !!(tokenRequired || token),
    unregisterExtension,
  };
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function attachPublicBridge({ bridge, server, path = "/api/browser-bridge/ws" }) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== path) return;

    const origin = req.headers.origin;
    const token = url.searchParams.get("token") ?? "";
    const originAllowed = !origin || origin.startsWith("chrome-extension://");
    if (!originAllowed || !bridge.isTokenAccepted(token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    let missedPongs = 0;
    const heartbeat = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(heartbeat);
        return;
      }
      if (missedPongs >= 2) {
        clearInterval(heartbeat);
        ws.terminate();
        return;
      }
      missedPongs++;
      ws.ping();
    }, 15_000);

    ws.on("pong", () => {
      missedPongs = 0;
    });
    ws.on("message", (data) => {
      try {
        bridge.handleExtensionMessage(ws, JSON.parse(data.toString()));
      } catch {
        // Ignore malformed extension messages.
      }
    });
    ws.on("close", () => {
      clearInterval(heartbeat);
      bridge.unregisterExtension(ws);
    });
    ws.on("error", () => {
      clearInterval(heartbeat);
      bridge.unregisterExtension(ws);
    });
  });

  return wss;
}

export function handlePublicBridgeHttp(req, res, bridge) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/browser-bridge/ping") return false;

  if (!bridge.isTokenAccepted(url.searchParams.get("token") ?? "")) {
    jsonResponse(res, 401, { ok: false, error: "Unauthorized" });
    return true;
  }

  jsonResponse(res, 200, {
    ok: true,
    daemonVersion: bridge.packageVersion,
    tokenRequired: bridge.tokenRequired,
  });
  return true;
}

export function startLocalDaemon({ bridge, port, host = "127.0.0.1" }) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);

      if (req.method === "GET" && url.pathname === "/ping") {
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (!req.headers["x-opencli"]) {
        jsonResponse(res, 403, { ok: false, error: "Forbidden: missing X-OpenCLI header" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/status") {
        const contextId = url.searchParams.get("contextId")?.trim() || undefined;
        jsonResponse(res, 200, { ...bridge.getStatus(contextId), port });
        return;
      }

      if (req.method === "GET" && url.pathname === "/logs") {
        jsonResponse(res, 200, { ok: true, logs: bridge.getLogs(url.searchParams.get("level")) });
        return;
      }

      if (req.method === "DELETE" && url.pathname === "/logs") {
        bridge.clearLogs();
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/shutdown") {
        jsonResponse(res, 200, { ok: true, message: "Remote bridge local daemon is managed by OpenCLI WebUI" });
        return;
      }

      if (req.method === "POST" && url.pathname === "/command") {
        try {
          const body = JSON.parse(await readBody(req));
          jsonResponse(res, 200, await bridge.sendCommand(body));
        } catch (err) {
          const failure = err instanceof BridgeCommandFailure ? err : null;
          jsonResponse(res, failure?.status ?? (err instanceof Error && err.message.includes("timeout") ? 408 : 400), {
            ok: false,
            error: err instanceof Error ? err.message : "Invalid request",
            ...(failure?.errorCode ? { errorCode: failure.errorCode } : {}),
            ...(failure?.errorHint ? { errorHint: failure.errorHint } : {}),
          });
        }
        return;
      }

      jsonResponse(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

export async function startLocalDaemonWithFallback({
  bridge,
  requestedPort,
  host = "127.0.0.1",
  maxAttempts = 10,
  start = startLocalDaemon,
}) {
  let lastError = null;

  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = requestedPort + offset;
    try {
      const server = await start({ bridge, port, host });
      return { server, port };
    } catch (err) {
      lastError = err;
      if (err?.code !== "EADDRINUSE") throw err;
    }
  }

  throw lastError ?? new Error("No daemon port could be bound");
}
