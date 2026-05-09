import { NextResponse } from "next/server";
import { getBrowserProfileState, setDefaultBrowserProfile } from "@/lib/profiles";

export async function GET() {
  return NextResponse.json(await getBrowserProfileState());
}

export async function POST(req: Request) {
  const { contextId } = await req.json();
  if (typeof contextId !== "string" || !contextId.trim()) {
    return NextResponse.json({ error: "contextId is required" }, { status: 400 });
  }

  const state = await getBrowserProfileState();
  const connected = state.profiles.some((profile) => profile.contextId === contextId.trim());
  if (!connected) {
    return NextResponse.json({ error: "profile is not connected" }, { status: 400 });
  }

  await setDefaultBrowserProfile(contextId);
  return NextResponse.json(await getBrowserProfileState());
}
