import { google } from "@ai-sdk/google";
import { auth } from "@clerk/nextjs/server";
import {generateText, Output} from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { firecrawl } from "@/lib/firecrawl";
import { createRateLimiter } from "@/lib/rate-limit";



const quickEditScheme = z.object ({
  editedCode: z
    .string()
    .describe(
      "The edited version of the selected code based on the instruction"
    ),
});

const URL_REGEX = /https?:\/\/[^\s)>\]]+/g;
const MAX_URLS = 3;
const MAX_SCRAPED_DOC_LENGTH = 15_000;

const quickEditRequestSchema = z.object({
  selectedCode: z.string().min(1).max(60_000),
  fullCode: z.string().max(180_000).optional().default(""),
  instruction: z.string().min(1).max(4_000),
});

const isRateLimited = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 25,
});

const QUICK_EDIT_PROMPT = `You are a code editing assistant. Edit the selected code based on the user's instruction.

<context>
<selected_code>
{selectedCode}
</selected_code>
<full_code_context>
{fullCode}
</full_code_context>
</context>

{documentation}

<instruction>
{instruction}
</instruction>

<instructions>
Return ONLY the edited version of the selected code.
Maintain the same indentation level as the original.
Do not include any explanations or comments unless requested.
If the instruction is unclear or cannot be applied, return the original code unchanged.
</instructions>`;

export async function POST(request: Request) {
  try {

    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (isRateLimited(userId)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again shortly." },
        { status: 429 },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = quickEditRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const { selectedCode, fullCode, instruction } = parsed.data;

    const urls = Array.from(
      new Set((instruction.match(URL_REGEX) || []).slice(0, MAX_URLS)),
    );
    let documentationContext = "";

    if (urls.length > 0) {
      const scrapedResults = await Promise.all(
        urls.map(async (url) => {
          try {
            const result = await firecrawl.scrape(url, {
              formats: ["markdown"],
            });

            if (result.markdown){
              const clippedMarkdown = result.markdown.slice(
                0,
                MAX_SCRAPED_DOC_LENGTH,
              );
              return `<doc url="${url}">\n${clippedMarkdown}\n</doc>`;
            }
            return null;
          } catch{
            return null;
          }
        })
      );
      const validResults = scrapedResults.filter(Boolean);

      if (validResults.length > 0) {
        documentationContext = `<documentation>\n${validResults.join("\n")}\n</documentation>`;
      }
    }

    const prompt = QUICK_EDIT_PROMPT
      .replace("{selectedCode}", selectedCode)
      .replace("{fullCode}", fullCode || "")
      .replace("{instruction}", instruction)
      .replace("{documentation}", documentationContext);

    const { output } = await generateText({
      model: google("gemini-2.0-flash"),
      output: Output.object({ schema: quickEditScheme }),
      prompt,
    });

    return NextResponse.json({ editedCode: output.editedCode });
  } catch (error) {
    console.error("Edit error:", error);
    return NextResponse.json(
      { error: "Failed to generate edit" },
      { status: 500 }
    )
  }
};
