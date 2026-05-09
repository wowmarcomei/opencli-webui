import { NextResponse } from "next/server";
import {
  detectOpencli,
  installOpencli,
  getInstallStatus,
  setInstallStatus,
} from "@/lib/opencli";

// GET /api/setup — check if opencli is installed
export async function GET() {
  const result = await detectOpencli();
  if (result.installed) {
    setInstallStatus("installed");
  }
  return NextResponse.json({
    installed: result.installed,
    version: result.version,
    ...getInstallStatus(),
  });
}

// POST /api/setup — trigger installation
export async function POST() {
  const current = getInstallStatus();
  if (current.status === "installing") {
    return NextResponse.json({ message: "Already installing" }, { status: 409 });
  }

  // Fire and forget — client polls GET to track progress
  installOpencli().catch(() => {});

  return NextResponse.json({ message: "Installation started" });
}
