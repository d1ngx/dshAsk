'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createRelay } = require('../integrations/kodbox-file/tcp-relay.cjs');
(async () => {
  const body = Buffer.alloc(4 * 1024 * 1024);
  for (let i = 0; i < body.length; i++) body[i] = (i * 31 + (i >> 8)) % 256;
  const gzip = gzipSync(body);
  const origin = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/javascript', 'content-encoding': 'gzip', connection: 'close' });
    res.end(gzip);
  });
  origin.on('upgrade', (req, socket) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n'); socket.on('data', data => socket.write(data)); });
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
  const relay = createRelay(origin.address().port);
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  try {
    await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: relay.address().port }, response => {
        const chunks = [];
        response.on('data', chunk => { chunks.push(chunk); response.pause(); setTimeout(() => response.resume(), 2); });
        response.on('error', reject);
        response.on('end', () => { try { assert.equal(response.complete, true); assert.deepEqual(gunzipSync(Buffer.concat(chunks)), body); resolve(); } catch (error) { reject(error); } });
      }).on('error', reject);
    })));
    await new Promise((resolve, reject) => {
      const client = net.connect(relay.address().port, '127.0.0.1');
      let received = '', upgraded = false;
      client.on('connect', () => client.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n'));
      client.on('data', chunk => {
        received += chunk;
        if (!upgraded && received.includes('\r\n\r\n')) { upgraded = true; received = ''; client.write('duplex-check'); }
        else if (received === 'duplex-check') { client.destroy(); resolve(); }
      });
      client.on('error', reject);
    });
    console.log('TCP relay: parallel slow gzip responses complete; upgraded duplex connection passed');
  } finally { await new Promise(resolve => relay.close(resolve)); await new Promise(resolve => origin.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
