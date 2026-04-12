const { randomUUID } = require("crypto");
const logger = require("../services/logger");

function createRequestContext(req, res, next) {
  const requestId =
    String(req.headers["x-request-id"] || "").trim() || randomUUID();
  const startedAt = process.hrtime.bigint();

  req.id = requestId;
  req.log = logger.child({
    request_id: requestId,
    method: req.method,
    path: req.originalUrl || req.url,
  });

  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    req.log[level](
      {
        status_code: res.statusCode,
        duration_ms: Number(elapsedMs.toFixed(2)),
        ip: req.ip,
        user_id: req.user?.user_id || null,
      },
      "HTTP request completed"
    );
  });

  next();
}

module.exports = {
  createRequestContext,
};
