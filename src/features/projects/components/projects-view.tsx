"use client";

import { Poppins } from "next/font/google";
import Image from "next/image";
import { SparkleIcon } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import ky, { HTTPError } from "ky";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ProjectsList } from "./projects-list";
import { useCreateProject } from "../hooks/use-projects";
import { useEffect, useState } from "react";
import { ProjectsCommandDialog } from "./projects-command-dialog";
import { parseGitHubRepoUrl } from "@/lib/github";

const font = Poppins ({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

export const ProjectsView = () => {
  const createProject = useCreateProject();
  const router = useRouter();

  
  const [commandDialogOpen, setCommandDialogOpen] =  useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = async () => {
    const trimmedRepoUrl = repoUrl.trim();
    const repoRef = parseGitHubRepoUrl(trimmedRepoUrl);
    if (!repoRef) {
      toast.error("Enter a valid GitHub repository URL.");
      return;
    }

    setIsImporting(true);
    try {
      const projectId = await createProject({ name: repoRef.repo });

      const response = await ky
        .post(`/api/projects/${projectId}/import`, {
          json: {
            repoUrl: trimmedRepoUrl,
            branch: branch.trim() || undefined,
          },
          timeout: false,
        })
        .json<{ importedFiles: number; skippedFiles: number }>();

      toast.success(
        `Imported ${response.importedFiles} files${response.skippedFiles > 0 ? ` (${response.skippedFiles} skipped)` : ""}.`,
      );
      setImportDialogOpen(false);
      setRepoUrl("");
      setBranch("");
      router.push(`/projects/${projectId}`);
    } catch (error) {
      let message = "Failed to import repository.";

      if (error instanceof HTTPError) {
        const payload = (await error.response.json().catch(() => null)) as
          | { error?: string }
          | null;
        message = payload?.error ?? message;
      }

      toast.error(message);
    } finally {
      setIsImporting(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if(e.metaKey || e.ctrlKey) {
        if (e.key === "k"){
          e.preventDefault();
          setCommandDialogOpen(true)
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  },[]);

  return (
    <>
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from GitHub</DialogTitle>
            <DialogDescription>
              Paste a public GitHub repository URL to import files into a new project.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="repo-url">Repository URL</Label>
              <Input
                id="repo-url"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                disabled={isImporting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="repo-branch">Branch (optional)</Label>
              <Input
                id="repo-branch"
                placeholder="main"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                disabled={isImporting}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setImportDialogOpen(false)}
              disabled={isImporting}
            >
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={!repoUrl.trim() || isImporting}>
              {isImporting ? "Importing..." : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProjectsCommandDialog
        open={commandDialogOpen}
        onOpenChange={setCommandDialogOpen}
      />
      <div className="min-h-screen bg-sidebar flex flex-col items-center justify-center p-6 md:p-16">
        <div className="w-full max-w-sm mx-auto flex flex-col gap-4 items-center">

          <div className="flex justify-between gap-4 w-full items-center">

            <div className="flex items-center gap-2 w-full group/logo">
              <Image
                src="/logo.svg"
                alt="knox"
                width={46}
                height={46}
                className="size-[32px] md:size-[46px]"
              />
              <h1 className={cn(
                "text-4xl md:text-5xl font-semibold",
                font.className,
              )}>
                knox
              </h1>
            </div>
          </div>

          <div className="flex flex-col gap-4 w-full">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  const projectName = uniqueNamesGenerator({
                    dictionaries: [adjectives, colors, animals],
                    separator: "-",
                    length: 3,
                  })


                  createProject({
                    name: projectName,
                  })
                }}
                className="h-full items-start justify-start p-4 bg-background border flex flex-col gap-6 rounded-none"
              >
                <div className="flex items-center justify-between w-full">
                  <SparkleIcon className="size-4" />
                  <Kbd className="bg-accent border">
                    ⌘J
                  </Kbd>
                </div>
                <div>
                  <span className="text-sm">
                    New
                  </span>
                </div>
              </Button>
              <Button
                variant="outline"
                onClick={() => setImportDialogOpen(true)}
                className="h-full items-start justify-start p-4 bg-background border flex flex-col gap-6 rounded-none"
              >
                <div className="flex items-center justify-between w-full">
                  <FaGithub className="size-4" />
                  <Kbd className="bg-accent border">
                    ⌘I
                  </Kbd>
                </div>
                <div>
                  <span className="text-sm">
                    Import
                  </span>
                </div>
              </Button>
            </div>
            
            <ProjectsList onViewAll={() => setCommandDialogOpen(true)} />

          </div>

        </div>
      </div>
    </>
  )
}
