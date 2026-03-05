import { inngest } from "@/inngest/client";
import { Id } from "../../../../convex/_generated/dataModel";
import { NonRetriableError } from "inngest";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";

interface MessageEvent {
  messageId: Id<"messages">;
  conversationId: Id<"conversations">;
  userId: string;
}

const MAX_CONTEXT_MESSAGES = 16;

const SYSTEM_PROMPT = `You are Knox, an AI coding assistant.

Behave like a pragmatic software engineer:
- Give accurate, concise answers.
- Prefer actionable code and clear next steps.
- If the user asks for edits, provide implementation-oriented guidance.
- Never fabricate file contents or results.
`;

export const processMessage = inngest.createFunction(
  {
    id: "process-message",
    cancelOn: [{
      event: "message/cancel",
      if: "event.data.messageId == async.data.messageId",
    }],
    onFailure: async ({ event, step}) => {
      const eventData = event.data.event.data as Partial<MessageEvent>;
      const messageId = eventData.messageId as Id<"messages"> | undefined;
      const internalKey = process.env.CONVEX_INTERNAL_KEY;

      if (!messageId || !internalKey) {
        return;
      }

      const userId = eventData.userId;
      if (!userId) {
        return;
      }

      const message = await step.run("get-message-for-failure", async () => {
        return await convex.query(api.system.getMessageByIdForUser, {
          internalKey,
          userId,
          messageId,
        });
      });

      if (message && message.status !== "cancelled"){
        await step.run("update-assistant-message", async () => {
          await convex.mutation(api.system.updateMessageContent, {
            internalKey,
            messageId,
            content: "My apologies, but I encountered an error while processing your message.",
          })
        })
      }
    },
  },
  {
    event: "message/sent",
  },
  async ({ event, step }) => {
    const { messageId, conversationId, userId } = event.data as MessageEvent;

    const internalKey = process.env.CONVEX_INTERNAL_KEY;
    
    if (!internalKey) {
      throw new NonRetriableError("Internal key not configured");
    }

    const messages = await step.run("load-conversation-messages", async () => {
      return await convex.query(api.system.getMessagesByConversationForUser, {
        internalKey,
        userId,
        conversationId,
      });
    });

    if (!messages || messages.length === 0) {
      throw new NonRetriableError("Conversation has no messages");
    }

    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user" && Boolean(message.content.trim()));

    if (!latestUserMessage) {
      throw new NonRetriableError("No user message found for processing");
    }

    const contextMessages = messages
      .filter((message) => message.status !== "cancelled")
      .filter((message) => !(message._id === messageId && message.role === "assistant"))
      .slice(-MAX_CONTEXT_MESSAGES)
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`);

    const prompt = `${SYSTEM_PROMPT}\n\nConversation context:\n${contextMessages.join("\n\n")}\n\nReply to the latest user request.`;

    const { text } = await step.run("generate-assistant-reply", async () => {
      return await generateText({
        model: google("gemini-2.0-flash"),
        prompt,
        maxOutputTokens: 1_200,
      });
    });

    const safeText = text.trim() || "I could not generate a response for that request.";

    await step.run("update-assistant-message", async () => {
      await convex.mutation(api.system.updateMessageContent, {
        internalKey,
        messageId,
        content: safeText,
      })
    });
  }
)
