import { v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

const validateInternalKey = (key: string) => {
  const internalKey = process.env.CONVEX_INTERNAL_KEY;

  if (!internalKey) {
    throw new Error("CONVEX_INTERNAL_KEY is not configured");
  }

  if (key !== internalKey){
    throw new Error("Invalid internal key");
  }
}

type InternalCtx = QueryCtx | MutationCtx;
const MAX_ENTRY_NAME_LENGTH = 255;

const sanitizeEntryName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name is required");
  }
  if (trimmed.length > MAX_ENTRY_NAME_LENGTH) {
    throw new Error("Name is too long");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("Invalid name");
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new Error("Invalid name");
  }
  return trimmed;
};

const getProjectForConversation = async (
  ctx: InternalCtx,
  conversationId: Id<"conversations">,
) => {
  const conversation = await ctx.db.get("conversations", conversationId);
  if (!conversation) {
    return null;
  }

  const project = await ctx.db.get("projects", conversation.projectId);
  if (!project) {
    return null;
  }

  return { conversation, project };
};

const getProjectForUser = async (
  ctx: InternalCtx,
  projectId: Id<"projects">,
  userId: string,
) => {
  const project = await ctx.db.get("projects", projectId);
  if (!project || project.ownerId !== userId) {
    return null;
  }
  return project;
};

const getFileForUser = async (
  ctx: InternalCtx,
  fileId: Id<"files">,
  userId: string,
) => {
  const file = await ctx.db.get("files", fileId);
  if (!file) {
    return null;
  }

  const project = await getProjectForUser(ctx, file.projectId, userId);
  if (!project) {
    return null;
  }

  return { file, project };
};

export const getConversationById = query({
  args: {
    conversationId: v.id("conversations"),
    internalKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey); 
    return await ctx.db.get("conversations", args.conversationId);
  },
});

export const getConversationByIdForUser = query({
  args: {
    conversationId: v.id("conversations"),
    userId: v.string(),
    internalKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const conversationData = await getProjectForConversation(
      ctx,
      args.conversationId,
    );
    if (!conversationData || conversationData.project.ownerId !== args.userId) {
      return null;
    }

    return conversationData.conversation;
  },
});

export const getMessagesByConversationForUser = query({
  args: {
    conversationId: v.id("conversations"),
    userId: v.string(),
    internalKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const conversationData = await getProjectForConversation(
      ctx,
      args.conversationId,
    );
    if (!conversationData || conversationData.project.ownerId !== args.userId) {
      return [];
    }

    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .collect();
  },
});

export const getMessageByIdForUser = query({
  args: {
    messageId: v.id("messages"),
    userId: v.string(),
    internalKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const message = await ctx.db.get("messages", args.messageId);
    if (!message) {
      return null;
    }

    const conversationData = await getProjectForConversation(
      ctx,
      message.conversationId,
    );
    if (!conversationData || conversationData.project.ownerId !== args.userId) {
      return null;
    }

    return message;
  },
});

