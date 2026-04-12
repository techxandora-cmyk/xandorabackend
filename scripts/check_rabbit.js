// scripts/check_rabbit.js
const r = require('./src/services/rabbit');
console.log('exports from src/services/rabbit ->', Object.keys(r));
if (typeof r.connect === 'function') console.log('has connect()');
if (typeof r.consume === 'function') console.log('has consume()');
if (typeof r.sendToQueue === 'function') console.log('has sendToQueue()');
if (typeof r.ack === 'function') console.log('has ack()');
if (typeof r.nack === 'function') console.log('has nack()');
