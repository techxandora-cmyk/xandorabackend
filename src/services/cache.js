const { createClient } = require("redis");
const logger = require("./logger");

const redisUrl =
  process.env.REDIS_URL ||
  `redis://${process.env.REDIS_HOST || "127.0.0.1"}:${process.env.REDIS_PORT || 6379}`;
const disabled =
  process.env.DISABLE_REDIS === "1" || process.env.DISABLE_REDIS === "true";
const state = {
  enabled: !disabled,
  url: redisUrl,
  connected: false,
  lastConnectedAt: null,
  lastError: disabled ? null : "Not connected yet",
};

if (disabled) {
  logger.warn("Redis disabled via DISABLE_REDIS=1");
  module.exports = {
    get: async () => null,
    mget: async (keys) => (Array.isArray(keys) ? keys.map(() => null) : []),
    set: async () => {},
    del: async () => {},
    ping: async () => ({
      ok: true,
      status: "disabled",
    }),
    getStatus: () => ({ ...state }),
    client: null,
  };
} else {
  const client = createClient({ url: redisUrl });

  client.on("connect", () => {
    state.connected = true;
    state.lastConnectedAt = new Date().toISOString();
    state.lastError = null;
    logger.info({ redisUrl }, "Redis client connected");
  });

  client.on("reconnecting", () => {
    state.connected = false;
    logger.warn("Redis client reconnecting");
  });

  client.on("end", () => {
    state.connected = false;
    logger.warn("Redis client disconnected");
  });

  client.on("error", (err) => {
    state.connected = false;
    state.lastError = err && err.message ? err.message : String(err);
    logger.warn({ err: state.lastError }, "Redis client error");
  });

  async function connect() {
    if (!client.isOpen) {
      try {
        await client.connect();
      } catch (err) {
        state.connected = false;
        state.lastError = err && err.message ? err.message : String(err);
        logger.warn({ err: state.lastError }, "Redis connect failed");
      }
    }
  }

  async function ping() {
    await connect();
    if (!client.isOpen) {
      return {
        ok: false,
        status: "down",
        error: state.lastError || "Redis client not open",
      };
    }

    try {
      const result = await client.ping();
      state.connected = true;
      state.lastError = null;
      return {
        ok: String(result || "").toUpperCase() === "PONG",
        status: "up",
        result,
      };
    } catch (err) {
      state.connected = false;
      state.lastError = err && err.message ? err.message : String(err);
      return {
        ok: false,
        status: "down",
        error: state.lastError,
      };
    }
  }

  connect().catch(() => {});

  module.exports = {
    get: async (key) => {
      try {
        return await client.get(key);
      } catch {
        return null;
      }
    },
    mget: async (keys) => {
      try {
        return await client.mGet(keys);
      } catch {
        return Array.isArray(keys) ? keys.map(() => null) : [];
      }
    },
    set: async (key, value, mode, ttl) => {
      try {
        if (mode && mode.toUpperCase() === "EX" && ttl) {
          return await client.set(key, value, { EX: ttl });
        }
        return await client.set(key, value);
      } catch {
        return null;
      }
    },
    del: async (key) => {
      try {
        return await client.del(key);
      } catch {
        return null;
      }
    },
    ping,
    getStatus: () => ({
      ...state,
      connected: state.connected && client.isOpen,
      clientOpen: client.isOpen,
    }),
    client,
  };
}
