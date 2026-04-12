// src/services/bus.js
const EventEmitter = require('events');

/**
 * Tiny in-process event bus so routes/services can broadcast events
 * to the SSE stream (api/v1/events/stream).
 */
class Bus extends EventEmitter {}
const bus = new Bus();

// Optional: increase max listeners if you expect many SSE clients
bus.setMaxListeners(50);

module.exports = bus;
