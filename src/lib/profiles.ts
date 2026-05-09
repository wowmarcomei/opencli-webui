import { mkdir, readFile, writeFile } from "fs/promises";
import os from "os";
import path from "path";

const DAEMON_PORT = process.env.OPENCLI_DAEMON_PORT ?? "19825";

interface ProfileConfig {
  version: number;
  aliases: Record<string, string>;
  defaultContextId?: string;
}

interface DaemonProfile {
  contextId: string;
  extensionVersion?: string;
  pending?: number;
  lastSeenAt?: number;
}

interface DaemonStatus {
  daemonVersion?: string;
  extensionConnected?: boolean;
  extensionVersion?: string;
  contextId?: string;
  profileRequired?: boolean;
  profileDisconnected?: boolean;
  profiles?: DaemonProfile[];
}

export interface BrowserProfile {
  contextId: string;
  alias?: string;
  extensionVersion?: string;
  isDefault: boolean;
  pending?: number;
  lastSeenAt?: number;
}

function profileConfigPath() {
  const baseDir = process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), ".opencli");
  return path.join(baseDir, "browser-profiles.json");
}

async function loadProfileConfig(): Promise<ProfileConfig> {
  try {
    const raw = await readFile(profileConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ProfileConfig>;
    return {
      version: 1,
      aliases: parsed.aliases && typeof parsed.aliases === "object" ? parsed.aliases : {},
      ...(typeof parsed.defaultContextId === "string" && parsed.defaultContextId.trim()
        ? { defaultContextId: parsed.defaultContextId.trim() }
        : {}),
    };
  } catch {
    return { version: 1, aliases: {} };
  }
}

async function saveProfileConfig(config: ProfileConfig) {
  const target = profileConfigPath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function aliasForContextId(config: ProfileConfig, contextId: string) {
  return Object.entries(config.aliases).find(([, id]) => id === contextId)?.[0];
}

async function fetchDaemonStatus(): Promise<DaemonStatus | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${DAEMON_PORT}/status`, {
      headers: { "X-OpenCLI": "1" },
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as DaemonStatus;
  } catch {
    return null;
  }
}

export async function getBrowserProfileState() {
  const [config, status] = await Promise.all([loadProfileConfig(), fetchDaemonStatus()]);
  const defaultContextId = config.defaultContextId ?? null;
  const profiles = (status?.profiles ?? []).map<BrowserProfile>((profile) => ({
    contextId: profile.contextId,
    alias: aliasForContextId(config, profile.contextId),
    extensionVersion: profile.extensionVersion,
    isDefault: defaultContextId === profile.contextId,
    pending: profile.pending,
    lastSeenAt: profile.lastSeenAt,
  }));

  const disconnectedDefault = defaultContextId && !profiles.some((profile) => profile.contextId === defaultContextId)
    ? defaultContextId
    : null;

  return {
    daemonRunning: status !== null,
    daemonVersion: status?.daemonVersion ?? null,
    defaultContextId,
    selectedContextId: status?.contextId ?? defaultContextId,
    disconnectedDefault,
    profileRequired: !!status?.profileRequired,
    profileDisconnected: !!status?.profileDisconnected,
    profiles,
  };
}

export async function setDefaultBrowserProfile(contextId: string) {
  const trimmed = contextId.trim();
  if (!trimmed) {
    throw new Error("profile contextId is required");
  }

  const config = await loadProfileConfig();
  config.defaultContextId = trimmed;
  await saveProfileConfig(config);
}
