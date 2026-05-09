import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
  type ExecFileOptions,
  type SpawnOptions,
} from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const OPENCLI_ENTRYPOINT = "node_modules/@jackwener/opencli/dist/src/main.js";

interface CommandInvocation {
  command: string;
  argsPrefix: string[];
  path: string;
  shell?: boolean;
}

function getOpencliInvocation(): CommandInvocation {
  return {
    command: process.execPath,
    argsPrefix: [OPENCLI_ENTRYPOINT],
    path: OPENCLI_ENTRYPOINT,
  };
}

export async function execOpencli(args: string[], options: ExecFileOptions = {}) {
  const invocation = getOpencliInvocation();
  const { stdout, stderr } = await execFileAsync(invocation.command, [...invocation.argsPrefix, ...args], {
    ...options,
    encoding: "utf8",
    shell: invocation.shell ?? options.shell,
  });

  return { stdout: String(stdout), stderr: String(stderr) };
}

export function spawnOpencli(args: string[], options: SpawnOptions = {}): ChildProcessWithoutNullStreams {
  const invocation = getOpencliInvocation();
  return spawn(invocation.command, [...invocation.argsPrefix, ...args], {
    ...options,
    shell: invocation.shell ?? options.shell,
  }) as ChildProcessWithoutNullStreams;
}

export function getOpencliPath() {
  return getOpencliInvocation().path;
}

export function spawnNpm(args: string[], options: SpawnOptions = {}): ChildProcessWithoutNullStreams {
  return spawn("npm", args, {
    ...options,
    shell: process.platform === "win32",
  }) as ChildProcessWithoutNullStreams;
}
