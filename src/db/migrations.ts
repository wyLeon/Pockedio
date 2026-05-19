import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { PockedioConfig } from "../config/schema.js";

export const schemaVersion = 5;

function schemaPath(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "schema.sql");
}

export function runMigrations(config: PockedioConfig): void {
  fs.mkdirSync(path.dirname(config.paths.database), { recursive: true });
  const db = new Database(config.paths.database);
  try {
    db.pragma("foreign_keys = ON");
    const schema = fs.readFileSync(schemaPath(), "utf8");
    db.exec(schema);
    db.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES ('schema_version', json(?), ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(schemaVersion), new Date().toISOString());
  } finally {
    db.close();
  }
}
