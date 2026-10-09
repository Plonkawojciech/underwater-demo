import { MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`pages_listing_missing\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`title\` text,
    \`legacy_path\` text,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`pages_listing_missing_order_idx\` ON \`pages_listing_missing\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`pages_listing_missing_parent_id_idx\` ON \`pages_listing_missing\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`pages_listing_links\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`label\` text,
    \`path\` text,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`pages_listing_links_order_idx\` ON \`pages_listing_links\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`pages_listing_links_parent_id_idx\` ON \`pages_listing_links\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`pages_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`products_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`products_id\`) REFERENCES \`products\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`pages_rels_order_idx\` ON \`pages_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`pages_rels_parent_idx\` ON \`pages_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`pages_rels_path_idx\` ON \`pages_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`pages_rels_products_id_idx\` ON \`pages_rels\` (\`products_id\`);`)
  await db.run(sql`ALTER TABLE \`pages\` ADD \`listing\` integer;`)
  await db.run(sql`ALTER TABLE \`pages\` ADD \`listing_category_id\` integer REFERENCES categories(id);`)
  await db.run(sql`ALTER TABLE \`pages\` ADD \`listing_from\` numeric;`)
  await db.run(sql`ALTER TABLE \`pages\` ADD \`listing_to\` numeric;`)
  await db.run(sql`ALTER TABLE \`pages\` ADD \`listing_total\` numeric;`)
  await db.run(sql`CREATE INDEX \`pages_listing_category_idx\` ON \`pages\` (\`listing_category_id\`);`)
}

export async function down(): Promise<void> {
  throw new Error('This additive migration has no destructive rollback. Restore a verified preview backup instead.')
}
