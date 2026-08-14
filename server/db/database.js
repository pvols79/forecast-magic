import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

let database;
let activeDatabasePath = config.databasePath;

export const getDatabase = () => {
  if (database) return database;

  fs.mkdirSync(path.dirname(activeDatabasePath), { recursive: true });
  database = new DatabaseSync(activeDatabasePath);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA busy_timeout = 5000');
  return database;
};

export const closeDatabase = () => {
  if (!database) return;
  database.close();
  database = null;
};

export const configureDatabase = databasePath => {
  closeDatabase();
  activeDatabasePath = databasePath;
};

export const withTransaction = (operation) => {
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};
