const amqp = require("amqplib");
const logger = require("./logger");

const disabled = process.env.DISABLE_RABBIT === "1";
const state = {
  enabled: !disabled,
  connecting: false,
  connected: false,
  lastConnectedAt: null,
  lastError: disabled ? null : "Not connected yet",
  queue: "scan_jobs",
};

if (disabled) {
  module.exports = {
    connect: async () => logger.warn("RabbitMQ disabled via DISABLE_RABBIT=1"),
    publish: async () => {},
    consume: async () => {},
    ping: async () => ({
      ok: true,
      status: "disabled",
    }),
    getStatus: () => ({ ...state }),
    channel: null,
  };
} else {
  let channel = null;
  let connection = null;
  let connecting = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function connect(url) {
    if (channel) return channel;
    if (connecting) {
      while (connecting && !channel) {
        await sleep(200);
      }
      if (channel) return channel;
    }

    connecting = true;
    state.connecting = true;
    const amqpUrl =
      url ||
      process.env.RABBIT_URL ||
      process.env.RABBITMQ_URL ||
      "amqp://guest:guest@localhost:5672";
    let attempt = 0;
    let backoff = 500;

    while (true) {
      attempt += 1;
      try {
        connection = await amqp.connect(amqpUrl);

        connection.on('error', (err) => {
          state.connected = false;
          state.lastError = err && err.message ? err.message : String(err);
          logger.error({ err: state.lastError }, "Rabbit connection error");
        });

        connection.on('close', () => {
          state.connected = false;
          state.connecting = false;
          logger.warn("Rabbit connection closed, clearing channel to allow reconnect.");
          channel = null;
          connection = null;
          setTimeout(() => {
            connect(amqpUrl).catch(() => {});
          }, 1000);
        });

        channel = await connection.createChannel();
        await channel.assertQueue(state.queue, { durable: true });
        state.connected = true;
        state.connecting = false;
        state.lastConnectedAt = new Date().toISOString();
        state.lastError = null;
        logger.info(
          { queue: state.queue },
          "RabbitMQ connected and channel created"
        );
        connecting = false;
        return channel;
      } catch (err) {
        connecting = false;
        state.connecting = false;
        state.connected = false;
        channel = null;
        connection = null;
        const msg = err && err.message ? err.message : String(err);
        state.lastError = msg;
        logger.error({ attempt, msg }, "RabbitMQ connect attempt failed");
        if (attempt >= 10) {
          logger.error(
            "Exceeded max RabbitMQ connection attempts, will keep trying in background."
          );
          setTimeout(() => {
            connect(amqpUrl).catch(() => {});
          }, 5000);
          throw err;
        }
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 5000);
      }
    }
  }

  async function publish(queue, msg) {
    if (!channel) await connect();
    await channel.assertQueue(queue, { durable: true });
    channel.sendToQueue(queue, Buffer.from(JSON.stringify(msg)), { persistent: true });
    logger.info({ queue, size: JSON.stringify(msg).length }, "Published message");
  }

  async function consume(queue, handler) {
    if (!channel) await connect();
    await channel.assertQueue(queue, { durable: true });
    logger.info({ queue }, "Listening for messages");

    await channel.consume(
      queue,
      async (message) => {
        if (!message) return;
        try {
          const data = JSON.parse(message.content.toString());
          await handler(data);
          channel.ack(message);
        } catch (err) {
          logger.error(
            { err: err && err.message ? err.message : err },
            "Error processing message"
          );
          try {
            channel.nack(message, false, false);
          } catch (e) {
            logger.error({ e }, "Failed to nack message");
          }
        }
      },
      { noAck: false }
    );
  }

  async function ping() {
    try {
      await connect();
      if (!channel) {
        return {
          ok: false,
          status: "down",
          error: state.lastError || "RabbitMQ channel unavailable",
        };
      }

      await channel.checkQueue(state.queue).catch(() => channel.assertQueue(state.queue, { durable: true }));
      state.connected = true;
      state.lastError = null;
      return {
        ok: true,
        status: "up",
        queue: state.queue,
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

  module.exports = {
    connect,
    publish,
    consume,
    ping,
    getStatus: () => ({
      ...state,
      connected: Boolean(channel) && state.connected,
      hasChannel: Boolean(channel),
    }),
  };
}
