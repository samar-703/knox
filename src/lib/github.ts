export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

export const parseGitHubRepoUrl = (value: string): GitHubRepoRef | null => {
  try {
    const rawValue = value.trim();
    const normalizedValue = /^https?:\/\//i.test(rawValue)
      ? rawValue
      : `https://${rawValue}`;
    const url = new URL(normalizedValue);
    if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
      return null;
    }

    const parts = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);

    if (parts.length < 2) {
      return null;
    }

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");

    if (!owner || !repo) {
      return null;
    }

    return { owner, repo };
  } catch {
    return null;
  }
};

export const sanitizeGitHubRepoName = (value: string) => {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  return sanitized || "knox-export";
};
