// src/services/bus.js
const { EventEmitter } = require('events');
const bus = new EventEmitter();

// allow many UI clients
bus.setMaxListeners(0);

module.exports = {
  emit: (type, payload) => bus.emit('ui:event', { type, ts: Date.now(), ...payload }),
  on: (fn) => { bus.on('ui:event', fn); return () => bus.off('ui:event', fn); },
};
