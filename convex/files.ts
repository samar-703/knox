import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";
import { Doc, Id } from "./_generated/dataModel";

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

export const getFiles = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);

    const project = await ctx.db.get("projects", args.projectId);
    
    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to project");
    }

     return await ctx.db
    .query("files")
    .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
    .collect();
  },
});

export const getFile = query({
  args: { id: v.id("files") },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const file = await ctx.db.get("files", args.id);

    if (!file) {
      throw new Error("File not found");
    }
    const project = await ctx.db.get("projects", file.projectId);
    
    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to project");
    }

     return file;
  },
});

export const getFilePath = query({
  args: { id: v.id("files") },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);

    const file =  await ctx.db.get("files", args.id);

    if (!file) { throw new Error("File not found"); }

    const project = await ctx.db.get("projects", file.projectId);
    
    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to project");
    }

    const path : { _id: string; name: string }[] = [];
    let currentId: Id<"files"> | undefined = args.id;

    while (currentId) {
      const file = (await ctx.db.get("files", currentId)) as
        | Doc<"files">
        | undefined;
      if (!file) break;

      path.unshift({ _id: file._id, name: file.name });
      currentId = file.parentId;
     }
    
    return path;
  },
});



export const getFolderContents = query({
  args: { 
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);

    const project = await ctx.db.get("projects", args.projectId);
    
    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to project");
    }

    const files = await ctx.db
    .query("files")
    .withIndex("by_project_parent", (q) => 
      q
        .eq("projectId", args.projectId)
        .eq("parentId", args.parentId)
    )
    .collect();

    //* Sort folder first, then files, alphabetically within each group
    return files.sort((a,b) => {
      if (a.type === "folder" && b.type ==="file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;

      //? within same type, sort alphabetically by name
      return a.name.localeCompare(b.name);
    });
  },
});

export const createFile = mutation({
  args: { 
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);

    const project = await ctx.db.get("projects", args.projectId);
    
    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to project");
    }

    const fileName = sanitizeEntryName(args.name);

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.projectId !== args.projectId || parent.type !== "folder") {
        throw new Error("Invalid parent folder");
      }
    }

    const files = await ctx.db
    .query("files")
    .withIndex("by_project_parent", (q) => 
      q
        .eq("projectId", args.projectId)
        .eq("parentId", args.parentId)
    )
    .collect();

    const existing = files.find((file) => file.name === fileName);
    if (existing) throw new Error("A file or folder with this name already exists");

    const now = Date.now();

    await ctx.db.insert("files", {
      projectId: args.projectId,
      name: fileName,
      content: args.content,
      type: "file",
      parentId: args.parentId,
      updatedAt: now,
    });

     await ctx.db.patch("projects", args.projectId, {
      updatedAt: now,
    });
  },
});

export const createFolder = mutation({
  args: { 
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);

    const project = await ctx.db.get("projects", args.projectId);
    
    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to project");
    }

    const folderName = sanitizeEntryName(args.name);

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.projectId !== args.projectId || parent.type !== "folder") {
        throw new Error("Invalid parent folder");
      }
    }

    //* Check if folder with same name already exists in parent folder
    const files = await ctx.db
    .query("files")
    .withIndex("by_project_parent", (q) => 
      q
        .eq("projectId", args.projectId)
        .eq("parentId", args.parentId)
    )
    .collect();

    const existing = files.find((file) => file.name === folderName);
    if (existing) throw new Error("A file or folder with this name already exists");

    const now = Date.now();

    await ctx.db.insert("files", {
      projectId: args.projectId,
      name: folderName,
      type: "folder",
      parentId: args.parentId,
      updatedAt: now,
    });

    await ctx.db.patch("projects", args.projectId, {
      updatedAt: now,
    });
  },
});

 export const renameFile = mutation({
  args: {
    id: v.id("files"),
    newName: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);

    const file = await ctx.db.get("files", args.id);

    if (!file) throw new Error("File not found");

    const project =  await ctx.db.get("projects", file.projectId);

    if(!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to project");
    }

    const newName = sanitizeEntryName(args.newName);

    // check if a file with a new name already exists in the same parent folder

    const siblings = await ctx.db 
      .query("files")
      .withIndex("by_project_parent", (q) => 
        q
          .eq("projectId", file.projectId)
          .eq("parentId", file.parentId)
      )
      .collect();

    const existing = siblings.find(
      (sibling) =>
        sibling.name === newName &&
        sibling._id !== file._id
    );

    if (existing) {
      throw new Error(
        `A ${file.type} with this name already exists in this folder.`
      );
    }

    const now = Date.now();

    // update the file name
    await ctx.db.patch("files", args.id, {
      name: newName,
      updatedAt: now,
    });

    await ctx.db.patch("projects", file.projectId, {
      updatedAt: now,
    });
  }
});

export const deleteFile = mutation({
  args: {
    id: v.id("files"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);

    const file = await ctx.db.get("files", args.id);

    if (!file) throw new Error("File not found");

    const project =  await ctx.db.get("projects", file.projectId);

    if(!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to project");
    }

    //! Recursively delete file/folder and all descendants
    const deleteRecursive = async (fileId: Id<"files">) => {
      const item = await ctx.db.get("files", fileId);

      if (!item){
        return;
      }
      
      //* If its a folder, delete all children first
      if (item.type === "folder") {
        const children = await ctx.db
         .query("files")
         .withIndex("by_project_parent", (q) =>
           q
              .eq("projectId", item.projectId)
              .eq("parentId", fileId)
         )
          .collect();

          for (const child of children) {
            await deleteRecursive(child._id);
          }
      }

      // delete storage file if it exists
      if (item.storageId) {
        await ctx.storage.delete(item.storageId);
      }

      // delete the file/folder itself
      await ctx.db.delete("files", fileId);
    }; 

    await deleteRecursive(args.id);

     await ctx.db.patch("projects", file.projectId, {
      updatedAt: Date.now(),
    });
  }
});


export const updateFile = mutation({
  args: {
    id: v.id("files"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
     const identity = await verifyAuth(ctx);

    const file = await ctx.db.get("files", args.id);

    if (!file) throw new Error("File not found");

    const project =  await ctx.db.get("projects", file.projectId);

    if(!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to project");
    }

    const now = Date.now();

    await ctx.db.patch("files", args.id, {
      content: args.content,
      updatedAt: now,
    });

     await ctx.db.patch("projects", file.projectId, {
      updatedAt: now,
    });
  },
});

