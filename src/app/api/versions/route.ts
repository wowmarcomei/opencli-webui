import { NextResponse } from "next/server";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const GITHUB_REPO = "jackwener/opencli";

interface GithubRelease {
  tag_name: string;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

async function getLatestRelease(): Promise<GithubRelease | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "opencli-webui" },
        next: { revalidate: 300 }, // cache 5 min
      }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getCurrentCliVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("opencli", ["--version"], { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

function getNodeVersion(): { version: string; supported: boolean } {
  const version = process.version.replace(/^v/, "");
  const major = parseInt(version.split(".")[0], 10);
  return { version, supported: major >= 20 };
}

export async function GET() {
  const [cliVersion, release] = await Promise.all([
    getCurrentCliVersion(),
    getLatestRelease(),
  ]);
  const node = getNodeVersion();

  const latestVersion = release?.tag_name?.replace(/^v/, "") ?? null;
  const extensionAsset = release?.assets.find((a) => a.name.includes("extension"));

  return NextResponse.json({
    node,
    cli: {
      current: cliVersion,
      latest: latestVersion,
      needsUpdate: cliVersion && latestVersion ? cliVersion !== latestVersion : false,
    },
    extension: {
      latest: latestVersion,
      downloadUrl: extensionAsset?.browser_download_url ?? release?.html_url ?? null,
      releaseUrl: release?.html_url ?? null,
    },
  });
}

// POST /api/versions  body: { action: "install-cli" | "update-cli" }
export async function POST(req: Request) {
  const { action } = await req.json();
  if (action !== "install-cli" && action !== "update-cli") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const proc = spawn("npm", ["install", "-g", "@jackwener/opencli"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout.on("data", (chunk: Buffer) => send("log", { text: chunk.toString() }));
      proc.stderr.on("data", (chunk: Buffer) => send("log", { text: chunk.toString() }));
      proc.on("close", (code) => {
        send("done", { code, success: code === 0 });
        controller.close();
      });
      proc.on("error", (err: Error) => {
        send("error", { message: err.message });
        send("done", { code: -1, success: false });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
