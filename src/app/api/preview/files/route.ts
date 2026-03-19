import { NextRequest, NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "../../../../../convex/_generated/dataModel";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || "http://localhost:3001";

export const dynamic = "force-dynamic";

interface FileEntry {
  _id: string;
  name: string;
  parentId?: string;
  content?: string;
  type: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "Project ID required" }, { status: 400 });
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    const files = await client.query(api.files.getFiles, { projectId: projectId as Id<"projects"> });

    if (!files) {
      return NextResponse.json([]);
    }

    const fileData = (files as FileEntry[])
      .filter((file) => file.type === "file" && typeof file.content === "string")
      .map((file) => {
        let path = file.name;
        let currentId: string | undefined = file.parentId;

        while (currentId) {
          const parent = (files as FileEntry[]).find((f) => f._id === currentId);
          if (!parent) break;
          path = `${parent.name}/${path}`;
          currentId = parent.parentId;
        }

        return {
          path,
          content: file.content ?? "",
          type: file.type as "file" | "folder",
        };
      });

    return NextResponse.json(fileData);
  } catch (error) {
    console.error("Error fetching files for preview:", error);
    return NextResponse.json({ error: "Failed to fetch files" }, { status: 500 });
  }
}
