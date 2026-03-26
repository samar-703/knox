import { z } from "zod";
import { RetrievedFile, searchWorkspaceFiles } from "./retrieval";

const MAX_TOOL_OUTPUT_CHARS = 8_000;
const DEFAULT_LIST_LIMIT = 40;
const DEFAULT_SEARCH_LIMIT = 8;
const DEFAULT_READ_MAX_CHARS = 4_000;
const DEFAULT_READ_LINE_SPAN = 200;

export type AgentToolName =
  | "list_files"
  | "read_file"
  | "search_files"
  | "run_terminal_command"
  | "apply_instruction_to_file"
  | "create_file"
  | "delete_file";

export interface WorkspaceEntry {
  _id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  parentId?: string;
  projectId: string;
  content?: string;
  updatedAt: number;
}

export interface ToolExecutionHandlers {
  applyInstructionToFile: (args: {
    path: string;
    instruction: string;
  }) => Promise<string>;
  runTerminalCommand: (args: { command: string }) => Promise<string>;
  createFile: (args: { path: string; content: string }) => Promise<string>;
  deleteFile: (args: { path: string }) => Promise<string>;
}

interface ToolCallInput {
  toolName: AgentToolName;
  rawArgs: unknown;
  files: RetrievedFile[];
  handlers: ToolExecutionHandlers;
}

export const normalizeWorkspacePath = (value: string) =>
  value.trim().replace(/^\.?\//, "").replace(/\/+/g, "/").replace(/\/$/, "");

export const isSafeWorkspacePath = (value: string) => {
  if (!value) {
    return false;
  }

  const segments = value.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.includes("\\") &&
      !segment.includes("\0"),
  );
};

const pathArgSchema = z
  .string()
  .min(1)
  .max(400)
  .transform(normalizeWorkspacePath)
  .refine(isSafeWorkspacePath, "Path must be a safe relative path");

const listFilesArgsSchema = z.object({
  query: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const readFileArgsSchema = z.object({
  path: pathArgSchema,
  startLine: z.number().int().min(1).max(200_000).optional(),
  endLine: z.number().int().min(1).max(200_000).optional(),
  maxChars: z.number().int().min(200).max(10_000).optional(),
});

const searchFilesArgsSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(30).optional(),
});

const runTerminalCommandArgsSchema = z.object({
  command: z.string().min(1).max(180),
});

const applyInstructionArgsSchema = z.object({
  path: pathArgSchema,
  instruction: z.string().min(1).max(2_000),
});

const createFileArgsSchema = z.object({
  path: pathArgSchema,
  content: z.string().max(100_000).optional().default(""),
});

const deleteFileArgsSchema = z.object({
  path: pathArgSchema,
});

const trimToolOutput = (value: string, maxChars = MAX_TOOL_OUTPUT_CHARS) => {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[output truncated]`;
};

const formatFileList = (paths: string[]) => {
  if (paths.length === 0) {
    return "No files found.";
  }

  return paths.map((path) => `- ${path}`).join("\n");
};

const resolveFileByPath = (files: RetrievedFile[], inputPath: string) => {
  const normalized = normalizeWorkspacePath(inputPath);
  const exact = files.find((file) => file.path === normalized);
  if (exact) {
    return exact;
  }

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
  const results = searchWorkspaceFiles({
    files,
    query,
    limit: limit ?? DEFAULT_SEARCH_LIMIT,
  }).map((result) => `- ${result.path}:${result.line} -> ${result.snippet}`);

  if (results.length === 0) {
    return `No matches found for "${query}".`;
  }

  return `Search results for "${query}":\n${results.join("\n")}`;
};

const runTerminalCommand = async (
  rawArgs: unknown,
  handlers: ToolExecutionHandlers,
) => {
  const parsed = runTerminalCommandArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return `Invalid args for run_terminal_command: ${parsed.error.issues[0]?.message ?? "unknown error"}`;
  }

  return await handlers.runTerminalCommand(parsed.data);
};

const runApplyInstruction = async (
  rawArgs: unknown,
  handlers: ToolExecutionHandlers,
) => {
  const parsed = applyInstructionArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return `Invalid args for apply_instruction_to_file: ${parsed.error.issues[0]?.message ?? "unknown error"}`;
  }
  return await handlers.applyInstructionToFile(parsed.data);
};

const runCreateFile = async (rawArgs: unknown, handlers: ToolExecutionHandlers) => {
  const parsed = createFileArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return `Invalid args for create_file: ${parsed.error.issues[0]?.message ?? "unknown error"}`;
  }
  return await handlers.createFile({
    path: parsed.data.path,
    content: parsed.data.content,
  });
};

const runDeleteFile = async (rawArgs: unknown, handlers: ToolExecutionHandlers) => {
  const parsed = deleteFileArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return `Invalid args for delete_file: ${parsed.error.issues[0]?.message ?? "unknown error"}`;
  }
  return await handlers.deleteFile({
    path: parsed.data.path,
  });
};

export const executeAgentTool = async ({
  toolName,
  rawArgs,
  files,
  handlers,
}: ToolCallInput) => {
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
    case "run_terminal_command":
      output = await runTerminalCommand(rawArgs, handlers);
      break;
    case "apply_instruction_to_file":
      output = await runApplyInstruction(rawArgs, handlers);
      break;
    case "create_file":
      output = await runCreateFile(rawArgs, handlers);
      break;
    case "delete_file":
      output = await runDeleteFile(rawArgs, handlers);
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

4) run_terminal_command
   args: { "command": string }
   use for simple verification or safe workspace shell commands like tests, lint, build, pwd, ls, or find.

5) apply_instruction_to_file
   args: { "path": string, "instruction": string }
   use when you need to modify an existing file.

6) create_file
   args: { "path": string, "content"?: string }
   use when you need to create a new file.

7) delete_file
   args: { "path": string }
   use when you need to delete a file.
`;