export const hasProcessingMessageForUser = query({
  args: {
    conversationId: v.id("conversations"),
    userId: v.string(),
    internalKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const conversationData = await getProjectForConversation(
      ctx,
      args.conversationId,
    );
    if (!conversationData || conversationData.project.ownerId !== args.userId) {
      return false;
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .collect();

    return messages.some((message) => message.status === "processing");
  },
});

export const getProjectFilesForUser = query({
  args: {
    projectId: v.id("projects"),
    userId: v.string(),
    internalKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const project = await ctx.db.get("projects", args.projectId);
    if (!project || project.ownerId !== args.userId) {
      return [];
    }

    const files = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const fileMap = new Map(files.map((file) => [file._id, file]));

    const buildPath = (fileId: Id<"files">) => {
      const pathSegments: string[] = [];
      let current = fileMap.get(fileId);

      while (current) {
        pathSegments.unshift(current.name);
        current = current.parentId ? fileMap.get(current.parentId) : undefined;
      }

      return pathSegments.join("/");
    };

    const textFiles = files
      .filter((file) => file.type === "file" && typeof file.content === "string")
      .map((file) => ({
        _id: file._id,
        name: file.name,
        path: buildPath(file._id),
        content: file.content ?? "",
        updatedAt: file.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const limit = args.limit ? Math.max(1, Math.min(args.limit, 300)) : 200;
    return textFiles.slice(0, limit);
  },
});

export const getProjectEntriesForUser = query({
  args: {
    projectId: v.id("projects"),
    userId: v.string(),
    internalKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const project = await getProjectForUser(ctx, args.projectId, args.userId);
    if (!project) {
      return [];
    }

    const entries = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const entryMap = new Map(entries.map((entry) => [entry._id, entry]));

    const buildPath = (fileId: Id<"files">) => {
      const pathSegments: string[] = [];
      let current = entryMap.get(fileId);

      while (current) {
        pathSegments.unshift(current.name);
        current = current.parentId ? entryMap.get(current.parentId) : undefined;
      }

      return pathSegments.join("/");
    };

    return entries.map((entry) => ({
      _id: entry._id,
      name: entry.name,
      type: entry.type,
      parentId: entry.parentId,
      projectId: entry.projectId,
      content: entry.content,
      path: buildPath(entry._id),
      updatedAt: entry.updatedAt,
    }));
  },
});

export const getProjectByIdForUser = query({
  args: {
    internalKey: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return await getProjectForUser(ctx, args.projectId, args.userId);
  },
});

export const createMessage = mutation({
  args: {
    internalKey: v.string(),
    conversationId: v.id("conversations"),
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("completed"),
        v.literal("cancelled")
      )
    ),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      projectId: args.projectId,
      role: args.role,
      content: args.content,
      status: args.status,
    }); 

    // update conversation's updatedAt
    await ctx.db.patch("conversations", args.conversationId, {
      updatedAt: Date.now(),
    });

    return messageId;
  },
});

export const updateMessageContent = mutation({
  args: {
    internalKey: v.string(),
    messageId: v.id("messages"),
    content: v.string(),
  },
  handler: async ( ctx, args ) => {
    validateInternalKey(args.internalKey);

    await ctx.db.patch("messages", args.messageId, {
      content: args.content,
      status: "completed" as const,
    });
  },
});

export const updateMessageStatus = mutation({
  args: {
    internalKey: v.string(),
    messageId: v.id("messages"),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    await ctx.db.patch("messages", args.messageId, {
      status: args.status,
    });
  },
});

