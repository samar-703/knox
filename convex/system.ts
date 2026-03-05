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
