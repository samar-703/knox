import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { inngest } from "@/inngest/client";
import { createRateLimiter } from "@/lib/rate-limit";
import { aiSettingsSchema } from "@/lib/ai-settings";
import {
  encryptAiSettings,
  getVisionRequestConfig,
  resolveAiSettings,
} from "@/lib/ai-provider.server";

const MAX_IMAGE_ATTACHMENTS = 3;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_ATTACHMENT_CONTEXT_CHARS = 3_000;

const attachmentSchema = z.object({
  type: z.literal("file"),
  filename: z.string().max(255).optional(),
  mediaType: z.string().max(120).optional(),
  url: z.string().max(2_000_000).optional(),
});

const requestSchema = z.object({
  conversationId: z.string(),
  message: z.string().max(8_000).optional().default(""),
  attachments: z
    .array(attachmentSchema)
    .max(MAX_IMAGE_ATTACHMENTS)
    .optional()
    .default([]),
  providerConfig: aiSettingsSchema.optional(),
});

const isRateLimited = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
});

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isRateLimited(userId)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }

  const internalKey = process.env.CONVEX_INTERNAL_KEY;

  if (!internalKey) {
    return NextResponse.json(
      { error: "Internal key not configured" },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const { conversationId, message, attachments, providerConfig } = parsed.data;
  const trimmedMessage = message.trim();
  if (!trimmedMessage && attachments.length === 0) {
    return NextResponse.json(
      { error: "Message or image attachment is required." },
      { status: 400 },
    );
  }

  if (!trimmedMessage && !hasSupportedImageAttachment(attachments)) {
    return NextResponse.json(
      {
        error:
          "At least one supported image attachment is required when message is empty.",
      },
      { status: 400 },
    );
  }

  const aiSettings = resolveAiSettings(providerConfig);
  const encryptedAiSettings =
    aiSettings !== null ? encryptAiSettings(aiSettings, internalKey) : null;
  const conversationIdTyped = conversationId as Id<"conversations">;

  const conversation = await convex.query(api.system.getConversationByIdForUser, {
    internalKey,
    userId,
    conversationId: conversationIdTyped,
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const projectId = conversation.projectId;

  const hasProcessingMessage = await convex.query(
    api.system.hasProcessingMessageForUser,
    {
      internalKey,
      userId,
      conversationId: conversationIdTyped,
    },
  );
  if (hasProcessingMessage) {
    return NextResponse.json(
      { error: "A message is already being processed for this conversation." },
      { status: 409 },
    );
  }

  const userMessageContent = await buildUserMessageContent({
    message: trimmedMessage,
    attachments,
    aiSettings,
  });

  await convex.mutation(api.system.createMessage, {
    internalKey,
    conversationId: conversationIdTyped,
    projectId,
    role: "user",
    content: userMessageContent,
  });

  const assistantMessageId = await convex.mutation(api.system.createMessage, {
    internalKey,
    conversationId: conversationIdTyped,
    projectId,
    role: "assistant",
    content: "",
    status: "processing",
  });

  const event = await inngest.send({
    name: "message/sent",
    data: {
      messageId: assistantMessageId,
      conversationId: conversationIdTyped,
      userId,
      encryptedAiSettings,
    },
  });

  return NextResponse.json({
    success: true,
    eventId: event.ids[0],
    messageId: assistantMessageId,
  });
}

const parseImageDataUrl = (value: string) => {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) {
    return null;
  }

  const mimeType = match[1];
  const base64Data = match[2].replace(/\s+/g, "");

  try {
    const buffer = Buffer.from(base64Data, "base64");
    if (
      buffer.length === 0 ||
      buffer.length > MAX_IMAGE_BYTES ||
      buffer.includes(0)
    ) {
      return null;
    }

    return { mimeType, base64Data };
  } catch {
    return null;
  }
};

const hasSupportedImageAttachment = (
  attachments: Array<{
    mediaType?: string;
    url?: string;
  }>,
) =>
  attachments.some(
    (attachment) =>
      attachment.mediaType?.startsWith("image/") &&
      typeof attachment.url === "string" &&
      attachment.url.startsWith("data:image/") &&
      Boolean(parseImageDataUrl(attachment.url)),
  );

const describeImageForCoding = async ({
  dataUrl,
  userMessage,
  aiSettings,
}: {
  dataUrl: string;
  userMessage: string;
  aiSettings: NonNullable<ReturnType<typeof resolveAiSettings>>;
}) => {
  const visionConfig = getVisionRequestConfig(aiSettings);
  const promptText =
    "Describe this image for a coding assistant. Focus on code snippets, error text, stack traces, UI bugs, or terminal output. Return concise plain text in <= 120 words.\n\n" +
    (userMessage ? `User request: ${userMessage}` : "No additional user text.");

  if (visionConfig.mode === "google") {
    const parsed = parseImageDataUrl(dataUrl);
    if (!parsed) {
      return "Image attached, but format/size is unsupported.";
    }

    const response = await fetch(
      `${visionConfig.baseURL}/models/${encodeURIComponent(visionConfig.model)}:generateContent?key=${encodeURIComponent(visionConfig.apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: promptText,
                },
                {
                  inline_data: {
                    mime_type: parsed.mimeType,
                    data: parsed.base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 300,
          },
        }),
      },
    );

    if (!response.ok) {
      return `Image provided, but vision analysis failed (${response.status}).`;
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                text?: string;
              }>;
            };
          }>;
        }
      | null;

    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim();

    if (!text) {
      return "Image provided, but no useful details were extracted.";
    }

    return text;
  }

  const response = await fetch(`${visionConfig.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${visionConfig.apiKey}`,
      ...(visionConfig.headers ?? {}),
    },
    body: JSON.stringify({
      model: visionConfig.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl,
              },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    return `Image provided, but vision analysis failed (${response.status}).`;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      }
    | null;

  const text = payload?.choices?.[0]?.message?.content?.trim();

  if (!text) {
    return "Image provided, but no useful details were extracted.";
  }

  return text;
};

const buildUserMessageContent = async ({
  message,
  attachments,
  aiSettings,
}: {
  message: string;
  attachments: Array<{
    filename?: string;
    mediaType?: string;
    url?: string;
  }>;
  aiSettings: ReturnType<typeof resolveAiSettings>;
}) => {
  const imageAttachments = attachments
    .filter((attachment) => attachment.mediaType?.startsWith("image/"))
    .filter(
      (attachment) =>
        typeof attachment.url === "string" &&
        attachment.url.startsWith("data:image/"),
    )
    .slice(0, MAX_IMAGE_ATTACHMENTS);

  if (imageAttachments.length === 0) {
    return message;
  }

  if (!aiSettings) {
    const unavailableContext = imageAttachments
      .map(
        (attachment, index) =>
          `- ${attachment.filename || `image-${index + 1}`}: Image attached, but vision processing is unavailable. Configure an AI provider first.`,
      )
      .join("\n");

    const baseMessage = message || "User shared image context.";
    return `${baseMessage}\n\nAttached image context:\n${unavailableContext}`;
  }

  const imageSummaries = await Promise.all(
    imageAttachments.map(async (attachment, index) => {
      const parsed = parseImageDataUrl(attachment.url ?? "");
      const imageLabel = attachment.filename || `image-${index + 1}`;

      if (!parsed) {
        return `- ${imageLabel}: Image attached, but format/size is unsupported.`;
      }

      const summary = await describeImageForCoding({
        dataUrl: attachment.url!,
        userMessage: message,
        aiSettings,
      });

      return `- ${imageLabel}: ${summary}`;
    }),
  );

  const imagesContext = imageSummaries.join("\n");
  const clippedContext =
    imagesContext.length > MAX_ATTACHMENT_CONTEXT_CHARS
      ? `${imagesContext.slice(0, MAX_ATTACHMENT_CONTEXT_CHARS)}\n...[truncated]`
      : imagesContext;

  const baseMessage = message || "User shared image context.";
  return `${baseMessage}\n\nAttached image context:\n${clippedContext}`;
};
