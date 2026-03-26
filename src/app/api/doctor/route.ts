import { spawn } from "child_process";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const proc = spawn("opencli", ["doctor"], { stdio: ["ignore", "pipe", "pipe"] });

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        // 逐行解析状态
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let status: "ok" | "fail" | "warn" | "info" = "info";
          let label = trimmed;

          if (trimmed.startsWith("[OK]")) {
            status = "ok";
            label = trimmed.slice(4).trim();
          } else if (trimmed.startsWith("[FAIL]")) {
            status = "fail";
            label = trimmed.slice(6).trim();
          } else if (trimmed.startsWith("[WARN]")) {
            status = "warn";
            label = trimmed.slice(6).trim();
          }

          send("line", { status, label, raw: trimmed });
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) send("line", { status: "fail", label: line.trim(), raw: line.trim() });
        }
      });

      proc.on("close", (code) => {
        send("done", { code, success: code === 0 });
        controller.close();
      });

      proc.on("error", (err: Error) => {
        send("line", { status: "fail", label: `无法运行 opencli doctor: ${err.message}`, raw: err.message });
        send("done", { code: -1, success: false });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
