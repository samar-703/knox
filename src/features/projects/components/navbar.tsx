"use client";

import Link from "next/link";
import Image from "next/image";
import React, { useState } from "react";
import { CloudCheckIcon, LoaderIcon, PlugZapIcon } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { formatDistanceToNow } from "date-fns";
import { Poppins } from "next/font/google";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCompanion } from "@/features/companion/provider/companion-provider";
import { ProjectCompanionDialog } from "@/features/companion/components/project-companion-dialog";


import { Id } from "..//..//..//..//convex/_generated/dataModel";
import { useProject, useRenameProject } from "../hooks/use-projects";



const font = Poppins ({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})


export const Navbar = ({
  projectId,
}: {
  projectId: Id<"projects">;
}) => {
  const project = useProject(projectId);
  const renameProject = useRenameProject();
  const { connectionState } = useCompanion();

  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState("");
  const [companionOpen, setCompanionOpen] = useState(false);

  const handleStartRename = () => {
    if (!project) return;
    setName(project.name);
    setIsRenaming(true);
  };

  const handleSubmit = () => {
    if (!project) return;
    setIsRenaming(false);

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === project.name) return;

    renameProject({ id: projectId, name: trimmedName, });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      setIsRenaming(false);
    }
  }


  return (
    <>
      <ProjectCompanionDialog
        open={companionOpen}
        onOpenChange={setCompanionOpen}
        projectId={projectId}
      />

      <nav className="flex justify-between items-center gap-x-2 p-2 bg-sidebar border-b">
        <div className="flex items-center gap-x-2 ">
        <Breadcrumb>
          <BreadcrumbList className="gap-0!">
            <BreadcrumbItem>
              <BreadcrumbLink className="flex items-center gap-1.5" asChild>
                <Button
                  variant="ghost"
                  className="w-fit! p-1.5! h-7!"
                  asChild
                >
                  <Link href="/">
                    <Image 
                      src="/logo.svg"
                      alt="Logo"
                      width={20}
                      height={20}
                    />
                    <span
                      className={cn(
                        "text-sm font-medium",
                        font.className,
                      )}
                    >
                      knox
                    </span>
                  </Link>
                </Button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="ml-0! mr-1" />
            <BreadcrumbItem>
              {isRenaming ? (
                  <input 
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={handleSubmit}
                    onKeyDown={handleKeyDown}
                    className="text-sm bg-transparent text-foreground outline-none focus:ring-1 focus:ring-inset focus:ring-ring font-medium max-w-40 truncate"
                  />
                ) : (

                <BreadcrumbPage
                  onClick={handleStartRename}
                  className="text-sm cursor-pointer hover:text-primary font-medium max-w-40 truncate"
                >
                  {project?.name ?? "Loading..."}
                </BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {project?.importStatus === "importing" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <LoaderIcon className="size-4 text-muted-foreground animate-spin" />
            </TooltipTrigger>
            <TooltipContent>Importing...</TooltipContent>
          </Tooltip>
        ) : (
          project?.updatedAt &&(
            <Tooltip>
            <TooltipTrigger asChild>
              <CloudCheckIcon className="size-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              Saved {" "}
              {formatDistanceToNow(
                project.updatedAt,
                { addSuffix: true, }
              )}
            </TooltipContent>
          </Tooltip>
          )
        )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCompanionOpen(true)}
          >
            <PlugZapIcon className="size-4" />
            {connectionState === "connected" ? "Companion" : "Connect"}
          </Button>
          <UserButton />
        </div>
      </nav>
    </>
  )
};
