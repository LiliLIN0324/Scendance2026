/** Node 20 lacks worker_threads.markAsUncloneable; undici 8 / jsdom 30 expect it. */
const workerThreads = require('node:worker_threads');
if (typeof workerThreads.markAsUncloneable !== 'function') {
  workerThreads.markAsUncloneable = function markAsUncloneable() {};
}
