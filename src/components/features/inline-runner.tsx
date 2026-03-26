"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ArgDef } from "@/lib/opencli";
import { getArgName } from "@/lib/arg-names";
import { getColName } from "@/lib/col-names";
import { convertData, downloadFile, FORMAT_META, type OutputFormat } from "@/lib/format-convert";

interface Props {
  site: string;
  name: string;
  args: ArgDef[];
}

type ResultRow = Record<string, unknown>;

function buildZodSchema(args: ArgDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const def of args) {
    let field: z.ZodTypeAny;
    switch (def.type) {
      case "int":
      case "float":
        field = z.string().regex(/^-?\d*\.?\d*$/, "请输入数字").optional();
        break;
      case "bool":
        field = z.enum(["true", "false"]).optional();
        break;
      default:
        field = z.string().optional();
    }
    if (def.required) {
      field = z.string().min(1, `${def.name} 为必填项`);
    }
    shape[def.name] = field;
  }
  return z.object(shape);
}

function renderCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "object") return <span className="text-muted-foreground font-mono text-xs">[对象]</span>;
  const str = String(value);
  if (str.startsWith("http://") || str.startsWith("https://")) {
    return (
      <a href={str} target="_blank" rel="noopener noreferrer"
        className="text-primary underline-offset-2 hover:underline truncate block max-w-[260px]">
        {str}
      </a>
    );
  }
  return str;
}

