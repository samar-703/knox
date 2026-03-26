import { RetrievedFile } from "./retrieval";

const RULE_FILE_PATTERNS = [
  /^agents\.md$/i,
  /^claude\.md$/i,
  /^\.cursorrules$/i,
  /^\.cursor\/rules\/.+/i,
  /^\.github\/copilot-instructions\.md$/i,
];

const MAX_RULE_FILES = 4;
const MAX_RULE_CHARS = 5_000;

const isRuleFile = (path: string) =>
  RULE_FILE_PATTERNS.some((pattern) => pattern.test(path));

const scoreRuleFile = (path: string) => {
  const lowerPath = path.toLowerCase();
  if (lowerPath === "agents.md") {
    return 100;
  }
  if (lowerPath === ".cursorrules") {
    return 90;
  }
  if (lowerPath === "claude.md") {
    return 80;
  }
  if (lowerPath === ".github/copilot-instructions.md") {
    return 70;
  }
  if (lowerPath.startsWith(".cursor/rules/")) {
    return 60;
  }
  return 0;
};

export const getRepoRuleFiles = (files: RetrievedFile[]) =>
  files
    .filter((file) => isRuleFile(file.path))
    .sort((a, b) => {
      const scoreDiff = scoreRuleFile(b.path) - scoreRuleFile(a.path);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return a.path.localeCompare(b.path);
    })
    .slice(0, MAX_RULE_FILES);

export const buildRepoRulesContext = (files: RetrievedFile[]) => {
  const ruleFiles = getRepoRuleFiles(files);
  if (ruleFiles.length === 0) {
    return "No repository-specific AI instruction files were found.";
  }

  let totalChars = 0;
  const sections: string[] = [];

  for (const file of ruleFiles) {
    if (totalChars >= MAX_RULE_CHARS) {
      break;
    }

    const remaining = MAX_RULE_CHARS - totalChars;
    const snippet = file.content.slice(0, remaining);
    totalChars += snippet.length;
    sections.push(`Rule file: ${file.path}\n\`\`\`\n${snippet}\n\`\`\``);
  }

  return sections.join("\n\n");
};
