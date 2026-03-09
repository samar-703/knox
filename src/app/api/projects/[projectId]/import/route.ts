import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { parseGitHubRepoUrl } from "@/lib/github";

const requestSchema = z.object({
  repoUrl: z.string().trim().min(1).max(2_000),
  branch: z.string().trim().min(1).max(120).optional(),
});

const MAX_IMPORT_FILES = 250;
const MAX_FILE_BYTES = 200_000;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

interface GitHubRepoResponse {
  private: boolean;
  default_branch: string;
}

interface GitHubTreeResponse {
  truncated?: boolean;
  tree: Array<{
    path: string;
    type: "blob" | "tree";
  }>;
}

interface GitHubFileResponse {
  type: "file";
  encoding?: string;
  content?: string;
}

const githubHeaders = (token?: string) => {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "knox-import",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const encodePath = (path: string) => {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
};

const shouldSkipPath = (path: string) => {
  const segments = path.split("/");
  return segments.some((segment) => SKIPPED_DIRECTORIES.has(segment));
};

const safeErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Import failed";
};

const fetchGitHubJson = async <T>(url: string, token?: string) => {
  const response = await fetch(url, {
    headers: githubHeaders(token),
  });

  if (!response.ok) {
    let message = `GitHub request failed (${response.status})`;
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

  return (await response.json()) as T;
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

  const { projectId } = await params;
  const projectIdTyped = projectId as Id<"projects">;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const repoRef = parseGitHubRepoUrl(parsed.data.repoUrl);
  if (!repoRef) {
    return NextResponse.json(
      { error: "Provide a valid GitHub repository URL." },
      { status: 400 },
    );
  }

  const project = await convex.query(api.system.getProjectByIdForUser, {
    internalKey,
    userId,
    projectId: projectIdTyped,
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const githubToken =
    process.env.GITHUB_TOKEN ??
    process.env.GITHUB_ACCESS_TOKEN ??
    undefined;

  await convex.mutation(api.system.updateProjectImportStatusForUser, {
    internalKey,
    userId,
    projectId: projectIdTyped,
    status: "importing",
  });

  try {
    const repoInfo = await fetchGitHubJson<GitHubRepoResponse>(
      `https://api.github.com/repos/${repoRef.owner}/${repoRef.repo}`,
      githubToken,
    );

    if (repoInfo.private && !githubToken) {
      throw new Error(
        "Private repositories require GITHUB_TOKEN or GITHUB_ACCESS_TOKEN on the server.",
      );
    }

    const branch = parsed.data.branch || repoInfo.default_branch;
    const treeResponse = await fetchGitHubJson<GitHubTreeResponse>(
      `https://api.github.com/repos/${repoRef.owner}/${repoRef.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      githubToken,
    );

    if (!Array.isArray(treeResponse.tree)) {
      throw new Error("Failed to read repository tree");
    }
    if (treeResponse.truncated) {
      throw new Error("Repository is too large to import in one pass.");
    }

    await convex.mutation(api.system.clearProjectFilesForUser, {
      internalKey,
      userId,
      projectId: projectIdTyped,
    });

    const folderIdByPath = new Map<string, Id<"files">>();
    const folderPaths = treeResponse.tree
      .filter((entry) => entry.type === "tree")
      .map((entry) => entry.path)
      .filter((path) => !shouldSkipPath(path))
      .sort((a, b) => a.split("/").length - b.split("/").length);

    for (const folderPath of folderPaths) {
      const parentPath = folderPath.split("/").slice(0, -1).join("/");
      const folderName = folderPath.split("/").at(-1);
      if (!folderName) {
        continue;
      }
      if (parentPath && !folderIdByPath.has(parentPath)) {
        continue;
      }

      const folderId = await convex.mutation(api.system.createFolderForUser, {
        internalKey,
        userId,
        projectId: projectIdTyped,
        parentId: parentPath ? folderIdByPath.get(parentPath) : undefined,
        name: folderName,
      });

      folderIdByPath.set(folderPath, folderId);
    }

    const blobEntries = treeResponse.tree
      .filter((entry) => entry.type === "blob")
      .filter((entry) => !shouldSkipPath(entry.path));

    const filesToImport = blobEntries.slice(0, MAX_IMPORT_FILES);
    let skippedFiles = blobEntries.length - filesToImport.length;
    let importedFiles = 0;

    for (const fileEntry of filesToImport) {
      const parentPath = fileEntry.path.split("/").slice(0, -1).join("/");
      const fileName = fileEntry.path.split("/").at(-1);
      if (!fileName) {
        skippedFiles += 1;
        continue;
      }
      if (parentPath && !folderIdByPath.has(parentPath)) {
        skippedFiles += 1;
        continue;
      }

      const fileResponse = await fetchGitHubJson<GitHubFileResponse>(
        `https://api.github.com/repos/${repoRef.owner}/${repoRef.repo}/contents/${encodePath(fileEntry.path)}?ref=${encodeURIComponent(branch)}`,
        githubToken,
      );

      if (fileResponse.type !== "file" || fileResponse.encoding !== "base64" || !fileResponse.content) {
        skippedFiles += 1;
        continue;
      }

      const decoded = Buffer.from(fileResponse.content.replace(/\n/g, ""), "base64");
      if (decoded.length > MAX_FILE_BYTES || decoded.includes(0)) {
        skippedFiles += 1;
        continue;
      }

      const content = decoded.toString("utf8");
      if (content.includes("\u0000")) {
        skippedFiles += 1;
        continue;
      }

      await convex.mutation(api.system.createFileForUser, {
        internalKey,
        userId,
        projectId: projectIdTyped,
        parentId: parentPath ? folderIdByPath.get(parentPath) : undefined,
        name: fileName,
        content,
      });

      importedFiles += 1;
    }

    await convex.mutation(api.system.updateProjectImportStatusForUser, {
      internalKey,
      userId,
      projectId: projectIdTyped,
      status: "completed",
    });

    return NextResponse.json({
      success: true,
      importedFiles,
      skippedFiles,
      repo: `${repoRef.owner}/${repoRef.repo}`,
      branch,
    });
  } catch (error) {
    await convex.mutation(api.system.updateProjectImportStatusForUser, {
      internalKey,
      userId,
      projectId: projectIdTyped,
      status: "failed",
    });

    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}
