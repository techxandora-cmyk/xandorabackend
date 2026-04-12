const pino = require("pino");

const pretty = process.env.NODE_ENV !== "production";
const transport = pretty
  ? pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
      },
    })
  : undefined;

const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    base: {
      service: process.env.LOG_SERVICE_NAME || "xandora-api",
      env: process.env.NODE_ENV || "development",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "request.headers.authorization",
        "request.headers.cookie",
        "headers.authorization",
        "headers.cookie",
        "body.password",
        "password",
      ],
      remove: true,
    },
  },
  transport
);

module.exports = logger;
