import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { sanitizeGitHubRepoName } from "@/lib/github";

const requestSchema = z.object({
  repoName: z.string().trim().min(1).max(100),
  isPrivate: z.boolean().optional().default(true),
});

const MAX_EXPORT_FILES = 250;
const MAX_EXPORT_FILE_BYTES = 900_000;

interface GitHubCreateRepoResponse {
  full_name: string;
  html_url: string;
  default_branch: string;
}

interface GitHubContentResponse {
  content?: {
    sha: string;
  };
}

const githubHeaders = (token: string) => {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "knox-export",
    Authorization: `Bearer ${token}`,
  };
};

const encodePath = (path: string) => {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
};

const safeErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Export failed";
};

const createGitHubRepository = async ({
  token,
  repoName,
  isPrivate,
}: {
  token: string;
  repoName: string;
  isPrivate: boolean;
}) => {
  const response = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      name: repoName,
      private: isPrivate,
      auto_init: false,
    }),
  });

  if (!response.ok) {
    let message = `Failed to create GitHub repository (${response.status})`;
    try {
      const json = await response.json();
      if (json && typeof json.message === "string") {
        message = json.message;
      }
    } catch {
      // no-op
    }
    throw new Error(message);
  }

  return (await response.json()) as GitHubCreateRepoResponse;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const internalKey = process.env.CONVEX_INTERNAL_KEY;
  if (!internalKey) {
    return NextResponse.json(
      { error: "Internal key not configured" },
      { status: 500 },
    );
  }

  const githubToken = process.env.GITHUB_TOKEN ?? process.env.GITHUB_ACCESS_TOKEN;
  if (!githubToken) {
    return NextResponse.json(
      {
        error:
          "GitHub export requires GITHUB_TOKEN or GITHUB_ACCESS_TOKEN on the server.",
      },
      { status: 500 },
    );
  }

  const { projectId } = await params;
  const projectIdTyped = projectId as Id<"projects">;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const project = await convex.query(api.system.getProjectByIdForUser, {
    internalKey,
    userId,
    projectId: projectIdTyped,
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  await convex.mutation(api.system.updateProjectExportStatusForUser, {
    internalKey,
    userId,
    projectId: projectIdTyped,
    status: "exporting",
  });

  try {
    const repoName = sanitizeGitHubRepoName(parsed.data.repoName);
    const repo = await createGitHubRepository({
      token: githubToken,
      repoName,
      isPrivate: parsed.data.isPrivate,
    });

    const entries = await convex.query(api.system.getProjectEntriesForUser, {
      internalKey,
      userId,
      projectId: projectIdTyped,
    });

    const fileEntries = entries
      .filter((entry) => entry.type === "file" && typeof entry.content === "string")
      .sort((a, b) => a.path.localeCompare(b.path));

    const filesToExport = fileEntries.slice(0, MAX_EXPORT_FILES);
    let exportedFiles = 0;
    let skippedFiles = fileEntries.length - filesToExport.length;

    for (const file of filesToExport) {
      const source = file.content ?? "";
      const bytes = Buffer.byteLength(source, "utf8");
      if (bytes === 0 || bytes > MAX_EXPORT_FILE_BYTES || source.includes("\u0000")) {
        skippedFiles += 1;
        continue;
      }

      const content = Buffer.from(source, "utf8").toString("base64");
      const response = await fetch(
        `https://api.github.com/repos/${repo.full_name}/contents/${encodePath(file.path)}`,
        {
          method: "PUT",
          headers: githubHeaders(githubToken),
          body: JSON.stringify({
            message: `Add ${file.path}`,
            content,
            branch: repo.default_branch,
          }),
        },
      );

      if (!response.ok) {
        let message = `Failed to export ${file.path} (${response.status})`;
        try {
          const json = await response.json();
          if (json && typeof json.message === "string") {
            message = json.message;
          }
        } catch {
          // no-op
        }
        throw new Error(message);
      }

      await response.json().catch(() => null as GitHubContentResponse | null);
      exportedFiles += 1;
    }

    await convex.mutation(api.system.updateProjectExportStatusForUser, {
      internalKey,
      userId,
      projectId: projectIdTyped,
      status: "completed",
      exportRepoUrl: repo.html_url,
    });

    return NextResponse.json({
      success: true,
      repoUrl: repo.html_url,
      exportedFiles,
      skippedFiles,
    });
  } catch (error) {
    await convex.mutation(api.system.updateProjectExportStatusForUser, {
      internalKey,
      userId,
      projectId: projectIdTyped,
      status: "failed",
      exportRepoUrl: undefined,
    });

    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}
