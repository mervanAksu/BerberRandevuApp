import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mediaType } from '../worker.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDirectory = join(root, 'public');

async function collectAssets(directory, prefix = '') {
  const assets = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const pathname = `${prefix}/${entry.name}`;
    const file = join(directory, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      assets.push(...await collectAssets(file, pathname));
    } else if (entry.isFile() && mediaType(pathname)) {
      assets.push([pathname, await readFile(file, 'base64')]);
    }
  }
  return assets;
}

const assets = await collectAssets(publicDirectory);
if (!assets.some(([pathname]) => pathname === '/index.html')) {
  throw new Error('public/index.html bulunamadı.');
}

const stage = await mkdtemp(join(root, '.build-'));
try {
  const server = join(stage, 'server');
  const metadata = join(stage, '.openai');
  await Promise.all([mkdir(server), mkdir(metadata)]);

  const source = await readFile(join(root, 'worker.mjs'), 'utf8');
  const output = `import { processReminders } from './server/reminders.mjs';
${source}
const embeddedAssets = new Map(${JSON.stringify(assets)});

const serve = createBookingApp(pathname => {
  const encoded = embeddedAssets.get(pathname);
  if (encoded === undefined) return null;
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(encoded);
  const decoded = atob(encoded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes;
});
export default {
  fetch(request, env) {
    const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
    const hosted = new URL(request.url).hostname.endsWith('.chatgpt.site');
    const verified = Boolean(hosted && env.OWNER_EMAIL && email === env.OWNER_EMAIL.trim().toLowerCase()
      && request.headers.get('oai-authenticated-user-id'));
    return serve(request, { ...env, OWNER_VERIFIED_BY_PLATFORM: verified });
  },
  async scheduled(controller, env) { await processReminders(env); }
};
`;

  const hosting = readFile(join(root, '.openai', 'hosting.json')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  await Promise.all([
    writeFile(join(server, 'index.js'), output),
    cp(join(root, 'server'), join(server, 'server'), { recursive: true }),
    cp(join(root, 'drizzle'), join(metadata, 'drizzle'), { recursive: true }),
    hosting.then(manifest => manifest && writeFile(join(metadata, 'hosting.json'), manifest)),
  ]);
  const destination = join(root, 'dist');
  await rm(destination, { force: true, recursive: true });
  await rename(stage, destination);
  console.log(`dist/server/index.js hazır (${assets.length} dosya).`);
} finally {
  await rm(stage, { force: true, recursive: true });
}