export const updateFileContentForUser = mutation({
  args: {
    internalKey: v.string(),
    userId: v.string(),
    fileId: v.id("files"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const fileData = await getFileForUser(ctx, args.fileId, args.userId);
    if (!fileData) {
      throw new Error("File not found");
    }
    if (fileData.file.type !== "file") {
      throw new Error("Can only update files");
    }

    const now = Date.now();
    await ctx.db.patch("files", args.fileId, {
      content: args.content,
      updatedAt: now,
    });
    await ctx.db.patch("projects", fileData.file.projectId, {
      updatedAt: now,
    });
  },
});

export const updateProjectImportStatusForUser = mutation({
  args: {
    internalKey: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
    status: v.optional(
      v.union(
        v.literal("importing"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const project = await getProjectForUser(ctx, args.projectId, args.userId);
    if (!project) {
      throw new Error("Project not found");
    }

    await ctx.db.patch("projects", args.projectId, {
      importStatus: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const updateProjectExportStatusForUser = mutation({
  args: {
    internalKey: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
    status: v.optional(
      v.union(
        v.literal("exporting"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
    exportRepoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const project = await getProjectForUser(ctx, args.projectId, args.userId);
    if (!project) {
      throw new Error("Project not found");
    }

    await ctx.db.patch("projects", args.projectId, {
      exportStatus: args.status,
      exportRepoUrl: args.exportRepoUrl,
      updatedAt: Date.now(),
    });
  },
});

export const createFileForUser = mutation({
  args: {
    internalKey: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const project = await getProjectForUser(ctx, args.projectId, args.userId);
    if (!project) {
      throw new Error("Project not found");
    }
    const fileName = sanitizeEntryName(args.name);

    if (args.parentId) {
      const parentData = await getFileForUser(ctx, args.parentId, args.userId);
      if (!parentData || parentData.file.type !== "folder") {
        throw new Error("Parent folder not found");
      }
      if (parentData.file.projectId !== args.projectId) {
        throw new Error("Parent folder is not in this project");
      }
    }

    const siblings = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q.eq("projectId", args.projectId).eq("parentId", args.parentId),
      )
      .collect();

    const exists = siblings.some((entry) => entry.name === fileName);
    if (exists) {
      throw new Error("A file or folder with this name already exists");
    }

    const now = Date.now();
    const fileId = await ctx.db.insert("files", {
      projectId: args.projectId,
      parentId: args.parentId,
      name: fileName,
      type: "file",
      content: args.content,
      updatedAt: now,
    });

    await ctx.db.patch("projects", args.projectId, {
      updatedAt: now,
    });

    return fileId;
  },
});

export const createFolderForUser = mutation({
  args: {
    internalKey: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const project = await getProjectForUser(ctx, args.projectId, args.userId);
    if (!project) {
      throw new Error("Project not found");
    }

    const folderName = sanitizeEntryName(args.name);

    if (args.parentId) {
      const parentData = await getFileForUser(ctx, args.parentId, args.userId);
      if (!parentData || parentData.file.type !== "folder") {
        throw new Error("Parent folder not found");
      }
      if (parentData.file.projectId !== args.projectId) {
        throw new Error("Parent folder is not in this project");
      }
    }

    const siblings = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q.eq("projectId", args.projectId).eq("parentId", args.parentId),
      )
      .collect();

    const exists = siblings.some((entry) => entry.name === folderName);
    if (exists) {
      throw new Error("A file or folder with this name already exists");
    }

    const now = Date.now();
    const folderId = await ctx.db.insert("files", {
      projectId: args.projectId,
      parentId: args.parentId,
      name: folderName,
      type: "folder",
      updatedAt: now,
    });

    await ctx.db.patch("projects", args.projectId, {
      updatedAt: now,
    });

    return folderId;
  },
});

export const clearProjectFilesForUser = mutation({
  args: {
    internalKey: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const project = await getProjectForUser(ctx, args.projectId, args.userId);
    if (!project) {
      throw new Error("Project not found");
    }

    const entries = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    for (const entry of entries) {
      if (entry.storageId) {
        await ctx.storage.delete(entry.storageId);
      }
    }

    for (const entry of entries) {
      await ctx.db.delete("files", entry._id);
    }

    await ctx.db.patch("projects", args.projectId, {
      updatedAt: Date.now(),
    });

    return entries.length;
  },
});

export const deleteFileForUser = mutation({
  args: {
    internalKey: v.string(),
    userId: v.string(),
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const fileData = await getFileForUser(ctx, args.fileId, args.userId);
    if (!fileData) {
      throw new Error("File not found");
    }

    const deleteRecursive = async (entryId: Id<"files">) => {
      const entry = await ctx.db.get("files", entryId);
      if (!entry) {
        return;
      }

      if (entry.type === "folder") {
        const children = await ctx.db
          .query("files")
          .withIndex("by_project_parent", (q) =>
            q.eq("projectId", entry.projectId).eq("parentId", entryId),
          )
          .collect();

        for (const child of children) {
          await deleteRecursive(child._id);
        }
      }

      if (entry.storageId) {
        await ctx.storage.delete(entry.storageId);
      }

      await ctx.db.delete("files", entryId);
    };

    await deleteRecursive(args.fileId);

    await ctx.db.patch("projects", fileData.file.projectId, {
      updatedAt: Date.now(),
    });
  },
});
