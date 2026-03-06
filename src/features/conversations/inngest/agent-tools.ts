import { z } from "zod";
import { RetrievedFile } from "./retrieval";

const MAX_TOOL_OUTPUT_CHARS = 8_000;
const DEFAULT_LIST_LIMIT = 40;
const DEFAULT_SEARCH_LIMIT = 8;
const DEFAULT_READ_MAX_CHARS = 4_000;
const DEFAULT_READ_LINE_SPAN = 200;

export type AgentToolName = "list_files" | "read_file" | "search_files";

interface ToolCallInput {
  toolName: AgentToolName;
  rawArgs: unknown;
  files: RetrievedFile[];
}

const trimToolOutput = (value: string, maxChars = MAX_TOOL_OUTPUT_CHARS) => {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[output truncated]`;
};

const listFilesArgsSchema = z.object({
  query: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const readFileArgsSchema = z.object({
  path: z.string().min(1).max(400),
  startLine: z.number().int().min(1).max(200_000).optional(),
  endLine: z.number().int().min(1).max(200_000).optional(),
  maxChars: z.number().int().min(200).max(10_000).optional(),
});

const searchFilesArgsSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(30).optional(),
});

const formatFileList = (paths: string[]) => {
  if (paths.length === 0) {
    return "No files found.";
  }

  return paths.map((path) => `- ${path}`).join("\n");
};

const resolveFileByPath = (files: RetrievedFile[], inputPath: string) => {
  const normalized = inputPath.trim().replace(/^\.?\//, "");
  const exact = files.find((file) => file.path === normalized);
  if (exact) {
    return exact;
  }

  // Fallback: match by basename if exact path wasn't provided.
  const basenameMatches = files.filter(
    (file) => file.path.split("/").at(-1) === normalized,
  );
  if (basenameMatches.length === 1) {
    return basenameMatches[0];
  }

  return null;
};

const runListFiles = (rawArgs: unknown, files: RetrievedFile[]) => {
  const parsed = listFilesArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return `Invalid args for list_files: ${parsed.error.issues[0]?.message ?? "unknown error"}`;
  }

  const { query, limit } = parsed.data;
  const queryLower = query?.toLowerCase().trim();
  const filtered = queryLower
    ? files.filter((file) => file.path.toLowerCase().includes(queryLower))
    : files;

  const capped = filtered
    .slice(0, limit ?? DEFAULT_LIST_LIMIT)
    .map((file) => file.path);
  return `Files:\n${formatFileList(capped)}`;
};

const runReadFile = (rawArgs: unknown, files: RetrievedFile[]) => {
  const parsed = readFileArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return `Invalid args for read_file: ${parsed.error.issues[0]?.message ?? "unknown error"}`;
  }

  const { path, startLine, endLine, maxChars } = parsed.data;
  const file = resolveFileByPath(files, path);
  if (!file) {
    return `File not found: ${path}`;
  }

  const lines = file.content.split("\n");
  const start = Math.max(1, startLine ?? 1);
  const maxEnd = start + DEFAULT_READ_LINE_SPAN - 1;
  const end = Math.min(
    lines.length,
    endLine ? Math.max(start, endLine) : maxEnd,
  );

  const selected = lines.slice(start - 1, end).join("\n");
  const clipped = selected.slice(0, maxChars ?? DEFAULT_READ_MAX_CHARS);

  return `Path: ${file.path}\nLines: ${start}-${end}\n\`\`\`\n${clipped}\n\`\`\``;
};

const runSearchFiles = (rawArgs: unknown, files: RetrievedFile[]) => {
  const parsed = searchFilesArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return `Invalid args for search_files: ${parsed.error.issues[0]?.message ?? "unknown error"}`;
  }

  const { query, limit } = parsed.data;
  const queryLower = query.toLowerCase();
  const results: string[] = [];

  for (const file of files) {
    if (results.length >= (limit ?? DEFAULT_SEARCH_LIMIT)) {
      break;
    }

    const index = file.content.toLowerCase().indexOf(queryLower);
    if (index === -1) {
      continue;
    }

    const prefix = file.content.slice(0, index);
    const line = prefix.split("\n").length;
    const snippetStart = Math.max(0, index - 120);
    const snippetEnd = Math.min(file.content.length, index + query.length + 120);
    const snippet = file.content.slice(snippetStart, snippetEnd).replace(/\s+/g, " ");

    results.push(`- ${file.path}:${line} -> ${snippet}`);
  }

  if (results.length === 0) {
    return `No matches found for "${query}".`;
  }

  return `Search results for "${query}":\n${results.join("\n")}`;
};

export const executeAgentTool = ({ toolName, rawArgs, files }: ToolCallInput) => {
  let output: string;

  switch (toolName) {
    case "list_files":
      output = runListFiles(rawArgs, files);
      break;
    case "read_file":
      output = runReadFile(rawArgs, files);
      break;
    case "search_files":
      output = runSearchFiles(rawArgs, files);
      break;
    default:
      output = "Unknown tool requested.";
  }

  return trimToolOutput(output);
};

export const AGENT_TOOLS_GUIDE = `
Available tools:
1) list_files
   args: { "query"?: string, "limit"?: number }
   use when you need file discovery.

2) read_file
   args: { "path": string, "startLine"?: number, "endLine"?: number, "maxChars"?: number }
   use when you need exact code from a specific file.

3) search_files
   args: { "query": string, "limit"?: number }
   use when you need to locate symbols/text quickly.
`;
