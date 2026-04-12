// src/lib/realtime.js
let io = null;

function attachIO(server, origin = 'http://localhost:5173') {
  // eslint-disable-next-line no-undef
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: { origin, credentials: true }
  });

  io.on('connection', (socket) => {
    // simple heartbeat for debugging
    socket.emit('hello', { ok: true, ts: new Date().toISOString() });
  });

  return io;
}

function getIO() {
  return io;
}

function emit(event, payload) {
  if (io) io.emit(event, payload);
}

export default { attachIO, getIO, emit };

