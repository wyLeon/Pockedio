import Database from "better-sqlite3";
import type { PockedioConfig } from "../config/schema.js";

export function openDatabase(config: PockedioConfig): Database.Database {
  const db = new Database(config.paths.database);
  db.pragma("foreign_keys = ON");
  return db;
}

export function withDatabase<T>(config: PockedioConfig, fn: (db: Database.Database) => T): T {
  const db = openDatabase(config);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
