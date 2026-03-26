import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { spawn } from "child_process";

const MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 20_000;

const ALLOWED_COMMAND_PATTERNS = [
  /^(?:npm|pnpm|bun)\s+(?:test|run\s+[\w:-]+)(?:\s+[\w./:@=-]+)*$/i,
  /^yarn\s+[\w:-]+(?:\s+[\w./:@=-]+)*$/i,
  /^npx\s+(?:tsc|eslint|prettier|vitest|jest)(?:\s+[\w./:@=-]+)*$/i,
  /^node\s+(?:--check\s+)?[\w./-]+(?:\s+[\w./:@=-]+)*$/i,
  /^python3?\s+-m\s+py_compile(?:\s+[\w./-]+)+$/i,
  /^(?:pwd|ls|find)(?:\s+[\w./-]+)*$/i,
];

const DISALLOWED_FRAGMENTS = [
  "&&",
  "||",
  ";",
  "|",
  ">",
  "<",
  "$(",
  "`",
  "curl ",
  "wget ",
  "rm ",
  "sudo ",
  "chmod ",
  "chown ",
  "git clone",
  "npm install",
  "pnpm install",
  "yarn install",
  "bun install",
  "--fix",
  "--write",
];

export interface WorkspaceShellEntry {
  path: string;
  type: "file" | "folder";
  content?: string;
}

interface WorkspaceCommandResult {
  output: string;
  changedFiles: Array<{
    path: string;
    content: string;
  }>;
  exitCode: number | null;
  timedOut: boolean;
}

const clipOutput = (value: string) => {
  if (value.length <= MAX_OUTPUT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated]`;
};

export const validateWorkspaceCommand = (command: string) => {
  const trimmed = command.trim();
  if (!trimmed) {
    return "Command is required.";
  }
  if (trimmed.length > 180) {
    return "Command is too long.";
  }
  if (DISALLOWED_FRAGMENTS.some((fragment) => trimmed.includes(fragment))) {
    return "Command contains disallowed shell features or mutating flags.";
  }
  if (!ALLOWED_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "Command is not allowed. Use simple test/build/lint or read-only shell commands.";
  }

  return null;
};

const writeWorkspace = async (
  workspaceDir: string,
  entries: WorkspaceShellEntry[],
  originalTextFiles: Map<string, string>,
) => {
  const sortedEntries = [...entries].sort((a, b) => a.path.localeCompare(b.path));

  for (const entry of sortedEntries) {
    const destination = path.join(workspaceDir, entry.path);

    if (entry.type === "folder") {
      await mkdir(destination, { recursive: true });
      continue;
    }

    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, entry.content ?? "", "utf8");
    originalTextFiles.set(entry.path, entry.content ?? "");
  }
};

const collectChangedFiles = async (
  workspaceDir: string,
  originalTextFiles: Map<string, string>,
) => {
  const changedFiles: Array<{ path: string; content: string }> = [];

  for (const [relativePath, originalContent] of originalTextFiles.entries()) {
    const absolutePath = path.join(workspaceDir, relativePath);

    try {
      const nextContent = await readFile(absolutePath, "utf8");
      if (nextContent !== originalContent) {
        changedFiles.push({
          path: relativePath,
          content: nextContent,
        });
      }
    } catch {
      continue;
    }
  }

  return changedFiles;
};

export const runWorkspaceCommand = async ({
  command,
  entries,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  command: string;
  entries: WorkspaceShellEntry[];
  timeoutMs?: number;
}): Promise<WorkspaceCommandResult> => {
  const validationError = validateWorkspaceCommand(command);
  if (validationError) {
    return {
      output: validationError,
      changedFiles: [],
      exitCode: null,
      timedOut: false,
    };
  }

  const workspaceDir = await mkdtemp(path.join(tmpdir(), "knox-agent-"));
  const originalTextFiles = new Map<string, string>();

  try {
    await writeWorkspace(workspaceDir, entries, originalTextFiles);

    const child = spawn("bash", ["-lc", command], {
      cwd: workspaceDir,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "development",
        CI: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });

      child.on("error", () => {
        clearTimeout(timer);
        resolve(1);
      });
    });

    const changedFiles = await collectChangedFiles(workspaceDir, originalTextFiles);
    const outputSections = [
      `$ ${command}`,
      stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
      stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
      timedOut ? `status: timed out after ${timeoutMs}ms` : `exit code: ${exitCode ?? "unknown"}`,
    ].filter(Boolean);

    return {
      output: clipOutput(outputSections.join("\n\n")),
      changedFiles,
      exitCode,
      timedOut,
    };
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
};
