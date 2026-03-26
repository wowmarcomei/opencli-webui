"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DoctorPanel } from "@/components/features/doctor-panel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface VersionInfo {
  node: { version: string; supported: boolean };
  cli: { current: string | null; latest: string | null; needsUpdate: boolean };
  extension: { latest: string | null; downloadUrl: string | null; releaseUrl: string | null };
}

async function fetchVersions(): Promise<VersionInfo> {
  const res = await fetch("/api/versions");
  if (!res.ok) throw new Error("获取版本失败");
  return res.json();
}

export function VersionPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["versions"],
    queryFn: fetchVersions,
    staleTime: 5 * 60 * 1000,
  });

  const [installing, setInstalling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [extDialog, setExtDialog] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function runInstall() {
    setLogs([]);
    setInstalling(true);
    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install-cli" }),
        signal: abortRef.current.signal,
      });
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
          for (const line of lines) {
            if (line.startsWith("event: ")) eventName = line.slice(7);
            if (line.startsWith("data: ")) dataLine = line.slice(6);
          }
          if (!dataLine) continue;
          const d = JSON.parse(dataLine);
          if (eventName === "log") setLogs((p) => [...p, d.text]);
          if (eventName === "done" && d.success) queryClient.invalidateQueries({ queryKey: ["versions"] });
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError")
        setLogs((p) => [...p, `错误: ${(err as Error).message}`]);
    } finally {
      setInstalling(false);
    }
  }

  const cli = data?.cli;
  const ext = data?.extension;
  const node = data?.node;

  return (
    <div className="space-y-2">
      {/* Node 版本不支持警告 */}
      {node && !node.supported && (
        <div className="text-[11px] px-2 py-1 rounded bg-destructive/10 text-destructive border border-destructive/20">
          Node.js v{node.version} 不支持，请升级到 v20.0.0 及以上版本
        </div>
      )}

      {/* 横向一行：Node + CLI + 扩展 */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Node */}
        {!isLoading && node && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Node</span>
              <Badge
                variant="outline"
                className={`text-[10px] font-mono h-5 ${!node.supported ? "border-destructive text-destructive" : ""}`}
              >
                v{node.version}
              </Badge>
            </div>
            <div className="h-4 w-px bg-border" />
          </>
        )}

        {/* CLI */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">CLI</span>
          {isLoading ? (
            <span className="text-xs text-muted-foreground animate-pulse">检查中...</span>
          ) : cli?.current ? (
            <Badge variant="outline" className="text-[10px] font-mono h-5">v{cli.current}</Badge>
          ) : (
            <Badge variant="destructive" className="text-[10px] h-5">未安装</Badge>
          )}
          {cli?.needsUpdate && (
            <Badge className="text-[10px] h-5 bg-amber-500 hover:bg-amber-500">→ v{cli.latest}</Badge>
          )}
          <Button
            size="sm"
            variant={cli?.needsUpdate ? "default" : "outline"}
            className="h-6 text-xs px-2"
            disabled={installing}
            onClick={runInstall}
          >
            {installing ? "安装中..." : cli?.current ? (cli.needsUpdate ? "更新" : "重装") : "安装"}
          </Button>
        </div>

        <div className="h-4 w-px bg-border" />

        {/* 扩展 */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">浏览器扩展</span>
          {!isLoading && ext?.latest && (
            <Badge variant="outline" className="text-[10px] font-mono h-5">v{ext.latest}</Badge>
          )}
          <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => setExtDialog(true)}>
            安装
          </Button>
        </div>

      </div>

      {/* 第二行：诊断结果 */}
      <DoctorPanel />

      {/* 安装日志 */}
      {logs.length > 0 && (
        <ScrollArea className="max-h-24 rounded-md bg-muted px-2 py-1.5">
          <pre className="font-mono text-[11px] whitespace-pre-wrap">{logs.join("")}</pre>
        </ScrollArea>
      )}

      {/* 扩展安装方式 Dialog */}
      <Dialog open={extDialog} onOpenChange={setExtDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>安装浏览器扩展</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {/* Chrome 商店 */}
            <div className="rounded-lg border p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">Chrome 应用商店</span>
                <Badge variant="secondary" className="text-[10px]">待上架</Badge>
              </div>
              <p className="text-xs text-muted-foreground">扩展尚未发布至 Chrome Web Store，敬请期待。</p>
              <Button size="sm" variant="outline" className="w-full" disabled>
                前往 Chrome 商店
              </Button>
            </div>

            {/* 下载 ZIP */}
            <div className="rounded-lg border p-3 space-y-1.5">
              <span className="font-medium text-sm">下载安装包（推荐）</span>
              <p className="text-xs text-muted-foreground">
                下载 zip 解压后，在 Chrome 以开发者模式加载。
              </p>
              <div className="flex gap-2">
                {ext?.downloadUrl && (
                  <a href={ext.downloadUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
                    <Button size="sm" className="w-full">下载 ZIP</Button>
                  </a>
                )}
                <a href="chrome://extensions" target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button size="sm" variant="outline" className="w-full">打开扩展页</Button>
                </a>
              </div>
            </div>

            {/* 手动步骤 */}
            <div className="rounded-lg border p-3 space-y-1.5">
              <span className="font-medium text-sm">手动安装步骤</span>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>下载并解压 <code className="font-mono bg-muted px-1 rounded">opencli-extension.zip</code></li>
                <li>打开 Chrome，地址栏输入 <code className="font-mono bg-muted px-1 rounded">chrome://extensions</code></li>
                <li>开启右上角「开发者模式」</li>
                <li>点击「加载已解压的扩展程序」，选择解压后的文件夹</li>
                <li>确认扩展已启用，运行 <code className="font-mono bg-muted px-1 rounded">opencli doctor</code> 验证</li>
              </ol>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
