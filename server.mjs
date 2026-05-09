import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import next from "next";
import {
  attachPublicBridge,
  createBridgeState,
  handlePublicBridgeHttp,
  startLocalDaemon,
} from "./server/remote-bridge.mjs";

const prod = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const dev = !prod;
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3002", 10);
const daemonPort = Number.parseInt(process.env.OPENCLI_REMOTE_DAEMON_PORT || process.env.OPENCLI_DAEMON_PORT || "19825", 10);
const bridgeToken = process.env.OPENCLI_BRIDGE_TOKEN || "";
const tokenRequired = prod || process.env.OPENCLI_BRIDGE_REQUIRE_TOKEN === "1" || !!bridgeToken;
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const opencliVersion = packageJson.dependencies?.["@jackwener/opencli"]?.replace(/^[^\d]*/, "") || "0.0.0";

process.env.OPENCLI_DAEMON_PORT = String(daemonPort);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const bridge = createBridgeState({
  token: bridgeToken,
  tokenRequired,
  packageVersion: opencliVersion,
});

await app.prepare();

const server = createServer((req, res) => {
  if (handlePublicBridgeHttp(req, res, bridge)) return;
  handle(req, res);
});

attachPublicBridge({
  bridge,
  server,
  path: "/api/browser-bridge/ws",
});

try {
  await startLocalDaemon({ bridge, port: daemonPort });
  console.log(`> OpenCLI remote bridge daemon listening on http://127.0.0.1:${daemonPort}`);
} catch (err) {
  console.warn(`> OpenCLI remote bridge daemon could not bind 127.0.0.1:${daemonPort}`);
  console.warn(`> ${err instanceof Error ? err.message : String(err)}`);
}

if (tokenRequired && !bridgeToken) {
  console.warn("> OPENCLI_BRIDGE_TOKEN is required in production; set it before connecting the browser extension.");
}

server.listen(port, hostname, () => {
  const mode = dev ? "development" : "production";
  console.log(`> OpenCLI WebUI ready on http://${hostname}:${port} (${mode})`);
  console.log(`> Remote extension WebSocket path: /api/browser-bridge/ws`);
});
