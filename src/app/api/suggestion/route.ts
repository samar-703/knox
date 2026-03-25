import { generateText, Output } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { aiSettingsSchema } from "@/lib/ai-settings";
import { getLanguageModel, resolveAiSettings } from "@/lib/ai-provider.server";


const suggestionSchema = z.object ({
  suggestion: z
    .string()
    .describe("The code to insert at cursor or empty string if not completion needed"),
});

const suggestionRequestSchema = z.object({
  fileName: z.string().min(1).max(512),
  code: z.string().min(1).max(120_000),
  currentLine: z.string().max(2_000),
  previousLines: z.string().max(8_000),
  textBeforeCursor: z.string().max(2_000),
  textAfterCursor: z.string().max(2_000),
  nextLines: z.string().max(8_000).optional().default(""),
  lineNumber: z.number().int().min(1).max(200_000),
  providerConfig: aiSettingsSchema.optional(),
});

const isRateLimited = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 45,
});

const SUGGESTION_PROMPT = `You are a code suggestion assistant.

<context>
<file_name>{fileName}</file_name>
<previous_lines>
{previousLines}
</previous_lines>
<current_line number="{lineNumber}">{currentLine}</current_line>
<before_cursor>{textBeforeCursor}</before_cursor>
<after_cursor>{textAfterCursor}</after_cursor>
<next_lines>
{nextLines}
</next_lines>
<full_code>
{code}
</full_code>
</context>

<instructions>
Follow these steps IN ORDER:

1. First, look at next_lines. If next_lines contains ANY code, check if it continues from where the cursor is. If it does, return empty string immediately - the code is already written.

2. Check if before_cursor ends with a complete statement (;, }, )). If yes, return empty string.

3. Only if steps 1 and 2 don't apply: suggest what should be typed at the cursor position, using context from full_code.

Your suggestion is inserted immediately after the cursor, so never suggest code that's already in the file.
</instructions>`;

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId){
      return NextResponse.json({
        error: "Unauthorized"
      },
      { status: 403 },
      );
    }

    if (isRateLimited(userId)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again shortly." },
        { status: 429 },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = suggestionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const {
      fileName,
      code,
      currentLine,
      previousLines,
      textBeforeCursor,
      textAfterCursor,
      nextLines,
      lineNumber,
      providerConfig,
    } = parsed.data;

    const aiSettings = resolveAiSettings(providerConfig);
    if (!aiSettings) {
      return NextResponse.json(
        { error: "AI provider not configured. Open the AI settings panel and add your API key." },
        { status: 400 },
      );
    }

    const prompt = SUGGESTION_PROMPT
      .replace("{fileName}", fileName)
      .replace("{code}", code)
      .replace("{currentLine}", currentLine)
      .replace("{previousLines}", previousLines)
      .replace("{textBeforeCursor}", textBeforeCursor)
      .replace("{textAfterCursor}", textAfterCursor)
      .replace("{nextLines}", nextLines || "")
      .replace("{lineNumber}", lineNumber.toString());

    const { output } = await generateText({
      model: getLanguageModel(aiSettings, "autocomplete"),
      output: Output.object({ schema: suggestionSchema }),
      prompt,
    });
    return NextResponse.json({ suggestion: output.suggestion})
  } catch (error) {
    console.error("Suggestion error: ", error);
    return NextResponse.json(
      { error: "failed to generate suggestion" },
      { status: 500 },
    );
  }
}
