"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

interface DiagLine {
  status: "ok" | "fail" | "warn" | "info";
  label: string;
  raw: string;
}

interface BrowserProfile {
  contextId: string;
  alias?: string;
  extensionVersion?: string;
  isDefault: boolean;
}

interface ProfileState {
  defaultContextId: string | null;
  disconnectedDefault: string | null;
  profiles: BrowserProfile[];
}

const DOT: Record<DiagLine["status"], string> = {
  ok:   "bg-green-500",
  fail: "bg-red-500 animate-pulse",
  warn: "bg-amber-400",
  info: "bg-muted-foreground/30",
};

const TEXT: Record<DiagLine["status"], string> = {
  ok:   "text-foreground",
  fail: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-muted-foreground",
};

async function fetchDoctor(onLine: (l: DiagLine) => void, onDone: () => void) {
  const res = await fetch("/api/doctor");
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const block of events) {
      const lines = block.trim().split("\n");
      let eventName = "message", dataLine = "";
      for (const l of lines) {
        if (l.startsWith("event: ")) eventName = l.slice(7);
        if (l.startsWith("data: ")) dataLine = l.slice(6);
      }
      if (!dataLine) continue;
      const d = JSON.parse(dataLine);
      if (eventName === "line") onLine(d as DiagLine);
      if (eventName === "done") onDone();
    }
  }
}

async function fetchProfiles(): Promise<ProfileState> {
  const res = await fetch("/api/profiles");
  if (!res.ok) throw new Error("加载 Profile 失败");
  return res.json();
}

export function DoctorPanel() {
  const [lines, setLines] = useState<DiagLine[]>([]);
  const [running, setRunning] = useState(false);
  const [profileState, setProfileState] = useState<ProfileState | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const runningRef = useRef(false);

  const diagLines = lines.filter((l) => l.status !== "info");
  const selectedProfile = profileState?.profiles.find((profile) => profile.isDefault)?.contextId ?? "";

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;
    setLines([]);
    setRunning(true);
    try {
      await fetchDoctor(
        (l) => setLines((p) => [...p, l]),
        () => { setRunning(false); runningRef.current = false; },
      );
    } catch {
      setLines((p) => [...p, { status: "fail", label: "连接失败", raw: "" }]);
      setRunning(false);
      runningRef.current = false;
    }
  }

  async function refreshProfiles() {
    try {
      setProfileState(await fetchProfiles());
    } catch {
      setProfileState(null);
    }
  }

  async function selectProfile(contextId: string) {
    if (!contextId) return;
    setSavingProfile(true);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextId }),
      });
      if (!res.ok) throw new Error("切换 Profile 失败");
      setProfileState(await res.json());
      await run();
    } finally {
      setSavingProfile(false);
    }
  }

  useEffect(() => {
    run();
    refreshProfiles();
  }, []);

  return (
    <div className="flex items-center gap-2">
      {/* 诊断条目：横向平铺自然换行 */}
      <div className="flex items-center gap-x-4 gap-y-0.5 flex-wrap">
        {running && diagLines.length === 0
          ? <span className="text-xs text-muted-foreground animate-pulse">诊断中...</span>
          : diagLines.map((l, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${DOT[l.status]}`} />
                <span className={`text-xs whitespace-nowrap ${TEXT[l.status]}`}>{l.label}</span>
              </div>
            ))
        }
      </div>

      {profileState && profileState.profiles.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Profile</span>
          <select
            value={selectedProfile}
            disabled={savingProfile}
            onChange={(event) => selectProfile(event.target.value)}
            className="h-6 max-w-40 rounded border border-input bg-background px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
            title="选择 OpenCLI 浏览器 Profile"
          >
            <option value="" disabled>
              {profileState.disconnectedDefault ? `未连接 ${profileState.disconnectedDefault}` : "选择"}
            </option>
            {profileState.profiles.map((profile) => (
              <option key={profile.contextId} value={profile.contextId}>
                {profile.alias ?? profile.contextId}
                {profile.extensionVersion ? ` v${profile.extensionVersion}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 刷新按钮 */}
      <Button
        size="sm"
        variant="ghost"
        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground shrink-0"
        disabled={running}
        onClick={run}
        title="重新诊断"
      >
        ↻
      </Button>
    </div>
  );
}
