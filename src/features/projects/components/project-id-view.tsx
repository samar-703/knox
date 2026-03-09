"use client";

import { useEffect, useMemo, useState } from "react";
import ky, { HTTPError } from "ky";
import { toast } from "sonner";
import { Allotment } from "allotment";
import { Loader2Icon } from "lucide-react";
import { FaGithub } from "react-icons/fa";

import { cn } from "@/lib/utils";
import { sanitizeGitHubRepoName } from "@/lib/github";
import { EditorView } from "@/features/editor/components/editor-view";
import {
  useProject,
} from "@/features/projects/hooks/use-projects";
import { useProjectFiles } from "@/features/projects/hooks/use-files";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Id } from "../../../../convex/_generated/dataModel";
import { FileExplorer } from "./file-explorer";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 800;
const DEFAULT_SIDEBAR_WIDTH = 350;
const DEFAULT_MAIN_SIZE = 1000;

interface PreviewFile {
  _id: string;
  path: string;
  content: string;
}

const isHtmlFile = (path: string) => /\.(html?)$/i.test(path);
const isMarkdownFile = (path: string) => /\.(md|mdx)$/i.test(path);

const Tab = ({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 h-full px-3 cursor-pointer text-muted-foreground border-r hover:bg-accent/30",
        isActive && "bg-background text-foreground",
      )}
    >
      <span className="text-sm">{label}</span>
    </button>
  );
};

