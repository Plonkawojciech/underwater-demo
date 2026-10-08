import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`redirects\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`from\` text NOT NULL,
    \`to\` text NOT NULL,
    \`reason\` text,
    \`published\` integer DEFAULT false,
    \`legacy_key\` text,
    \`source_hash\` text,
    \`import_run\` text,
    \`imported_at\` text,
    \`source_updated_at\` text,
    \`legacy_path\` text,
    \`seo_title\` text,
    \`seo_description\` text,
    \`seo_image_id\` integer,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`seo_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`redirects_from_idx\` ON \`redirects\` (\`from\`);`)
  await db.run(sql`CREATE INDEX \`redirects_published_idx\` ON \`redirects\` (\`published\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`redirects_legacy_key_idx\` ON \`redirects\` (\`legacy_key\`);`)
  await db.run(sql`CREATE INDEX \`redirects_legacy_path_idx\` ON \`redirects\` (\`legacy_path\`);`)
  await db.run(sql`CREATE INDEX \`redirects_seo_seo_image_idx\` ON \`redirects\` (\`seo_image_id\`);`)
  await db.run(sql`CREATE INDEX \`redirects_updated_at_idx\` ON \`redirects\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`redirects_created_at_idx\` ON \`redirects\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`import_runs\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`run_key\` text NOT NULL,
    \`source_manifest_hash\` text NOT NULL,
    \`status\` text DEFAULT 'running',
    \`source_type\` text,
    \`counts\` text,
    \`unresolved\` text,
    \`finished_at\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`import_runs_run_key_idx\` ON \`import_runs\` (\`run_key\`);`)
  await db.run(sql`CREATE INDEX \`import_runs_updated_at_idx\` ON \`import_runs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`import_runs_created_at_idx\` ON \`import_runs\` (\`created_at\`);`)
  await db.run(sql`ALTER TABLE \`media\` ADD \`legacy_key\` text;`)
  await db.run(sql`ALTER TABLE \`media\` ADD \`source_hash\` text;`)
  await db.run(sql`ALTER TABLE \`media\` ADD \`import_run\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_legacy_key_idx\` ON \`media\` (\`legacy_key\`);`)
  await db.run(sql`CREATE INDEX \`media_source_hash_idx\` ON \`media\` (\`source_hash\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`redirects_id\` integer REFERENCES redirects(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`import_runs_id\` integer REFERENCES import_runs(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_redirects_id_idx\` ON \`payload_locked_documents_rels\` (\`redirects_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_import_runs_id_idx\` ON \`payload_locked_documents_rels\` (\`import_runs_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('This additive migration must not remove imported content. Restore a verified isolated backup instead.');
}
