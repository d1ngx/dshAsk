'use strict';
const net = require('node:net');

// A normal upstream EOF must drain the destination's pending writes.
// destroy() on its close event can reset a partially delivered HTTP response.
function createRelay(port, host = '127.0.0.1') {
  return net.createServer(socket => {
    const upstream = net.connect(port, host);
    socket.pipe(upstream).pipe(socket);
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => {
      if (!upstream.readableEnded) socket.destroy();
    });
  });
}
module.exports = { createRelay };
