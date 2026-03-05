import { z } from 'zod';
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { convex } from '@/lib/convex-client';
import { api } from '../../../../convex/_generated/api';
import { Id } from '../../../../convex/_generated/dataModel';
import { inngest } from '@/inngest/client';
import { createRateLimiter } from '@/lib/rate-limit';

const requestSchema = z.object({
  conversationId: z.string(),
  message: z.string().min(1).max(8_000),
});

const isRateLimited = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
});

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({error: "Unauthorized"}, { status: 401 });
  }

  if (isRateLimited(userId)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }

  const internalKey = process.env.CONVEX_INTERNAL_KEY;

  if (!internalKey) {
    return NextResponse.json({error: "Internal key not configured"}, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const { conversationId, message } = parsed.data;
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
  }

  const conversationIdTyped = conversationId as Id<"conversations">;

  const conversation = await convex.query(api.system.getConversationByIdForUser, {
    internalKey,
    userId,
    conversationId: conversationIdTyped,
  });

  if (!conversation) {
    return NextResponse.json({error: "Conversation not found"}, { status: 404 });
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

  await convex.mutation(api.system.createMessage, {
    internalKey,
    conversationId: conversationIdTyped,
    projectId,
    role: "user",
    content: trimmedMessage
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
    },
  })

  return NextResponse.json({ 
    success: true,
    eventId: event.ids[0],
    messageId: assistantMessageId,
  });
};
