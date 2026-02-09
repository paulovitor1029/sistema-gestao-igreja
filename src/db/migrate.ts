import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { pool } from "./pool";

type Migration = {
  version: string;
  sql: string;
  checksum: string;
};

function getChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function loadMigrations(): Promise<Migration[]> {
  const migrationsDir = path.resolve(process.cwd(), "db", "migrations");
  const files = await fs.readdir(migrationsDir);

  const sqlFiles = files.filter((file) => file.endsWith(".sql")).sort();
  const migrations = await Promise.all(
    sqlFiles.map(async (file) => {
      const filePath = path.resolve(migrationsDir, file);
      const sql = await fs.readFile(filePath, "utf8");

      return {
        version: file,
        sql,
        checksum: getChecksum(sql)
      };
    })
  );

  return migrations;
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const migrations = await loadMigrations();

  const appliedResult = await pool.query<{ version: string; checksum: string }>(
    "SELECT version, checksum FROM schema_migrations;"
  );

  const applied = new Map(
    appliedResult.rows.map((row) => [row.version, row.checksum])
  );

  for (const migration of migrations) {
    const appliedChecksum = applied.get(migration.version);

    if (appliedChecksum) {
      if (appliedChecksum !== migration.checksum) {
        throw new Error(
          `Migration checksum mismatch: ${migration.version}. ` +
            "Do not edit migrations already applied."
        );
      }

      console.log(`- skip ${migration.version}`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN;");
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2);",
        [migration.version, migration.checksum]
      );
      await client.query("COMMIT;");
      console.log(`+ applied ${migration.version}`);
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  }
}

run()
  .then(async () => {
    await pool.end();
    console.log("Migrations completed.");
  })
  .catch(async (error: unknown) => {
    await pool.end();
    console.error("Migration failed.", error);
    process.exitCode = 1;
  });
