import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { inngest } from "@/inngest/client";
import { createRateLimiter } from "@/lib/rate-limit";

const requestSchema = z.object({
  messageId: z.string(),
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
      { error: "Rate limit exceeded. Try again shortly." },
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

  const messageId = parsed.data.messageId as Id<"messages">;

  const message = await convex.query(api.system.getMessageByIdForUser, {
    internalKey,
    userId,
    messageId,
  });

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  if (message.status !== "processing") {
    return NextResponse.json(
      { error: "Only processing messages can be cancelled" },
      { status: 409 },
    );
  }

  await inngest.send({
    name: "message/cancel",
    data: {
      messageId,
    },
  });

  await convex.mutation(api.system.updateMessageStatus, {
    internalKey,
    messageId,
    status: "cancelled",
  });

  return NextResponse.json({ success: true, messageId });
}
