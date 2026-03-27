"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BotIcon,
  CableIcon,
  CheckCircle2Icon,
  GitBranchIcon,
  Loader2Icon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useCompanion } from "@/features/companion/provider/companion-provider";
import {
  commitWithCompanion,
  createCompanionCommandJob,
  getCompanionHealth,
  getCompanionGitStatus,
  getCompanionJob,
  pushWithCompanion,
  syncProjectToCompanion,
} from "@/lib/companion-client";
import { useProjectFiles, useCreateFile } from "@/features/projects/hooks/use-files";
import { useEditor } from "@/features/editor/hooks/use-editor";
import { Id } from "../../../../convex/_generated/dataModel";
import { CompanionJobResponse } from "@/lib/companion";

const AGENTS_FILE_NAME = "AGENTS.md";

const DEFAULT_AGENTS_TEMPLATE = `# AGENTS.md

## Working Style
- Keep edits small and easy to review.
- Prefer fixing root causes over patching symptoms.
- Preserve existing app structure unless a change clearly needs a refactor.

## Coding Standards
- Follow the existing naming, formatting, and file organization in this repo.
- Add comments only when the code would otherwise be hard to parse.
- Do not change unrelated files.

## Verification
- Run the smallest relevant checks after making changes.
- Summarize what changed, what was verified, and any remaining risks.
`;

const buildPathMap = (
  entries: Array<{
    _id: Id<"files">;
    parentId?: Id<"files">;
    name: string;
    type: "file" | "folder";
    content?: string;
  }>,
) => {
  const entryMap = new Map(entries.map((entry) => [entry._id, entry]));
  const cache = new Map<Id<"files">, string>();

  const resolvePath = (entryId: Id<"files">): string => {
    const cached = cache.get(entryId);
    if (cached) {
      return cached;
    }

    const entry = entryMap.get(entryId);
    if (!entry) {
      return "";
    }

    const parentPath = entry.parentId ? resolvePath(entry.parentId) : "";
    const nextPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    cache.set(entryId, nextPath);
    return nextPath;
  };

  return {
    resolvePath,
  };
};