export const ProjectIdView = ({
  projectId,
}: {
  projectId: Id<"projects">;
}) => {
  const project = useProject(projectId);
  const projectFiles = useProjectFiles(projectId);

  const [activeView, setActiveView] = useState<"editor" | "preview">("editor");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportRepoName, setExportRepoName] = useState("");
  const [isPrivateRepo, setIsPrivateRepo] = useState(true);
  const [isExportingRequest, setIsExportingRequest] = useState(false);
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);

  const previewFiles = useMemo<PreviewFile[]>(() => {
    if (!projectFiles) {
      return [];
    }

    const fileMap = new Map(projectFiles.map((file) => [file._id, file]));
    return projectFiles
      .filter((entry) => entry.type === "file" && typeof entry.content === "string")
      .map((entry) => {
        const pathSegments = [entry.name];
        let parentId = entry.parentId;

        while (parentId) {
          const parent = fileMap.get(parentId);
          if (!parent) {
            break;
          }
          pathSegments.unshift(parent.name);
          parentId = parent.parentId;
        }

        return {
          _id: entry._id,
          path: pathSegments.join("/"),
          content: entry.content ?? "",
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [projectFiles]);

  const defaultPreviewPath = useMemo(() => {
    const rootIndex = previewFiles.find((file) => /^index\.html?$/i.test(file.path));
    if (rootIndex) {
      return rootIndex.path;
    }

    const anyHtml = previewFiles.find((file) => isHtmlFile(file.path));
    if (anyHtml) {
      return anyHtml.path;
    }

    const anyMarkdown = previewFiles.find((file) => isMarkdownFile(file.path));
    if (anyMarkdown) {
      return anyMarkdown.path;
    }

    return previewFiles[0]?.path ?? null;
  }, [previewFiles]);

  useEffect(() => {
    if (!defaultPreviewPath) {
      setSelectedPreviewPath(null);
      return;
    }

    if (
      !selectedPreviewPath ||
      !previewFiles.some((file) => file.path === selectedPreviewPath)
    ) {
      setSelectedPreviewPath(defaultPreviewPath);
    }
  }, [defaultPreviewPath, previewFiles, selectedPreviewPath]);

  const selectedPreview = previewFiles.find(
    (file) => file.path === selectedPreviewPath,
  );

  const isExporting = isExportingRequest || project?.exportStatus === "exporting";

  const handleOpenExportDialog = () => {
    setExportRepoName(sanitizeGitHubRepoName(project?.name ?? "knox-export"));
    setIsPrivateRepo(true);
    setExportDialogOpen(true);
  };

  const handleExport = async () => {
    if (!exportRepoName.trim()) {
      toast.error("Repository name is required.");
      return;
    }

    setIsExportingRequest(true);
    try {
      const response = await ky
        .post(`/api/projects/${projectId}/export`, {
          json: {
            repoName: exportRepoName.trim(),
            isPrivate: isPrivateRepo,
          },
          timeout: false,
        })
        .json<{ repoUrl: string; exportedFiles: number; skippedFiles: number }>();

      toast.success(
        `Exported ${response.exportedFiles} files${response.skippedFiles > 0 ? ` (${response.skippedFiles} skipped)` : ""}.`,
      );
      setExportDialogOpen(false);
    } catch (error) {
      let message = "Failed to export project.";
      if (error instanceof HTTPError) {
        const payload = (await error.response.json().catch(() => null)) as
          | { error?: string }
          | null;
        message = payload?.error ?? message;
      }
      toast.error(message);
    } finally {
      setIsExportingRequest(false);
    }
  };

  return (
    <>
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export to GitHub</DialogTitle>
            <DialogDescription>
              Create a new repository and upload your project files.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="export-repo-name">Repository name</Label>
              <Input
                id="export-repo-name"
                value={exportRepoName}
                onChange={(event) => setExportRepoName(event.target.value)}
                placeholder="my-knox-project"
                disabled={isExporting}
              />
            </div>
            <Label htmlFor="export-private" className="flex items-center gap-2">
              <Checkbox
                id="export-private"
                checked={isPrivateRepo}
                onCheckedChange={(checked) => setIsPrivateRepo(checked === true)}
                disabled={isExporting}
              />
              Private repository
            </Label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExportDialogOpen(false)}
              disabled={isExporting}
            >
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={!exportRepoName.trim() || isExporting}>
              {isExporting ? "Exporting..." : "Export"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="h-full flex flex-col">
        <nav className="h-8.75 flex items-center bg-sidebar border-b">
          <Tab
            label="Code"
            isActive={activeView === "editor"}
            onClick={() => setActiveView("editor")}
          />
          <Tab
            label="Preview"
            isActive={activeView === "preview"}
            onClick={() => setActiveView("preview")}
          />
          <div className="flex-1 flex justify-end h-full">
            <button
              className="flex items-center gap-1.5 h-full px-3 cursor-pointer text-muted-foreground border-l hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleOpenExportDialog}
              disabled={isExporting}
            >
              {isExporting ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <FaGithub className="size-3.5" />
              )}
              <span className="text-sm">Export</span>
            </button>
          </div>
        </nav>
        <div className="flex-1 relative ">
          <div
            className={cn(
              "absolute inset-0",
              activeView === "editor" ? "visible" : "invisible",
            )}
          >
            <Allotment defaultSizes={[DEFAULT_SIDEBAR_WIDTH, DEFAULT_MAIN_SIZE]}>
              <Allotment.Pane
                snap
                minSize={MIN_SIDEBAR_WIDTH}
                maxSize={MAX_SIDEBAR_WIDTH}
                preferredSize={DEFAULT_SIDEBAR_WIDTH}
              >
                <FileExplorer projectId={projectId} />
              </Allotment.Pane>
              <Allotment.Pane>
                <EditorView projectId={projectId} />
              </Allotment.Pane>
            </Allotment>
          </div>
          <div
            className={cn(
              "absolute inset-0",
              activeView === "preview" ? "visible" : "invisible",
            )}
          >
            <div className="h-full bg-background flex flex-col">
              <div className="h-10 border-b px-3 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Preview file</span>
                <select
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-sm min-w-[280px]"
                  value={selectedPreviewPath ?? ""}
                  onChange={(event) => setSelectedPreviewPath(event.target.value)}
                  disabled={!selectedPreview || previewFiles.length === 0}
                >
                  {previewFiles.map((file) => (
                    <option key={file._id} value={file.path}>
                      {file.path}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-h-0">
                {projectFiles === undefined && (
                  <div className="size-full flex items-center justify-center text-sm text-muted-foreground">
                    Loading preview...
                  </div>
                )}
                {projectFiles !== undefined && previewFiles.length === 0 && (
                  <div className="size-full flex items-center justify-center text-sm text-muted-foreground">
                    No text files available to preview.
                  </div>
                )}
                {selectedPreview && isHtmlFile(selectedPreview.path) && (
                  <iframe
                    className="size-full bg-white"
                    srcDoc={selectedPreview.content}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                    title={`Preview ${selectedPreview.path}`}
                  />
                )}
                {selectedPreview && !isHtmlFile(selectedPreview.path) && (
                  <pre className="size-full overflow-auto p-4 text-xs font-mono whitespace-pre-wrap">
                    {selectedPreview.content}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
