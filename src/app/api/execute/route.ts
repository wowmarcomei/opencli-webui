import { NextRequest } from "next/server";
import { executeCommand } from "@/lib/opencli";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { site, name, args = {}, format = "json" } = body;

  if (!site || !name) {
    return new Response(JSON.stringify({ error: "site and name are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const proc = executeCommand({ site, name, args, format });
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        send("log", { text, stream: "stderr" });
      });

      proc.on("close", (code) => {
        if (code === 0) {
          try {
            const parsed = JSON.parse(stdout);
            send("result", { data: parsed, format });
          } catch {
            send("result", { data: stdout, format: "text" });
          }
          send("done", { code: 0 });
        } else {
          send("error", { message: stderr || `Process exited with code ${code}`, code });
          send("done", { code });
        }
        controller.close();
      });

      proc.on("error", (err: Error) => {
        send("error", { message: err.message });
        send("done", { code: -1 });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
