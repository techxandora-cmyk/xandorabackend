const { createClient } = require('redis');
const logger = require('./logger');

const redisUrl = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`;
const client = createClient({ url: redisUrl });
const disabled = process.env.DISABLE_REDIS === '1';
if (disabled) {
  module.exports = {
    get: async () => null,
    set: async () => {},
    del: async () => {},
    client: null,
  };
  console.warn('Redis disabled via DISABLE_REDIS=1');
  return;
}
client.on('error', (err) => logger.warn({ err: err && err.message ? err.message : err }, 'Redis client error'));

async function connect() {
  if (!client.isOpen) {
    await client.connect().catch(err => {
      logger.warn({ err: err && err.message ? err.message : err }, 'Redis connect failed');
    });
  }
}

connect().catch(()=>{});

module.exports = {
  get: async (key) => {
    try { return await client.get(key); } catch (e) { return null; }
  },
  mget: async (keys) => {
    try { return await client.mGet(keys); } catch (e) { return keys.map(() => null); }
  },
  set: async (key, value, mode, ttl) => {
    try {
      if (mode && mode.toUpperCase() === 'EX' && ttl) {
        return await client.set(key, value, { EX: ttl });
      }
      return await client.set(key, value);
    } catch (e) { /* ignore */ }
  },
  del: async (key) => {
    try { return await client.del(key); } catch (e) { /* ignore */ }
  }
};
