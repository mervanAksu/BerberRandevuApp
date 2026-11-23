import { createHash } from 'node:crypto';
import { chmodSync, closeSync, constants, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const migrationDirectory = new URL('../drizzle/', import.meta.url);
const defaultDatabase = fileURLToPath(new URL('../data/bookings.sqlite', import.meta.url));

function applyMigrations(database) {
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', migrationDirectory), 'utf8'));
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS local_schema_migrations (
      tag TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL
    )`);
    const migrationHash = database.prepare('SELECT sha256 FROM local_schema_migrations WHERE tag = ?');
    const recordMigration = database.prepare('INSERT INTO local_schema_migrations (tag, sha256) VALUES (?, ?)');
    for (const { tag } of journal.entries) {
      if (!/^\d+_[a-z\d_]+$/.test(tag)) throw new Error('Geçersiz veritabanı geçiş adı.');
      const sql = readFileSync(new URL(`${tag}.sql`, migrationDirectory), 'utf8');
      const sha256 = createHash('sha256').update(sql).digest('hex');
      const installed = migrationHash.get(tag);
      if (installed && installed.sha256 !== sha256) {
        throw new Error(`Uygulanmış veritabanı geçişi değiştirildi (${tag}).`);
      }
      if (!installed) {
        database.exec(sql);
        recordMigration.run(tag, sha256);
      }
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

class LocalD1Statement {
  constructor(statement, values = []) {
    this.statement = statement;
    this.values = values;
  }

  bind(...values) {
    return new LocalD1Statement(this.statement, values);
  }

  async first(columnName) {
    const row = this.statement.get(...this.values);
    if (row === undefined) return null;
    if (columnName === undefined) return row;
    if (!Object.hasOwn(row, columnName)) throw new Error(`Sütun bulunamadı (${columnName}).`);
    return row[columnName];
  }

  async all() {
    return { success: true, results: this.statement.all(...this.values) };
  }

  async run() {
    const result = this.statement.run(...this.values);
    return { success: true, results: [], meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
  }
}

export function openBookingDatabase(file = process.env.BOOKING_DATABASE || defaultDatabase) {
  const databasePath = file === ':memory:' ? file : resolve(file);
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    const flags = constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0);
    const fd = openSync(databasePath, flags, 0o600);
    closeSync(fd);
    chmodSync(databasePath, 0o600);
  }

  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    applyMigrations(database);
  } catch (error) {
    database.close();
    throw error;
  }

  return {
    prepare: sql => new LocalD1Statement(database.prepare(sql)),
    close: () => database.close(),
  };
}
