const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "we",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "you",
]);

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length >= 2)
    .filter((token) => !STOP_WORDS.has(token));

export interface RetrievedFile {
  _id: string;
  name: string;
  path: string;
  content: string;
  updatedAt: number;
}

interface ScoredFile extends RetrievedFile {
  score: number;
  snippet: string;
}

const scoreFile = (queryTokens: string[], file: RetrievedFile) => {
  if (queryTokens.length === 0) {
    return 0;
  }

  const fileName = file.name.toLowerCase();
  const filePath = file.path.toLowerCase();
  const fileContent = file.content.toLowerCase();

  let score = 0;
  for (const token of queryTokens) {
    if (fileName.includes(token)) {
      score += 6;
    }
    if (filePath.includes(token)) {
      score += 4;
    }
    if (fileContent.includes(token)) {
      score += 1;
    }
  }

  return score;
};

const buildSnippet = (
  file: RetrievedFile,
  queryTokens: string[],
  maxChars = 1_200,
) => {
  const content = file.content;
  if (!content) {
    return "";
  }

  if (queryTokens.length === 0) {
    return content.slice(0, maxChars);
  }

  const lowerContent = content.toLowerCase();
  let bestIndex = -1;
  for (const token of queryTokens) {
    const index = lowerContent.indexOf(token);
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
    }
  }

  if (bestIndex === -1) {
    return content.slice(0, maxChars);
  }

  const start = Math.max(0, bestIndex - Math.floor(maxChars / 3));
  const end = Math.min(content.length, start + maxChars);
  return content.slice(start, end);
};

export const selectRelevantFiles = ({
  files,
  query,
  maxFiles = 6,
}: {
  files: RetrievedFile[];
  query: string;
  maxFiles?: number;
}) => {
  const queryTokens = tokenize(query);
  if (files.length === 0) {
    return [];
  }

  const scoredFiles: ScoredFile[] = files
    .map((file) => {
      const score = scoreFile(queryTokens, file);
      return {
        ...file,
        score,
        snippet: buildSnippet(file, queryTokens),
      };
    })
    .filter((file) => file.snippet.length > 0)
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);

  const capped = scoredFiles.slice(0, Math.max(1, maxFiles));

  return capped.map((file) => ({
    _id: file._id,
    path: file.path,
    score: file.score,
    snippet: file.snippet,
  }));
};
