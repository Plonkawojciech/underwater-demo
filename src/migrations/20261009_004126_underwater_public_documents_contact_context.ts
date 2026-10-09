import { MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`documents\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text NOT NULL,
    \`legacy_key\` text,
    \`legacy_path\` text,
    \`source_hash\` text,
    \`import_run\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`url\` text,
    \`thumbnail_u_r_l\` text,
    \`filename\` text,
    \`mime_type\` text,
    \`filesize\` numeric,
    \`width\` numeric,
    \`height\` numeric,
    \`focal_x\` numeric,
    \`focal_y\` numeric
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`documents_legacy_key_idx\` ON \`documents\` (\`legacy_key\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`documents_legacy_path_idx\` ON \`documents\` (\`legacy_path\`);`)
  await db.run(sql`CREATE INDEX \`documents_updated_at_idx\` ON \`documents\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`documents_created_at_idx\` ON \`documents\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`documents_filename_idx\` ON \`documents\` (\`filename\`);`)
  await db.run(sql`ALTER TABLE \`contacts\` ADD \`context_kind\` text;`)
  await db.run(sql`ALTER TABLE \`contacts\` ADD \`context_i_d\` numeric;`)
  await db.run(sql`ALTER TABLE \`contacts\` ADD \`context_title\` text;`)
  await db.run(sql`ALTER TABLE \`contacts\` ADD \`context_path\` text;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`documents_id\` integer REFERENCES documents(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_documents_id_idx\` ON \`payload_locked_documents_rels\` (\`documents_id\`);`)
}

export async function down(): Promise<void> {
  throw new Error('Destructive rollback is disabled. Restore a verified isolated backup instead.')
}
