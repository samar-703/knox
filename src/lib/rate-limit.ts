interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export const createRateLimiter = ({
  windowMs,
  maxRequests,
}: RateLimitOptions) => {
  const store = new Map<string, RateLimitEntry>();

  return (key: string) => {
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now - entry.windowStart > windowMs) {
      store.set(key, { count: 1, windowStart: now });
      return false;
    }

    entry.count += 1;
    store.set(key, entry);

    return entry.count > maxRequests;
  };
};