export function InlineRunner({ site, name, args }: Props) {
  const schema = buildZodSchema(args);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: Object.fromEntries(
      args.map((def) => [def.name, def.default != null ? String(def.default) : ""])
    ),
  });

  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<OutputFormat>("table");
  const [ran, setRan] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const tableData = Array.isArray(result) ? (result as ResultRow[]) : null;
  const columns = tableData && tableData.length > 0 ? Object.keys(tableData[0]) : [];
  const isTabular = tableData && tableData.length > 0;

  async function onSubmit(values: Record<string, unknown>) {
    setLogs([]);
    setResult(null);
    setRan(true);
    setRunning(true);

    abortRef.current = new AbortController();
    const argMap = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, String(v ?? "")])
    );

    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, name, args: argMap }),
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
          let eventName = "message";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventName = line.slice(7);
            if (line.startsWith("data: ")) dataLine = line.slice(6);
          }
          if (!dataLine) continue;
          const data = JSON.parse(dataLine);

          if (eventName === "log") {
            setLogs((prev) => [...prev, data.text]);
          } else if (eventName === "result") {
            setResult(data.data);
            setTab(Array.isArray(data.data) && data.data.length > 0 ? "table" : "json");
          } else if (eventName === "error") {
            setLogs((prev) => [...prev, `\n错误: ${data.message}\n`]);
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setLogs((prev) => [...prev, `\n请求失败: ${(err as Error).message}`]);
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* 参数表单 */}
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {args.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
            {args.map((def) => (
              <div key={def.name} className="space-y-0.5">
                {(() => {
                  const { cn, en } = getArgName(def.name);
                  return (
                    <label className="text-[11px] text-muted-foreground flex gap-1 items-baseline flex-wrap">
                      {cn ? (
                        <><span className="font-medium text-foreground/80">{cn}</span><span className="font-mono opacity-50">{en}</span></>
                      ) : (
                        <span className="font-mono">{en}</span>
                      )}
                      {def.required && <span className="text-destructive">*</span>}
                      {def.default !== null && def.default !== undefined && def.default !== "" && (
                        <span className="opacity-50">默认 {String(def.default)}</span>
                      )}
                    </label>
                  );
                })()}
                {def.help && (
                  <p className="text-[10px] text-muted-foreground/60 leading-tight">{def.help}</p>
                )}
                {def.choices && def.choices.length > 0 ? (
                  <>
                    <Input
                      {...form.register(def.name)}
                      list={`datalist-${def.name}`}
                      placeholder={def.default != null ? String(def.default) : "选择或输入..."}
                      className="h-7 text-xs"
                      autoComplete="off"
                    />
                    <datalist id={`datalist-${def.name}`}>
                      {def.choices.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </>
                ) : def.type === "bool" ? (
                  <select
                    {...form.register(def.name)}
                    className="flex h-7 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">-- 默认 --</option>
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                ) : (
                  <Input
                    {...form.register(def.name)}
                    placeholder={def.default != null ? String(def.default) : def.help ?? ""}
                    type={def.type === "int" || def.type === "float" ? "number" : "text"}
                    className="h-7 text-xs"
                  />
                )}
                {form.formState.errors[def.name] && (
                  <p className="text-[10px] text-destructive">
                    {form.formState.errors[def.name]?.message as string}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={running}>
            {running ? "执行中..." : "执行"}
          </Button>
          {running && (
            <Button type="button" size="sm" variant="outline" onClick={() => abortRef.current?.abort()}>
              取消
            </Button>
          )}
        </div>
      </form>

      {/* 执行结果 */}
      {ran && (
        <div className="border rounded-md overflow-hidden">
          {logs.length > 0 && (
            <ScrollArea className="max-h-24 bg-muted/50 border-b">
              <pre className="font-mono text-[11px] p-2 whitespace-pre-wrap">{logs.join("")}</pre>
            </ScrollArea>
          )}

          {result !== null && (
            <Tabs value={tab} onValueChange={(v) => setTab(v as OutputFormat)}>
              {/* Tab 栏 + 导出按钮 */}
              <div className="flex items-center justify-between border-b px-1">
                <TabsList variant="line" className="rounded-none bg-transparent">
                  {isTabular && <TabsTrigger value="table">表格</TabsTrigger>}
                  <TabsTrigger value="json">JSON</TabsTrigger>
                  <TabsTrigger value="yaml">YAML</TabsTrigger>
                  {isTabular && <TabsTrigger value="csv">CSV</TabsTrigger>}
                  {isTabular && <TabsTrigger value="md">Markdown</TabsTrigger>}
                </TabsList>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs px-2 mr-1"
                  onClick={() => {
                    const fmt = tab === "table" ? "csv" : tab;
                    const content = convertData(result, fmt as OutputFormat);
                    const meta = FORMAT_META[fmt as OutputFormat] ?? FORMAT_META.json;
                    downloadFile(content, `result.${meta.ext}`, meta.mime);
                  }}
                >
                  导出
                </Button>
              </div>

              {/* 表格视图 */}
              {isTabular && (
                <TabsContent value="table">
                  <ScrollArea className="max-h-64">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/80">
                        <tr>
                          {columns.map((col) => {
                            const cn = getColName(col);
                            return (
                              <th key={col} className="text-left font-medium px-3 py-1.5 whitespace-nowrap border-b">
                                {cn ? (
                                  <span className="flex flex-col leading-tight">
                                    <span>{cn}</span>
                                    <span className="font-normal text-[10px] text-muted-foreground opacity-70">{col}</span>
                                  </span>
                                ) : col}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {tableData!.map((row, i) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                            {columns.map((col) => (
                              <td key={col} className="px-3 py-1.5 max-w-[200px] truncate">
                                {renderCell(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>
                </TabsContent>
              )}

              {/* 文本视图（JSON / YAML / CSV / MD 共用） */}
              {(["json", "yaml", "csv", "md"] as OutputFormat[]).map((fmt) => (
                <TabsContent key={fmt} value={fmt}>
                  <ScrollArea className="max-h-64 bg-muted/30">
                    <pre className="font-mono text-[11px] p-3 whitespace-pre-wrap">
                      {convertData(result, fmt)}
                    </pre>
                  </ScrollArea>
                </TabsContent>
              ))}
            </Tabs>
          )}

          {running && result === null && logs.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground animate-pulse">正在执行...</div>
          )}
        </div>
      )}
    </div>
  );
}
