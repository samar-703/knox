import { createServer, IncomingMessage, ServerResponse } from "http";
import { mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import path from "path";
import { execFile, spawn } from "child_process";
import { randomUUID } from "crypto";

const DEFAULT_PORT = 4318;
const COMPANION_VERSION = "0.1.0";
const CONFIG_DIR = path.join(homedir(), ".knox");
const CONFIG_PATH = path.join(CONFIG_DIR, "companion.json");
const MANIFEST_DIR = path.join(CONFIG_DIR, "managed-workspaces");
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

type WorkspaceEntry = {
  path: string;
  type: "file" | "folder";
  content?: string;
};

type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

type JobRecord = {
  id: string;
  command: string;
  repoPath: string;
  status: JobStatus;
  output: string;
  exitCode: number | null;
  createdAt: number;
  updatedAt: number;
  process?: ReturnType<typeof spawn>;
};

const jobs = new Map<string, JobRecord>();

const json = (res: ServerResponse, statusCode: number, payload: unknown) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.end(JSON.stringify(payload));
};

const execFileAsync = (
  file: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { cwd, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }

      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });

const ensureDirectory = async (directoryPath: string) => {
  await mkdir(directoryPath, { recursive: true });
};

const loadRequestBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const normalizeRepoPath = (repoPath: string) => path.resolve(repoPath.trim());

const assertLocalPath = async (repoPath: string) => {
  const normalized = normalizeRepoPath(repoPath);
  const details = await stat(normalized);
  if (!details.isDirectory()) {
    throw new Error("Repository path must be a directory");
  }
  return normalized;
};

const loadCompanionConfig = async () => {
  await ensureDirectory(CONFIG_DIR);

  if (!existsSync(CONFIG_PATH)) {
    const config = {
      token: process.env.KNOX_COMPANION_TOKEN || randomUUID(),
      port: Number(process.env.KNOX_COMPANION_PORT || DEFAULT_PORT),
    };
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
    return config;
  }

  const rawValue = await readFile(CONFIG_PATH, "utf8");
  return JSON.parse(rawValue) as { token: string; port: number };
};

const getManifestPath = (projectId: string) =>
  path.join(MANIFEST_DIR, `${projectId}.json`);

const loadManifest = async (projectId: string) => {
  const manifestPath = getManifestPath(projectId);
  if (!existsSync(manifestPath)) {
    return [] as string[];
  }

  const rawValue = await readFile(manifestPath, "utf8");
  return JSON.parse(rawValue) as string[];
};

const saveManifest = async (projectId: string, paths: string[]) => {
  await ensureDirectory(MANIFEST_DIR);
  await writeFile(getManifestPath(projectId), JSON.stringify(paths, null, 2), "utf8");
};

const syncWorkspace = async ({
  projectId,
  repoPath,
  entries,
}: {
  projectId: string;
  repoPath: string;
  entries: WorkspaceEntry[];
}) => {
  const normalizedRepoPath = await assertLocalPath(repoPath);
  const previousManifest = new Set(await loadManifest(projectId));
  const nextManifest = new Set<string>();

  const sortedEntries = [...entries].sort((a, b) => a.path.localeCompare(b.path));

  for (const entry of sortedEntries) {
    const destination = path.join(normalizedRepoPath, entry.path);

    if (entry.type === "folder") {
      await mkdir(destination, { recursive: true });
      continue;
    }

    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, entry.content ?? "", "utf8");
    nextManifest.add(entry.path);
  }

  for (const stalePath of previousManifest) {
    if (nextManifest.has(stalePath)) {
      continue;
    }

    await rm(path.join(normalizedRepoPath, stalePath), { force: true });
  }

  await saveManifest(projectId, [...nextManifest].sort());
  return normalizedRepoPath;
};

const getGitStatus = async (repoPath: string) => {
  const cwd = await assertLocalPath(repoPath);
  const [{ stdout: branch }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    execFileAsync("git", ["status", "--short", "--branch"], cwd),
  ]);

  return {
    branch,
    clean: !status.split("\n").some((line) => line.trim() && !line.startsWith("##")),
    status,
  };
};

const commitGitChanges = async (repoPath: string, message: string) => {
  const cwd = await assertLocalPath(repoPath);
  if (!message.trim()) {
    throw new Error("Commit message is required");
  }

  await execFileAsync("git", ["add", "-A"], cwd);
  const { stdout } = await execFileAsync("git", ["commit", "-m", message.trim()], cwd);
  return stdout || "Commit created.";
};

const pushGitChanges = async (repoPath: string) => {
  const cwd = await assertLocalPath(repoPath);
  const { stdout } = await execFileAsync("git", ["push"], cwd);
  return stdout || "Push completed.";
};

