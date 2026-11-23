import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createBookingApp } from '../worker.mjs';
import { openBookingDatabase } from './database.mjs';

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const fetch = createBookingApp(async pathname => {
  const file = resolve(publicDirectory, `.${pathname}`);
  try {
    const [directory, absolute] = await Promise.all([realpath(publicDirectory), realpath(file)]);
    if (!absolute.startsWith(`${directory}${sep}`)) return null;
    return await readFile(absolute);
  } catch (error) {
    if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) return null;
    throw error;
  }
});

function toRequest(incoming) {
  const { method, url: target, headers: sourceHeaders } = incoming;
  const authority = sourceHeaders.host;
  if (!authority || !/^(?:[a-z\d.-]+|\[[a-f\d:]+\])(?::\d+)?$/i.test(authority)) return null;
  if (!target?.startsWith('/') || target.startsWith('//') || target.includes('\\')) return null;

  const peer = incoming.socket.remoteAddress;
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer);
  const forwardedHttps = loopback && sourceHeaders['x-forwarded-proto'] === 'https';
  // The managed preview proxy terminates HTTPS on loopback.
  const protocol = forwardedHttps ? 'https' : 'http';
  let url;
  try {
    url = new URL(`${protocol}://${authority}${target}`);
  } catch {
    return null;
  }

  const headers = new Headers(sourceHeaders);
  headers.delete('cf-connecting-ip');
  if (peer) headers.set('cf-connecting-ip', peer);

  if (method === 'GET' || method === 'HEAD') return new Request(url, { method, headers });
  return new Request(url, { method, headers, body: Readable.toWeb(incoming), duplex: 'half' });
}

function plainResponse(outgoing, status, message) {
  outgoing.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  outgoing.end(message);
}

export async function startBookingServer({
  host = process.env.HOST || '127.0.0.1',
  port = process.env.PORT ?? 4173,
  databaseFile,
  rateLimitSecret = process.env.RATE_LIMIT_SECRET,
  ownerPassword = process.env.OWNER_PASSWORD,
} = {}) {
  const listenPort = Number(port);
  if (!/^\d+$/.test(String(port)) || !Number.isInteger(listenPort) || listenPort > 65535) {
    throw new Error('Port 0 ile 65535 arasında bir tam sayı olmalıdır.');
  }

  const DB = openBookingDatabase(databaseFile);
  const env = { DB, RATE_LIMIT_SECRET: rateLimitSecret, OWNER_PASSWORD: ownerPassword };
  for (const key of ['SMS_ENABLED', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_SENDER_ID',
    'SMS_TURKEY_LOCAL_ENTITY', 'APP_ORIGIN', 'JOB_SECRET']) env[key] = process.env[key];
  const server = createServer({ headersTimeout: 10_000, requestTimeout: 15_000 }, async (incoming, outgoing) => {
    try {
      if (['CONNECT', 'TRACE', 'TRACK'].includes(incoming.method)) {
        plainResponse(outgoing, 405, 'Yöntem desteklenmiyor.');
        return;
      }

      const request = toRequest(incoming);
      if (!request) {
        plainResponse(outgoing, 400, 'Geçersiz istek.');
        return;
      }

      const response = await fetch(request, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (incoming.method === 'HEAD' || !response.body) outgoing.end();
      else await pipeline(Readable.fromWeb(response.body), outgoing);
    } catch {
      if (outgoing.destroyed) return;
      if (outgoing.headersSent) outgoing.destroy();
      else plainResponse(outgoing, 500, 'İstek işlenemedi.');
    }
  });

  try {
    await new Promise((ready, failed) => {
      server.once('error', failed);
      server.listen(listenPort, host, ready);
    });
  } catch (error) {
    DB.close();
    throw error;
  }
  server.once('close', () => DB.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: {
    host: { type: 'string' },
    hostname: { type: 'string' },
    port: { type: 'string' },
    strictPort: { type: 'boolean' },
  } });
  const server = await startBookingServer({ host: values.host ?? values.hostname, port: values.port });
  const { address, family, port } = server.address();
  console.log(`http://${family === 'IPv6' ? `[${address}]` : address}:${port}`);
}
