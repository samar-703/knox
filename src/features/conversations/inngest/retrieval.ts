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
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length >= 2)
    .filter((token) => !STOP_WORDS.has(token));

const countTokens = (tokens: string[]) => {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
};

const clipText = (value: string, maxChars: number) => {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...[truncated]`;
};

export interface RetrievedFile {
  _id: string;
  name: string;
  path: string;
  content: string;
  updatedAt: number;
}

interface IndexedFile extends RetrievedFile {
  pathLower: string;
  nameLower: string;
  contentLower: string;
  pathTokenCounts: Map<string, number>;
  contentTokenCounts: Map<string, number>;
}

interface ScoredFile extends RetrievedFile {
  score: number;
  snippet: string;
}

export interface FileSearchResult {
  path: string;
  line: number;
  snippet: string;
  score: number;
}

const buildIndex = (files: RetrievedFile[]) => {
  const indexedFiles: IndexedFile[] = files.map((file) => {
    const pathTokens = tokenize(`${file.path} ${file.name}`);
    const contentTokens = tokenize(file.content);

    return {
      ...file,
      pathLower: file.path.toLowerCase(),
      nameLower: file.name.toLowerCase(),
      contentLower: file.content.toLowerCase(),
      pathTokenCounts: countTokens(pathTokens),
      contentTokenCounts: countTokens(contentTokens),
    };
  });

  const documentFrequency = new Map<string, number>();
  for (const file of indexedFiles) {
    const seen = new Set([
      ...file.pathTokenCounts.keys(),
      ...file.contentTokenCounts.keys(),
    ]);

    for (const token of seen) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  return { indexedFiles, documentFrequency };
};

const getTokenWeight = (
  token: string,
  totalFiles: number,
  documentFrequency: Map<string, number>,
) => {
  const docFreq = documentFrequency.get(token) ?? 0;
  return Math.log((totalFiles + 1) / (docFreq + 1)) + 1;
};

const scoreFile = (
  queryTokens: string[],
  rawQuery: string,
  file: IndexedFile,
  totalFiles: number,
  documentFrequency: Map<string, number>,
) => {
  if (queryTokens.length === 0 && !rawQuery.trim()) {
    return 0;
  }

  const trimmedQuery = rawQuery.trim().toLowerCase();
  let score = 0;

  if (trimmedQuery) {
    if (file.pathLower.includes(trimmedQuery)) {
      score += 18;
    }
    if (file.nameLower.includes(trimmedQuery)) {
      score += 12;
    }
  }

  for (const token of queryTokens) {
    const weight = getTokenWeight(token, totalFiles, documentFrequency);
    score += (file.pathTokenCounts.get(token) ?? 0) * 7 * weight;
    score += (file.contentTokenCounts.get(token) ?? 0) * 1.2 * weight;

    if (file.nameLower === token) {
      score += 10;
    }
    if (file.pathLower.endsWith(`/${token}`) || file.pathLower === token) {
      score += 8;
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
    return clipText(content, maxChars);
  }

  const lines = content.split("\n");
  let bestWindow = {
    score: -1,
    startLine: 0,
    endLine: Math.min(lines.length, 20),
  };

  for (let index = 0; index < lines.length; index++) {
    const windowLines = lines.slice(index, Math.min(lines.length, index + 20));
    const windowText = windowLines.join("\n").toLowerCase();
    const score = queryTokens.reduce((total, token) => {
      if (!windowText.includes(token)) {
        return total;
      }

      return total + (windowText.match(new RegExp(token, "g"))?.length ?? 1);
    }, 0);

    if (score > bestWindow.score) {
      bestWindow = {
        score,
        startLine: index,
        endLine: Math.min(lines.length, index + 20),
      };
    }
  }

  const snippet = lines
    .slice(bestWindow.startLine, bestWindow.endLine)
    .join("\n")
    .trim();

  return clipText(snippet || content, maxChars);
};

export const searchWorkspaceFiles = ({
  files,
  query,
  limit = 8,
}: {
  files: RetrievedFile[];
  query: string;
  limit?: number;
}) => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [] satisfies FileSearchResult[];
  }

  const queryTokens = tokenize(trimmedQuery);
  const { indexedFiles, documentFrequency } = buildIndex(files);

  return indexedFiles
    .map((file) => {
      const lowerQuery = trimmedQuery.toLowerCase();
      const lineMatches: FileSearchResult[] = [];

      file.content.split("\n").forEach((lineText, index) => {
        const lineLower = lineText.toLowerCase();
        if (
          !lineLower.includes(lowerQuery) &&
          !queryTokens.some((token) => lineLower.includes(token))
        ) {
          return;
        }

        const score =
          scoreFile(
            queryTokens,
            trimmedQuery,
            file,
            indexedFiles.length,
            documentFrequency,
          ) +
          (lineLower.includes(lowerQuery) ? 12 : 0) +
          queryTokens.reduce(
            (total, token) => total + (lineLower.includes(token) ? 2 : 0),
            0,
          );

        lineMatches.push({
          path: file.path,
          line: index + 1,
          snippet: clipText(lineText.trim(), 220),
          score,
        });
      });

      return lineMatches;
    })
    .flat()
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, Math.max(1, Math.min(limit, 30)));
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
    return [] satisfies Array<{
      _id: string;
      path: string;
      score: number;
      snippet: string;
    }>;
  }

  const { indexedFiles, documentFrequency } = buildIndex(files);

  const scoredFiles: ScoredFile[] = indexedFiles
    .map((file) => {
      const score = scoreFile(
        queryTokens,
        query,
        file,
        indexedFiles.length,
        documentFrequency,
      );

      return {
        _id: file._id,
        name: file.name,
        path: file.path,
        content: file.content,
        updatedAt: file.updatedAt,
        score,
        snippet: buildSnippet(file, queryTokens),
      };
    })
    .filter((file) => file.snippet.length > 0)
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);

  return scoredFiles.slice(0, Math.max(1, maxFiles)).map((file) => ({
    _id: file._id,
    path: file.path,
    score: file.score,
    snippet: file.snippet,
  }));
};
