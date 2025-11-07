const pino = require('pino');

const pretty = process.env.NODE_ENV !== 'production';
const transport = pretty ? pino.transport({ target: 'pino-pretty' }) : undefined;
const logger = pino({ level: process.env.LOG_LEVEL || 'info' }, transport);

module.exports = logger;
