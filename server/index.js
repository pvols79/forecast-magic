import { createApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';

runMigrations();

createApp().listen(config.port, '0.0.0.0', () => {
  console.log(`Forecast Magic is listening on http://0.0.0.0:${config.port}`);
  console.log(`SQLite database: ${config.databasePath}`);
});
