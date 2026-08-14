import { getDatabase } from '../db/database.js';

export class SettingsRepository {
  get(key) {
    return getDatabase().prepare(
      'SELECT value FROM application_settings WHERE key = ?'
    ).get(key)?.value ?? null;
  }

  set(key, value) {
    getDatabase().prepare(`
      INSERT INTO application_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, String(value), new Date().toISOString());
  }

  delete(key) {
    getDatabase().prepare('DELETE FROM application_settings WHERE key = ?').run(key);
  }
}
