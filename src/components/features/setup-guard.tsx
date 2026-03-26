"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SetupState {
  installed: boolean;
  version?: string;
  status: "installed" | "installing" | "not_installed" | "error";
  log: string[];
}

export function SetupGuard({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SetupState | null>(null);
  const [polling, setPolling] = useState(false);

  async function checkSetup() {
    const res = await fetch("/api/setup");
    const data = await res.json();
    setState(data);
    return data;
  }

  async function triggerInstall() {
    setState((prev) => prev ? { ...prev, status: "installing" } : prev);
    await fetch("/api/setup", { method: "POST" });
    setPolling(true);
  }

  useEffect(() => {
    checkSetup();
  }, []);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      const data = await checkSetup();
      if (data.status === "installed" || data.status === "error") {
        setPolling(false);
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [polling]);

  if (!state) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground text-sm animate-pulse">正在检测 opencli...</div>
      </div>
    );
  }

  if (state.installed || state.status === "installed") {
    return <>{children}</>;
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>OpenCLI WebUI</CardTitle>
            <Badge variant={state.status === "installing" ? "secondary" : "destructive"}>
              {state.status === "installing" ? "安装中..." : "未安装"}
            </Badge>
          </div>
          <CardDescription>
            {state.status === "installing"
              ? "正在通过 npm 全局安装 opencli，请稍候..."
              : "服务器上尚未安装 opencli，点击下方按钮自动安装。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status !== "installing" && (
            <Button className="w-full" onClick={triggerInstall}>
              一键安装 opencli
            </Button>
          )}
          {state.status === "installing" && (
            <div className="rounded-md bg-muted p-3 font-mono text-xs max-h-40 overflow-y-auto whitespace-pre-wrap">
              {state.log.join("") || "正在启动安装..."}
            </div>
          )}
          {state.status === "error" && (
            <div className="text-destructive text-sm">
              安装失败，请手动安装：
              <code className="font-mono ml-1">npm install -g @jackwener/opencli</code>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
