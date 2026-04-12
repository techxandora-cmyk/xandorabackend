function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function createRateLimiter(options = {}) {
  const windowMs = toPositiveInt(options.windowMs, 60_000);
  const max = toPositiveInt(options.max, 60);
  const keyFn =
    typeof options.key === "function"
      ? options.key
      : (req) => String(req.ip || req.headers["x-forwarded-for"] || "unknown");
  const skip =
    typeof options.skip === "function" ? options.skip : () => false;
  const message =
    options.message || "Too many requests. Please wait and try again.";
  const store = new Map();

  function prune(now) {
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }

  return function rateLimiter(req, res, next) {
    if (skip(req)) {
      return next();
    }

    const now = Date.now();
    prune(now);

    const key = String(keyFn(req) || "unknown");
    const current =
      store.get(key) || {
        count: 0,
        resetAt: now + windowMs,
      };

    if (current.resetAt <= now) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }

    current.count += 1;
    store.set(key, current);

    const remaining = Math.max(max - current.count, 0);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((current.resetAt - now) / 1000)
    );

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(remaining, 0)));
    res.setHeader("RateLimit-Reset", String(retryAfterSeconds));

    if (current.count > max) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        ok: false,
        error: message,
        request_id: req.id || null,
        retry_after_seconds: retryAfterSeconds,
      });
    }

    return next();
  };
}

function matchWriteMethods(req) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(
    String(req.method || "").toUpperCase()
  );
}

module.exports = {
  createRateLimiter,
  matchWriteMethods,
};