export const ProjectCompanionDialog = ({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: Id<"projects">;
}) => {
  const {
    settings,
    connectionState,
    lastError,
    updateSettings,
    refreshHealth,
  } = useCompanion();
  const projectFilesQuery = useProjectFiles(projectId);
  const projectFiles = useMemo(() => projectFilesQuery ?? [], [projectFilesQuery]);
  const createFile = useCreateFile();
  const { openFile } = useEditor(projectId);

  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [token, setToken] = useState(settings.token);
  const [repoPath, setRepoPath] = useState(settings.projectRepoPaths[projectId] ?? "");
  const [commitMessage, setCommitMessage] = useState("");
  const [command, setCommand] = useState("npm run lint");
  const [gitStatus, setGitStatus] = useState<string>("");
  const [job, setJob] = useState<CompanionJobResponse | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const rootAgentsFile = useMemo(
    () =>
      projectFiles.find(
        (entry) => entry.type === "file" && entry.name === AGENTS_FILE_NAME && !entry.parentId,
      ) ?? null,
    [projectFiles],
  );

  const workspaceEntries = useMemo(() => {
    const { resolvePath } = buildPathMap(projectFiles);
    return projectFiles.map((entry) => ({
      path: resolvePath(entry._id),
      type: entry.type,
      content: entry.content,
    }));
  }, [projectFiles]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setBaseUrl(settings.baseUrl);
    setToken(settings.token);
    setRepoPath(settings.projectRepoPaths[projectId] ?? "");
    const lastJobId = settings.projectJobIds[projectId];
    if (!lastJobId) {
      setJob(null);
      return;
    }

    void getCompanionJob(settings, lastJobId)
      .then((nextJob) => setJob(nextJob))
      .catch(() => setJob(null));
  }, [open, projectId, settings]);

  useEffect(() => {
    if (!job || job.status !== "running") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void getCompanionJob(settings, job.id)
        .then((nextJob) => setJob(nextJob))
        .catch(() => undefined);
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [job, settings]);

  const persistSettings = (nextRepoPath?: string, nextJobId?: string | null) => {
    updateSettings({
      ...buildEffectiveSettings(nextRepoPath),
      projectJobIds: {
        ...settings.projectJobIds,
        ...(nextJobId === null
          ? Object.fromEntries(
              Object.entries(settings.projectJobIds).filter(
                ([key]) => key !== projectId,
              ),
            )
          : nextJobId
            ? { [projectId]: nextJobId }
            : {}),
      },
    });
  };

  const buildEffectiveSettings = (nextRepoPath?: string) => {
    return {
      ...settings,
      baseUrl: baseUrl.trim(),
      token: token.trim(),
      projectRepoPaths: {
        ...settings.projectRepoPaths,
        [projectId]: (nextRepoPath ?? repoPath).trim(),
      },
      projectJobIds: settings.projectJobIds,
    };
  };

  const ensureRepoPath = () => {
    const trimmedRepoPath = repoPath.trim();
    if (!trimmedRepoPath) {
      toast.error("Set a local repository path first.");
      return null;
    }

    return trimmedRepoPath;
  };

  const handleSaveAndTest = async () => {
    const nextSettings = buildEffectiveSettings();
    updateSettings(nextSettings);
    try {
      await getCompanionHealth(nextSettings);
      toast.success("Companion connection verified.");
      await refreshHealth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Companion unavailable");
    }
  };

  const handleSync = async () => {
    const normalizedRepoPath = ensureRepoPath();
    if (!normalizedRepoPath) {
      return;
    }

    setIsBusy(true);
    try {
      const nextSettings = buildEffectiveSettings(normalizedRepoPath);
      updateSettings(nextSettings);
      const entries = workspaceEntries.filter((entry) => Boolean(entry.path));
      await syncProjectToCompanion(
        nextSettings,
        projectId,
        normalizedRepoPath,
        entries,
      );
      toast.success("Project synced to local companion workspace.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handleRefreshGitStatus = async () => {
    const normalizedRepoPath = ensureRepoPath();
    if (!normalizedRepoPath) {
      return;
    }

    setIsBusy(true);
    try {
      const nextSettings = buildEffectiveSettings(normalizedRepoPath);
      await syncProjectToCompanion(
        nextSettings,
        projectId,
        normalizedRepoPath,
        workspaceEntries.filter((entry) => Boolean(entry.path)),
      );
      const status = await getCompanionGitStatus(nextSettings, normalizedRepoPath);
      setGitStatus(status.status || `On branch ${status.branch}\nWorking tree clean.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load git status");
    } finally {
      setIsBusy(false);
    }
  };

  const handleCommit = async () => {
    const normalizedRepoPath = ensureRepoPath();
    if (!normalizedRepoPath) {
      return;
    }

    if (!commitMessage.trim()) {
      toast.error("Commit message is required.");
      return;
    }

    setIsBusy(true);
    try {
      const nextSettings = buildEffectiveSettings(normalizedRepoPath);
      await syncProjectToCompanion(
        nextSettings,
        projectId,
        normalizedRepoPath,
        workspaceEntries.filter((entry) => Boolean(entry.path)),
      );
      const result = await commitWithCompanion(
        nextSettings,
        normalizedRepoPath,
        commitMessage,
      );
      toast.success(result.summary);
      await handleRefreshGitStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Commit failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handlePush = async () => {
    const normalizedRepoPath = ensureRepoPath();
    if (!normalizedRepoPath) {
      return;
    }

    setIsBusy(true);
    try {
      const nextSettings = buildEffectiveSettings(normalizedRepoPath);
      const result = await pushWithCompanion(nextSettings, normalizedRepoPath);
      toast.success(result.summary);
      await handleRefreshGitStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Push failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handleRunCommand = async () => {
    const normalizedRepoPath = ensureRepoPath();
    if (!normalizedRepoPath) {
      return;
    }

    if (!command.trim()) {
      toast.error("Command is required.");
      return;
    }

    setIsBusy(true);
    try {
      const nextSettings = buildEffectiveSettings(normalizedRepoPath);
      await syncProjectToCompanion(
        nextSettings,
        projectId,
        normalizedRepoPath,
        workspaceEntries.filter((entry) => Boolean(entry.path)),
      );
      const nextJob = await createCompanionCommandJob(
        nextSettings,
        normalizedRepoPath,
        command,
      );
      setJob(nextJob);
      persistSettings(normalizedRepoPath, nextJob.id);
      toast.success("Command started in local companion.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start command");
    } finally {
      setIsBusy(false);
    }
  };

  const handleOpenOrCreateAgentsFile = async () => {
    try {
      if (rootAgentsFile) {
        openFile(rootAgentsFile._id, { pinned: true });
        onOpenChange(false);
        return;
      }

      const fileId = await createFile({
        projectId,
        name: AGENTS_FILE_NAME,
        content: DEFAULT_AGENTS_TEMPLATE,
      });

      if (fileId) {
        openFile(fileId, { pinned: true });
      }
      toast.success("Created AGENTS.md for project instructions.");
      onOpenChange(false);
    } catch {
      toast.error("Unable to create AGENTS.md");
    }
  };

  const connectionLabel =
    connectionState === "connected"
      ? "Connected"
      : connectionState === "checking"
        ? "Checking"
        : connectionState === "disconnected"
          ? "Disconnected"
          : "Idle";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Local Companion</DialogTitle>
          <DialogDescription>
            Connect Knox to a localhost daemon for terminal, git, and persistent background jobs.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Alert>
            <CableIcon />
            <AlertTitle>{connectionLabel}</AlertTitle>
            <AlertDescription>
              <p>
                Run <code>npm run companion</code> on the user machine, then save the URL, token, and repo path below.
              </p>
              {lastError && <p>{lastError}</p>}
            </AlertDescription>
          </Alert>

          <div className="grid gap-2 md:grid-cols-2 md:gap-4">
            <div className="grid gap-2">
              <Label htmlFor="companion-url">Companion URL</Label>
              <Input
                id="companion-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://127.0.0.1:4318"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="companion-token">Token</Label>
              <Input
                id="companion-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="paste the companion token"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="repo-path">Local repo path for this project</Label>
            <Input
              id="repo-path"
              value={repoPath}
              onChange={(event) => setRepoPath(event.target.value)}
              placeholder="/Users/you/projects/my-repo"
            />
          </div>

          <div className="grid gap-2 md:grid-cols-2 md:gap-4">
            <Alert>
              <BotIcon />
              <AlertTitle>Project Instructions</AlertTitle>
              <AlertDescription>
                <p>
                  {rootAgentsFile
                    ? "AGENTS.md exists at the project root. Open it to define coding style and workflow rules."
                    : "Create AGENTS.md to make the agent follow repo-specific coding style and commands."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={handleOpenOrCreateAgentsFile}
                >
                  <CheckCircle2Icon className="size-4" />
                  {rootAgentsFile ? "Open AGENTS.md" : "Create AGENTS.md"}
                </Button>
              </AlertDescription>
            </Alert>

            <Alert>
              <GitBranchIcon />
              <AlertTitle>Git Push</AlertTitle>
              <AlertDescription>
                <p>
                  Sync writes the current Knox project snapshot into the local repo path, then git actions run there using the user machine credentials.
                </p>
              </AlertDescription>
            </Alert>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="git-status">Git status</Label>
            <Textarea
              id="git-status"
              value={gitStatus}
              onChange={() => undefined}
              readOnly
              className="min-h-32 font-mono text-xs"
              placeholder="Refresh git status after syncing."
            />
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
            <div className="grid gap-2">
              <Label htmlFor="commit-message">Commit message</Label>
              <Input
                id="commit-message"
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="feat: describe the change"
              />
            </div>
            <Button type="button" variant="outline" onClick={handleRefreshGitStatus} disabled={isBusy}>
              <RefreshCwIcon className="size-4" />
              Status
            </Button>
            <Button type="button" variant="outline" onClick={handleCommit} disabled={isBusy}>
              <GitBranchIcon className="size-4" />
              Commit
            </Button>
            <Button type="button" onClick={handlePush} disabled={isBusy}>
              Push
            </Button>
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
            <div className="grid gap-2">
              <Label htmlFor="command">Background command</Label>
              <Input
                id="command"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npm run lint"
              />
            </div>
            <Button type="button" variant="outline" onClick={handleSync} disabled={isBusy}>
              Sync
            </Button>
            <Button type="button" onClick={handleRunCommand} disabled={isBusy}>
              <PlayIcon className="size-4" />
              Run
            </Button>
          </div>

          {job && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Last companion job</Label>
                <span className="text-xs text-muted-foreground">
                  {job.status}
                </span>
              </div>
              <Textarea
                value={job.output}
                onChange={() => undefined}
                readOnly
                className="min-h-48 font-mono text-xs"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleSaveAndTest} disabled={isBusy}>
            {isBusy ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Save and Test
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
