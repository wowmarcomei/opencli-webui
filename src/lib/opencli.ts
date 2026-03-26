import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type InstallStatus = "installed" | "installing" | "not_installed" | "error";

let installStatus: InstallStatus = "not_installed";
let installLog: string[] = [];

export async function detectOpencli(): Promise<{ installed: boolean; version?: string; path?: string }> {
  try {
    const { stdout } = await execFileAsync("opencli", ["--version"], { timeout: 5000 });
    return { installed: true, version: stdout.trim(), path: "opencli" };
  } catch {
    // Try npx path
    try {
      const { stdout } = await execFileAsync("npx", ["--yes", "@jackwener/opencli", "--version"], { timeout: 10000 });
      return { installed: false, version: stdout.trim() };
    } catch {
      return { installed: false };
    }
  }
}

export async function installOpencli(): Promise<void> {
  installStatus = "installing";
  installLog = [];

  return new Promise((resolve, reject) => {
    const proc = spawn("npm", ["install", "-g", "@jackwener/opencli"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data: Buffer) => {
      installLog.push(data.toString());
    });
    proc.stderr.on("data", (data: Buffer) => {
      installLog.push(data.toString());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        installStatus = "installed";
        resolve();
      } else {
        installStatus = "error";
        reject(new Error(`npm install exited with code ${code}`));
      }
    });
    proc.on("error", (err) => {
      installStatus = "error";
      reject(err);
    });
  });
}

export function getInstallStatus() {
  return { status: installStatus, log: installLog };
}

export function setInstallStatus(s: InstallStatus) {
  installStatus = s;
}

export interface CliCommand {
  site: string;
  name: string;
  description?: string;
  strategy?: string;
  args?: ArgDef[];
  columns?: string[];
}

export interface ArgDef {
  name: string;
  type: "str" | "int" | "bool" | "float";
  default?: unknown;
  required?: boolean;
  positional?: boolean;
  choices?: string[];
  help?: string;
}

export async function listCommands(): Promise<CliCommand[]> {
  const { stdout } = await execFileAsync("opencli", ["list", "-f", "json"], {
    timeout: 30000,
  });
  const raw = JSON.parse(stdout.trim());
  // opencli list -f json returns an array of { site, name, description, ... }
  if (Array.isArray(raw)) return raw;
  // fallback: might be wrapped
  return raw.commands ?? raw.items ?? [];
}

export interface ExecuteOptions {
  site: string;
  name: string;
  args: Record<string, string>;
  format?: "json" | "yaml" | "csv" | "table";
}

export function executeCommand(opts: ExecuteOptions) {
  const { site, name, args, format = "json" } = opts;
  const argv: string[] = [site, name];

  for (const [key, value] of Object.entries(args)) {
    if (value !== "" && value !== undefined && value !== null) {
      argv.push(`--${key}`, String(value));
    }
  }
  argv.push("-f", format);

  return spawn("opencli", argv, { stdio: ["ignore", "pipe", "pipe"] });
}
