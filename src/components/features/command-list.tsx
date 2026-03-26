"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InlineRunner } from "@/components/features/inline-runner";
import { getSiteName } from "@/lib/site-names";
import type { CliCommand } from "@/lib/opencli";

const strategyLabel: Record<string, string> = {
  public: "公开",
  cookie: "登录",
  header: "授权",
  intercept: "拦截",
  ui: "界面",
};

const strategyColors: Record<string, string> = {
  public: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  cookie: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  header: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  intercept: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  ui: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

async function fetchCommands(): Promise<CliCommand[]> {
  const res = await fetch("/api/commands");
  if (!res.ok) throw new Error("加载失败");
  return res.json();
}

export function CommandList() {
  const [search, setSearch] = useState("");
  const [activeSite, setActiveSite] = useState<string | null>(null);
  const [expandedCmd, setExpandedCmd] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["commands"],
    queryFn: fetchCommands,
    staleTime: 60_000,
    retry: false,
  });

  const [installing, setInstalling] = useState(false);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [installResult, setInstallResult] = useState<"idle" | "success" | "error">("idle");
  const abortRef = useRef<AbortController | null>(null);

  async function runInstall() {
    setInstallLogs([]);
    setInstallResult("idle");
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
          if (eventName === "log") setInstallLogs((p) => [...p, d.text]);
          if (eventName === "done") {
            if (d.success) {
              setInstallResult("success");
              // 延迟刷新，让用户看到成功状态和日志
              setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ["commands"] });
                queryClient.invalidateQueries({ queryKey: ["versions"] });
              }, 2000);
            } else {
              setInstallResult("error");
            }
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setInstallLogs((p) => [...p, `错误: ${(err as Error).message}`]);
        setInstallResult("error");
      }
    } finally {
      setInstalling(false);
    }
  }

  const filtered = (data ?? []).filter((cmd) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      cmd.site.toLowerCase().includes(q) ||
      cmd.name.toLowerCase().includes(q) ||
      getSiteName(cmd.site).includes(q) ||
      cmd.description?.toLowerCase().includes(q)
    );
  });

  const grouped = filtered.reduce<Record<string, CliCommand[]>>((acc, cmd) => {
    (acc[cmd.site] ??= []).push(cmd);
    return acc;
  }, {});

  // 有中文名的排前面，其余按字母排
  const sites = Object.keys(grouped).sort((a, b) => {
    const aHasCn = getSiteName(a) !== a;
    const bHasCn = getSiteName(b) !== b;
    if (aHasCn && !bHasCn) return -1;
    if (!aHasCn && bHasCn) return 1;
    return getSiteName(a).localeCompare(getSiteName(b), "zh-CN");
  });
  const currentSite = activeSite && grouped[activeSite] ? activeSite : sites[0] ?? null;
  const CMD_PRIORITY: Record<string, number> = {
    hot: 0, trending: 0, ranking: 0,
    search: 1,
    feed: 2, timeline: 2, new: 2, news: 2, top: 2,
    me: 3, profile: 3, status: 3,
    read: 4, download: 4,
    following: 5, followers: 5, notifications: 5,
    history: 6, saved: 6, like: 6, likes: 6,
    send: 7, post: 7, publish: 7, ask: 7, comment: 7,
    follow: 8, unfollow: 8, save: 8, unlike: 8,
    export: 9, dump: 9, stats: 9,
  };

  function cmdOrder(name: string): number {
    return CMD_PRIORITY[name] ?? 100;
  }

  const currentCmds = (currentSite ? (grouped[currentSite] ?? []) : [])
    .slice()
    .sort((a, b) => cmdOrder(a.name) - cmdOrder(b.name) || a.name.localeCompare(b.name));

  function selectSite(site: string) {
    setActiveSite(site);
    setExpandedCmd(null);
  }

  function toggleCmd(key: string) {
    setExpandedCmd((prev) => (prev === key ? null : key));
  }

  if (isLoading) {
    return (
      <div className="flex border rounded-lg overflow-hidden flex-1 min-h-0">
        <div className="w-44 border-r p-3 space-y-1">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
        <div className="flex-1 p-4 space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-destructive/40 rounded-lg p-4 space-y-3">
        {installResult === "success" ? (
          <p className="text-sm text-green-600 font-medium">安装成功，正在加载命令列表...</p>
        ) : (
          <>
            <p className="text-sm text-destructive font-medium">
              加载命令失败，请先安装 opencli
            </p>
            <p className="text-xs text-muted-foreground">
              错误信息：{(error as Error).message}
            </p>
            <Button size="sm" disabled={installing} onClick={runInstall}>
              {installing ? "安装中..." : "一键安装 opencli"}
            </Button>
          </>
        )}
        {installLogs.length > 0 && (
          <ScrollArea className="max-h-48 rounded-md bg-muted px-2 py-1.5">
            <pre className="font-mono text-[11px] whitespace-pre-wrap">{installLogs.join("")}</pre>
          </ScrollArea>
        )}
        {installResult === "error" && (
          <p className="text-xs text-destructive">
            安装失败，请手动执行：<code className="font-mono bg-muted px-1 rounded">npm install -g @jackwener/opencli</code>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* 搜索栏 */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="搜索命令或平台..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setActiveSite(null);
            setExpandedCmd(null);
          }}
          className="max-w-xs"
        />
        {data && (
          <span className="text-xs text-muted-foreground">
            共 {filtered.length} 个命令 · {sites.length} 个平台
          </span>
        )}
      </div>

      {/* 主体 */}
      <div className="flex border rounded-lg overflow-hidden flex-1 min-h-0">
        {/* 左侧平台目录 */}
        <ScrollArea className="w-44 shrink-0 border-r bg-muted/20">
          <div className="py-1">
            {sites.map((site) => (
              <button
                key={site}
                onClick={() => selectSite(site)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-1 transition-colors hover:bg-accent ${
                  currentSite === site
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <span className="truncate">{getSiteName(site)}</span>
                <span className="text-[10px] shrink-0 tabular-nums text-muted-foreground">
                  {grouped[site].length}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>

        {/* 右侧命令列表 */}
        <ScrollArea className="flex-1">
          {currentSite ? (
            <div className="divide-y pb-[calc(100vh-200px)]">
              {currentCmds.map((cmd) => {
                const key = `${cmd.site}/${cmd.name}`;
                const expanded = expandedCmd === key;
                const args = Array.isArray(cmd.args) ? cmd.args : [];

                return (
                  <div key={key}>
                    {/* 命令行头 */}
                    <div
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors hover:bg-muted/40 ${expanded ? "bg-muted/30" : ""}`}
                      onClick={() => toggleCmd(key)}
                    >
                      <span className={`text-muted-foreground text-[10px] transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}>
                        ▶
                      </span>
                      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">{cmd.name}</span>
                        {cmd.strategy && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${strategyColors[cmd.strategy.toLowerCase()] ?? "bg-muted text-muted-foreground"}`}>
                            {strategyLabel[cmd.strategy.toLowerCase()] ?? cmd.strategy}
                          </span>
                        )}
                        {cmd.description && (
                          <span className="text-xs text-muted-foreground truncate max-w-[400px]">
                            {cmd.description}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 展开内容：参数表单 + 执行结果 */}
                    {expanded && (
                      <div className="px-8 py-4 bg-muted/10 border-t">
                        <InlineRunner site={cmd.site} name={cmd.name} args={args} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              请从左侧选择平台
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
