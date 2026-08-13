import { execSync } from 'node:child_process';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '..');

process.loadEnvFile(path.join(rootDir, '.env'));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Add it to .env (see .env.example) before running the integration suite.',
  );
}

// `db push` creates the target database if it does not exist yet and syncs
// schema.prisma to it directly, without needing migration history. That is
// all the integration suite needs from a database it truncates between every
// test, and it means a fresh `melo_test` database is provisioned automatically.
execSync('npx prisma db push --skip-generate --accept-data-loss', {
  cwd: rootDir,
  env: { ...process.env, DATABASE_URL: testDatabaseUrl },
  stdio: 'inherit',
});
