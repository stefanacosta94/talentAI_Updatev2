'use strict';

// Proxy de demostración: publica SOLO POST /api/webhooks/resend.
// Apuntar Cloudflare Quick Tunnel a http://127.0.0.1:3001, no a Express:3000.
// No usa credenciales ni modifica firmas. La autenticidad se verifica en Express.
const http = require('node:http');
const PATH = '/api/webhooks/resend';
const MAX_BODY = 65536;

function crearProxyWebhook({ puerto = 3001, destino = 3000, logger = console } = {}) {
  const servidor = http.createServer((req, res) => {
    if (req.url !== PATH || req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type':'application/json' });
      res.end('{"recibido":false}');
      return;
    }
    const tipo = String(req.headers['content-type'] || '').toLowerCase();
    if (!/^application\/json(?:\s*;|\s*$)/.test(tipo)) {
      res.writeHead(415, { 'Content-Type':'application/json' });
      res.end('{"recibido":false}');
      return;
    }
    const partes = [];
    let bytes = 0;
    let demasiado = false;
    req.on('data', parte => {
      bytes += parte.length;
      if (bytes > MAX_BODY) demasiado = true;
      else partes.push(parte);
    });
    req.on('end', () => {
      if (demasiado) {
        res.writeHead(413, { 'Content-Type':'application/json' });
        res.end('{"recibido":false}');
        return;
      }
      const body = Buffer.concat(partes);
      const request = http.request({
        hostname:'127.0.0.1', port:destino, path:PATH, method:'POST',
        headers:{
          'content-type':'application/json',
          'content-length':String(body.length),
          'svix-id':req.headers['svix-id'] || '',
          'svix-timestamp':req.headers['svix-timestamp'] || '',
          'svix-signature':req.headers['svix-signature'] || '',
        },
        timeout:15000,
      }, upstream => {
        res.writeHead(upstream.statusCode || 503, { 'Content-Type':'application/json' });
        upstream.pipe(res);
      });
      request.on('timeout', () => request.destroy());
      request.on('error', () => {
        if (!res.headersSent) res.writeHead(503, { 'Content-Type':'application/json' });
        if (!res.writableEnded) res.end('{"recibido":false}');
      });
      request.end(body);
    });
    req.on('error', () => {
      if (!res.headersSent) res.writeHead(400, { 'Content-Type':'application/json' });
      if (!res.writableEnded) res.end('{"recibido":false}');
    });
  });
  servidor.listen(puerto, '127.0.0.1', () => {
    logger.info(`[RESEND-WEBHOOK] Proxy limitado disponible en http://127.0.0.1:${servidor.address().port}${PATH}`);
  });
  return servidor;
}

if (require.main === module) {
  crearProxyWebhook({
    puerto: Number(process.env.RESEND_WEBHOOK_PROXY_PORT || 3001),
    destino: Number(process.env.PORT || 3000),
  });
}
module.exports = { crearProxyWebhook, PATH, MAX_BODY };
