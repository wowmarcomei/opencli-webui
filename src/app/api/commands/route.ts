import { NextResponse } from "next/server";
import { listCommands } from "@/lib/opencli";

export async function GET() {
  try {
    const commands = await listCommands();
    return NextResponse.json(commands);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
