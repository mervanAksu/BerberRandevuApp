import { readFileSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../worker.mjs', import.meta.url), 'utf8');
const output = new URL('../dist/server/index.js', import.meta.url);
mkdirSync(dirname(output.pathname), { recursive: true });
writeFileSync(output, source.replace("'__INJECT_HTML__'", JSON.stringify(html))
  .replace("'__INJECT_SCRIPT__'", JSON.stringify(script)));
cpSync(new URL('../server/', import.meta.url), new URL('../dist/server/server/', import.meta.url), { recursive: true });
const migrationDir = new URL('../dist/.openai/drizzle/', import.meta.url);
mkdirSync(migrationDir, { recursive: true });
cpSync(new URL('../drizzle/', import.meta.url), migrationDir, { recursive: true });