const startCommandJob = async ({
  repoPath,
  command,
}: {
  repoPath: string;
  command: string;
}) => {
  const cwd = await assertLocalPath(repoPath);
  const id = randomUUID();
  const now = Date.now();
  const job: JobRecord = {
    id,
    repoPath: cwd,
    command: command.trim(),
    status: "queued",
    output: "",
    exitCode: null,
    createdAt: now,
    updatedAt: now,
  };

  jobs.set(id, job);

  const child = spawn("bash", ["-lc", command], {
    cwd,
    env: {
      ...process.env,
      CI: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  job.process = child;
  job.status = "running";
  job.updatedAt = Date.now();

  const appendOutput = (chunk: Buffer | string, label: "stdout" | "stderr") => {
    const text = chunk.toString();
    job.output += `${label}: ${text}`;
    job.updatedAt = Date.now();
  };

  child.stdout.on("data", (chunk) => appendOutput(chunk, "stdout"));
  child.stderr.on("data", (chunk) => appendOutput(chunk, "stderr"));

  const timer = setTimeout(() => {
    if (job.status === "running") {
      job.status = "failed";
      job.output += `\nProcess timed out after ${COMMAND_TIMEOUT_MS}ms.`;
      job.updatedAt = Date.now();
      child.kill("SIGTERM");
    }
  }, COMMAND_TIMEOUT_MS);

  child.on("close", (code) => {
    clearTimeout(timer);
    if (job.status === "cancelled") {
      job.exitCode = code;
      job.updatedAt = Date.now();
      return;
    }

    job.exitCode = code;
    job.status = code === 0 ? "completed" : "failed";
    job.updatedAt = Date.now();
  });

  child.on("error", (error) => {
    clearTimeout(timer);
    job.status = "failed";
    job.output += `\nerror: ${error.message}`;
    job.exitCode = 1;
    job.updatedAt = Date.now();
  });

  return job;
};

const cancelJob = (jobId: string) => {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error("Job not found");
  }

  if (job.status !== "running" || !job.process) {
    return job;
  }

  job.status = "cancelled";
  job.updatedAt = Date.now();
  job.process.kill("SIGTERM");
  return job;
};

const requireAuth = (req: IncomingMessage, token: string) => {
  const authHeader = req.headers.authorization;
  const expected = `Bearer ${token}`;
  if (authHeader !== expected) {
    throw new Error("Unauthorized");
  }
};

const main = async () => {
  const config = await loadCompanionConfig();

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        json(res, 204, {});
        return;
      }

      if (!req.url || !req.method) {
        json(res, 404, { error: "Not found" });
        return;
      }

      if (req.url !== "/health") {
        requireAuth(req, config.token);
      }

      if (req.method === "GET" && req.url === "/health") {
        json(res, 200, {
          ok: true,
          version: COMPANION_VERSION,
          capabilities: ["workspace-sync", "git", "jobs"],
        });
        return;
      }

      if (req.method === "POST" && req.url === "/workspace/sync") {
        const body = (await loadRequestBody(req)) as {
          projectId?: string;
          repoPath?: string;
          entries?: WorkspaceEntry[];
        } | null;

        if (!body?.projectId || !body.repoPath || !Array.isArray(body.entries)) {
          throw new Error("projectId, repoPath, and entries are required");
        }

        await syncWorkspace({
          projectId: body.projectId,
          repoPath: body.repoPath,
          entries: body.entries,
        });

        json(res, 200, { ok: true, syncedEntries: body.entries.length });
        return;
      }

      if (req.method === "POST" && req.url === "/git/status") {
        const body = (await loadRequestBody(req)) as { repoPath?: string } | null;
        if (!body?.repoPath) {
          throw new Error("repoPath is required");
        }

        json(res, 200, await getGitStatus(body.repoPath));
        return;
      }

      if (req.method === "POST" && req.url === "/git/commit") {
        const body = (await loadRequestBody(req)) as {
          repoPath?: string;
          message?: string;
        } | null;
        if (!body?.repoPath || !body.message) {
          throw new Error("repoPath and message are required");
        }

        json(res, 200, {
          ok: true,
          summary: await commitGitChanges(body.repoPath, body.message),
        });
        return;
      }

      if (req.method === "POST" && req.url === "/git/push") {
        const body = (await loadRequestBody(req)) as { repoPath?: string } | null;
        if (!body?.repoPath) {
          throw new Error("repoPath is required");
        }

        json(res, 200, {
          ok: true,
          summary: await pushGitChanges(body.repoPath),
        });
        return;
      }

      if (req.method === "POST" && req.url === "/jobs/command") {
        const body = (await loadRequestBody(req)) as {
          repoPath?: string;
          command?: string;
        } | null;
        if (!body?.repoPath || !body.command) {
          throw new Error("repoPath and command are required");
        }

        json(res, 200, await startCommandJob(body as { repoPath: string; command: string }));
        return;
      }

      if (req.method === "GET" && req.url.startsWith("/jobs/")) {
        const jobId = req.url.slice("/jobs/".length);
        const job = jobs.get(jobId);
        if (!job) {
          json(res, 404, { error: "Job not found" });
          return;
        }

        json(res, 200, job);
        return;
      }

      if (req.method === "POST" && req.url.startsWith("/jobs/") && req.url.endsWith("/cancel")) {
        const jobId = req.url.replace("/jobs/", "").replace("/cancel", "");
        json(res, 200, cancelJob(jobId));
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const statusCode = message === "Unauthorized" ? 401 : 400;
      json(res, statusCode, { error: message });
    }
  });

  server.listen(config.port, "127.0.0.1", () => {
    console.log(`Knox companion listening on http://127.0.0.1:${config.port}`);
    console.log(`Token: ${config.token}`);
  });
};

void main();
