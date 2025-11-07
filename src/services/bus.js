import { EventEmitter } from 'events';

/**
 * Lightweight in-process event bus.
 * Usage:
 *   const bus = require('../services/bus');
 *   bus.publish('pos.confirmed', { ... })
 *   const off = bus.subscribe('pos.confirmed', (payload) => { ... })
 *   off(); // unsubscribe
 *
 * Also emits "*" with { topic, payload } for catch-all listeners (great for SSE).
 */
class Bus extends EventEmitter {
  publish(topic, payload) {
    try {
      this.emit(topic, payload);
      this.emit('*', { topic, payload, ts: new Date().toISOString() });
    } catch (err) {
      // never crash the process because a listener threw
      // (listeners should handle their own errors)
      // eslint-disable-next-line no-console
      console.error('bus publish error:', err && err.message ? err.message : err);
    }
  }

  subscribe(topic, handler) {
    this.on(topic, handler);
    // return an unsubscribe fn
    return () => this.off(topic, handler);
  }
}

export default new Bus();
