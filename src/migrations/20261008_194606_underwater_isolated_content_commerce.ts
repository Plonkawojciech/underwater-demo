import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`course_sessions\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text NOT NULL,
    \`course_id\` integer NOT NULL,
    \`starts_at\` text NOT NULL,
    \`ends_at\` text,
    \`location\` text,
    \`price_cents\` numeric,
    \`capacity\` numeric,
    \`reserved\` numeric DEFAULT 0,
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
    FOREIGN KEY (\`course_id\`) REFERENCES \`courses\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`seo_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`course_sessions_course_idx\` ON \`course_sessions\` (\`course_id\`);`)
  await db.run(sql`CREATE INDEX \`course_sessions_starts_at_idx\` ON \`course_sessions\` (\`starts_at\`);`)
  await db.run(sql`CREATE INDEX \`course_sessions_published_idx\` ON \`course_sessions\` (\`published\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`course_sessions_legacy_key_idx\` ON \`course_sessions\` (\`legacy_key\`);`)
  await db.run(sql`CREATE INDEX \`course_sessions_legacy_path_idx\` ON \`course_sessions\` (\`legacy_path\`);`)
  await db.run(sql`CREATE INDEX \`course_sessions_seo_seo_image_idx\` ON \`course_sessions\` (\`seo_image_id\`);`)
  await db.run(sql`CREATE INDEX \`course_sessions_updated_at_idx\` ON \`course_sessions\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`course_sessions_created_at_idx\` ON \`course_sessions\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`pages\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text NOT NULL,
    \`path\` text NOT NULL,
    \`kind\` text NOT NULL,
    \`lead\` text,
    \`body\` text,
    \`image_id\` integer,
    \`album_id\` integer,
    \`published_at\` text,
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
    FOREIGN KEY (\`image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`album_id\`) REFERENCES \`albums\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`seo_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`pages_path_idx\` ON \`pages\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`pages_image_idx\` ON \`pages\` (\`image_id\`);`)
  await db.run(sql`CREATE INDEX \`pages_album_idx\` ON \`pages\` (\`album_id\`);`)
  await db.run(sql`CREATE INDEX \`pages_published_idx\` ON \`pages\` (\`published\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`pages_legacy_key_idx\` ON \`pages\` (\`legacy_key\`);`)
  await db.run(sql`CREATE INDEX \`pages_legacy_path_idx\` ON \`pages\` (\`legacy_path\`);`)
  await db.run(sql`CREATE INDEX \`pages_seo_seo_image_idx\` ON \`pages\` (\`seo_image_id\`);`)
  await db.run(sql`CREATE INDEX \`pages_updated_at_idx\` ON \`pages\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`pages_created_at_idx\` ON \`pages\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`trips\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text NOT NULL,
    \`path\` text NOT NULL,
    \`location\` text,
    \`starts_at\` text,
    \`ends_at\` text,
    \`price_cents\` numeric,
    \`lead\` text,
    \`body\` text,
    \`image_id\` integer,
    \`album_id\` integer,
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
    FOREIGN KEY (\`image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`album_id\`) REFERENCES \`albums\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`seo_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`trips_path_idx\` ON \`trips\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`trips_image_idx\` ON \`trips\` (\`image_id\`);`)
  await db.run(sql`CREATE INDEX \`trips_album_idx\` ON \`trips\` (\`album_id\`);`)
  await db.run(sql`CREATE INDEX \`trips_published_idx\` ON \`trips\` (\`published\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`trips_legacy_key_idx\` ON \`trips\` (\`legacy_key\`);`)
  await db.run(sql`CREATE INDEX \`trips_legacy_path_idx\` ON \`trips\` (\`legacy_path\`);`)
  await db.run(sql`CREATE INDEX \`trips_seo_seo_image_idx\` ON \`trips\` (\`seo_image_id\`);`)
  await db.run(sql`CREATE INDEX \`trips_updated_at_idx\` ON \`trips\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`trips_created_at_idx\` ON \`trips\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`albums_photos\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`image_id\` integer NOT NULL,
    \`caption\` text,
    FOREIGN KEY (\`image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`albums\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`albums_photos_order_idx\` ON \`albums_photos\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`albums_photos_parent_id_idx\` ON \`albums_photos\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`albums_photos_image_idx\` ON \`albums_photos\` (\`image_id\`);`)
  await db.run(sql`CREATE TABLE \`albums\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text NOT NULL,
    \`path\` text NOT NULL,
    \`description\` text,
    \`date\` text,
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
  await db.run(sql`CREATE UNIQUE INDEX \`albums_path_idx\` ON \`albums\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`albums_published_idx\` ON \`albums\` (\`published\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`albums_legacy_key_idx\` ON \`albums\` (\`legacy_key\`);`)
  await db.run(sql`CREATE INDEX \`albums_legacy_path_idx\` ON \`albums\` (\`legacy_path\`);`)
  await db.run(sql`CREATE INDEX \`albums_seo_seo_image_idx\` ON \`albums\` (\`seo_image_id\`);`)
  await db.run(sql`CREATE INDEX \`albums_updated_at_idx\` ON \`albums\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`albums_created_at_idx\` ON \`albums\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`events\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text NOT NULL,
    \`starts_at\` text NOT NULL,
    \`ends_at\` text,
    \`location\` text,
    \`path\` text,
    \`body\` text,
    \`course_session_id\` integer,
    \`trip_id\` integer,
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
    FOREIGN KEY (\`course_session_id\`) REFERENCES \`course_sessions\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`trip_id\`) REFERENCES \`trips\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`seo_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`events_starts_at_idx\` ON \`events\` (\`starts_at\`);`)
  await db.run(sql`CREATE INDEX \`events_course_session_idx\` ON \`events\` (\`course_session_id\`);`)
  await db.run(sql`CREATE INDEX \`events_trip_idx\` ON \`events\` (\`trip_id\`);`)
  await db.run(sql`CREATE INDEX \`events_published_idx\` ON \`events\` (\`published\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`events_legacy_key_idx\` ON \`events\` (\`legacy_key\`);`)
  await db.run(sql`CREATE INDEX \`events_legacy_path_idx\` ON \`events\` (\`legacy_path\`);`)
  await db.run(sql`CREATE INDEX \`events_seo_seo_image_idx\` ON \`events\` (\`seo_image_id\`);`)
  await db.run(sql`CREATE INDEX \`events_updated_at_idx\` ON \`events\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`events_created_at_idx\` ON \`events\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payment_attempts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order_id\` integer NOT NULL,
    \`provider\` text NOT NULL,
    \`reference\` text,
    \`amount_cents\` numeric,
    \`currency\` text DEFAULT 'PLN',
    \`status\` text DEFAULT 'pending',
    \`expires_at\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`order_id\`) REFERENCES \`orders\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`payment_attempts_order_idx\` ON \`payment_attempts\` (\`order_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`payment_attempts_reference_idx\` ON \`payment_attempts\` (\`reference\`);`)
  await db.run(sql`CREATE INDEX \`payment_attempts_updated_at_idx\` ON \`payment_attempts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payment_attempts_created_at_idx\` ON \`payment_attempts\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payment_events\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`event_key\` text,
    \`attempt_id\` integer NOT NULL,
    \`digest\` text,
    \`outcome\` text NOT NULL,
    \`accepted\` integer DEFAULT false,
    \`reason\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`attempt_id\`) REFERENCES \`payment_attempts\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payment_events_event_key_idx\` ON \`payment_events\` (\`event_key\`);`)
  await db.run(sql`CREATE INDEX \`payment_events_attempt_idx\` ON \`payment_events\` (\`attempt_id\`);`)
  await db.run(sql`CREATE INDEX \`payment_events_updated_at_idx\` ON \`payment_events\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payment_events_created_at_idx\` ON \`payment_events\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`outbox\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`deduplication_key\` text NOT NULL,
    \`recipient\` text NOT NULL,
    \`subject\` text NOT NULL,
    \`body\` text NOT NULL,
    \`status\` text DEFAULT 'captured',
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`outbox_deduplication_key_idx\` ON \`outbox\` (\`deduplication_key\`);`)
  await db.run(sql`CREATE INDEX \`outbox_updated_at_idx\` ON \`outbox\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`outbox_created_at_idx\` ON \`outbox\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`contacts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`name\` text NOT NULL,
    \`email\` text NOT NULL,
    \`phone\` text,
    \`message\` text NOT NULL,
    \`privacy_accepted\` integer DEFAULT false NOT NULL,
    \`consent_version\` text,
    \`status\` text DEFAULT 'new',
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`contacts_updated_at_idx\` ON \`contacts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`contacts_created_at_idx\` ON \`contacts\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`newsletter\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`email\` text NOT NULL,
    \`status\` text DEFAULT 'pending',
    \`confirmation_token_hash\` text,
    \`unsubscribe_token_hash\` text,
    \`confirmation_expires_at\` text,
    \`confirmed_at\` text,
    \`unsubscribed_at\` text,
    \`consent_version\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`newsletter_email_idx\` ON \`newsletter\` (\`email\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`newsletter_confirmation_token_hash_idx\` ON \`newsletter\` (\`confirmation_token_hash\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`newsletter_unsubscribe_token_hash_idx\` ON \`newsletter\` (\`unsubscribe_token_hash\`);`)
  await db.run(sql`CREATE INDEX \`newsletter_updated_at_idx\` ON \`newsletter\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`newsletter_created_at_idx\` ON \`newsletter\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`settings_delivery_methods\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`label\` text NOT NULL,
    \`price_cents\` numeric NOT NULL,
    \`enabled\` integer DEFAULT false,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`settings\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`settings_delivery_methods_order_idx\` ON \`settings_delivery_methods\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`settings_delivery_methods_parent_id_idx\` ON \`settings_delivery_methods\` (\`_parent_id\`);`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`sku\` text;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`price_cents\` numeric;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`sale_price_cents\` numeric;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`tax_rate\` numeric;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`body\` text;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`published\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`legacy_key\` text;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`source_hash\` text;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`import_run\` text;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`imported_at\` text;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`source_updated_at\` text;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`legacy_path\` text;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`seo_title\` text;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`seo_description\` text;`)
  await db.run(sql`ALTER TABLE \`products\` ADD \`seo_image_id\` integer REFERENCES media(id);`)
  await db.run(sql`ALTER TABLE \`orders_items\` ADD \`product_name\` text NOT NULL DEFAULT '';`)
  await db.run(sql`ALTER TABLE \`orders_items\` ADD \`sku\` text;`)
  await db.run(sql`ALTER TABLE \`orders_items\` ADD \`variant_id\` text;`)
  await db.run(sql`ALTER TABLE \`orders_items\` ADD \`unit_price_cents\` numeric NOT NULL DEFAULT 0;`)
  await db.run(sql`ALTER TABLE \`orders_items\` ADD \`line_total_cents\` numeric NOT NULL DEFAULT 0;`)
  await db.run(sql`ALTER TABLE \`orders_items\` ADD \`tax_rate\` numeric;`)
  await db.run(sql`CREATE INDEX products_sku_idx ON products(sku);`)
  await db.run(sql`CREATE INDEX products_published_idx ON products(published);`)
  await db.run(sql`CREATE UNIQUE INDEX products_legacy_key_idx ON products(legacy_key);`)
  await db.run(sql`CREATE INDEX products_legacy_path_idx ON products(legacy_path);`)
  await db.run(sql`CREATE INDEX products_seo_seo_image_idx ON products(seo_image_id);`)
  await db.run(sql`UPDATE orders_items SET product_name = COALESCE((SELECT name FROM products WHERE products.id = orders_items.product_id), 'Produkt #' || product_id), unit_price_cents = ROUND(price * 100), line_total_cents = ROUND(price * 100) * qty;`)
  await db.run(sql`ALTER TABLE \`products_variants\` ADD \`sku\` text;`)
  await db.run(sql`ALTER TABLE \`products_variants\` ADD \`legacy_key\` text;`)
  await db.run(sql`ALTER TABLE \`products_variants\` ADD \`price_cents\` numeric;`)
  await db.run(sql`ALTER TABLE \`products_rels\` ADD \`categories_id\` integer REFERENCES categories(id);`)
  await db.run(sql`CREATE INDEX \`products_rels_categories_id_idx\` ON \`products_rels\` (\`categories_id\`);`)
  await db.run(sql`ALTER TABLE \`categories\` ADD \`published\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`categories\` ADD \`legacy_key\` text;`)
  await db.run(sql`ALTER TABLE \`categories\` ADD \`source_hash\` text;`)
  await db.run(sql`ALTER TABLE \`categories\` ADD \`import_run\` text;`)
  await db.run(sql`ALTER TABLE \`categories\` ADD \`imported_at\` text;`)
  await db.run(sql`ALTER TABLE \`categories\` ADD \`source_updated_at\` text;`)
  await db.run(sql`ALTER TABLE \`categories\` ADD \`legacy_path\` text;`)
  await db.run(sql`ALTER TABLE \`categories\` ADD \`seo_title\` text;`)
  await db.run(sql`ALTER TABLE \`categories\` ADD \`seo_description\` text;`)
  await db.run(sql`ALTER TABLE \`categories\` ADD \`seo_image_id\` integer REFERENCES media(id);`)
  await db.run(sql`CREATE INDEX \`categories_published_idx\` ON \`categories\` (\`published\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`categories_legacy_key_idx\` ON \`categories\` (\`legacy_key\`);`)
  await db.run(sql`CREATE INDEX \`categories_legacy_path_idx\` ON \`categories\` (\`legacy_path\`);`)
  await db.run(sql`CREATE INDEX \`categories_seo_seo_image_idx\` ON \`categories\` (\`seo_image_id\`);`)
  await db.run(sql`ALTER TABLE \`courses\` ADD \`body\` text;`)
  await db.run(sql`ALTER TABLE \`courses\` ADD \`published\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`courses\` ADD \`legacy_key\` text;`)
  await db.run(sql`ALTER TABLE \`courses\` ADD \`source_hash\` text;`)
  await db.run(sql`ALTER TABLE \`courses\` ADD \`import_run\` text;`)
  await db.run(sql`ALTER TABLE \`courses\` ADD \`imported_at\` text;`)
  await db.run(sql`ALTER TABLE \`courses\` ADD \`source_updated_at\` text;`)
  await db.run(sql`ALTER TABLE \`courses\` ADD \`legacy_path\` text;`)
  await db.run(sql`ALTER TABLE \`courses\` ADD \`seo_title\` text;`)
  await db.run(sql`ALTER TABLE \`courses\` ADD \`seo_description\` text;`)
  await db.run(sql`ALTER TABLE \`courses\` ADD \`seo_image_id\` integer REFERENCES media(id);`)
  await db.run(sql`CREATE INDEX \`courses_published_idx\` ON \`courses\` (\`published\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`courses_legacy_key_idx\` ON \`courses\` (\`legacy_key\`);`)
  await db.run(sql`CREATE INDEX \`courses_legacy_path_idx\` ON \`courses\` (\`legacy_path\`);`)
  await db.run(sql`CREATE INDEX \`courses_seo_seo_image_idx\` ON \`courses\` (\`seo_image_id\`);`)
  await db.run(sql`ALTER TABLE \`signups\` ADD \`session_id\` integer REFERENCES course_sessions(id);`)
  await db.run(sql`ALTER TABLE \`signups\` ADD \`privacy_accepted\` integer DEFAULT false NOT NULL;`)
  await db.run(sql`ALTER TABLE \`signups\` ADD \`consent_version\` text;`)
  await db.run(sql`ALTER TABLE \`signups\` ADD \`reservation_released\` integer DEFAULT false;`)
  await db.run(sql`CREATE INDEX \`signups_session_idx\` ON \`signups\` (\`session_id\`);`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`subtotal_cents\` numeric;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`delivery_cents\` numeric;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`total_cents\` numeric;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`currency\` text DEFAULT 'PLN';`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`delivery_method\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`delivery_label\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`payment_status\` text DEFAULT 'pending';`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`stock_released\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`idempotency_key\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`fingerprint\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`access_token_hash\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`expires_at\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`paid_at\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`privacy_accepted\` integer DEFAULT false NOT NULL;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`terms_accepted\` integer DEFAULT false NOT NULL;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`consent_version\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`mode\` text DEFAULT 'test';`)
  await db.run(sql`CREATE UNIQUE INDEX \`orders_idempotency_key_idx\` ON \`orders\` (\`idempotency_key\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`orders_access_token_hash_idx\` ON \`orders\` (\`access_token_hash\`);`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`role\` text DEFAULT 'editor' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`course_sessions_id\` integer REFERENCES course_sessions(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`pages_id\` integer REFERENCES pages(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`trips_id\` integer REFERENCES trips(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`albums_id\` integer REFERENCES albums(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`events_id\` integer REFERENCES events(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`payment_attempts_id\` integer REFERENCES payment_attempts(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`payment_events_id\` integer REFERENCES payment_events(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`outbox_id\` integer REFERENCES outbox(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`contacts_id\` integer REFERENCES contacts(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`newsletter_id\` integer REFERENCES newsletter(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_course_sessions_id_idx\` ON \`payload_locked_documents_rels\` (\`course_sessions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_pages_id_idx\` ON \`payload_locked_documents_rels\` (\`pages_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_trips_id_idx\` ON \`payload_locked_documents_rels\` (\`trips_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_albums_id_idx\` ON \`payload_locked_documents_rels\` (\`albums_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_events_id_idx\` ON \`payload_locked_documents_rels\` (\`events_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payment_attempts_id_idx\` ON \`payload_locked_documents_rels\` (\`payment_attempts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payment_events_id_idx\` ON \`payload_locked_documents_rels\` (\`payment_events_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_outbox_id_idx\` ON \`payload_locked_documents_rels\` (\`outbox_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_contacts_id_idx\` ON \`payload_locked_documents_rels\` (\`contacts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_newsletter_id_idx\` ON \`payload_locked_documents_rels\` (\`newsletter_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('This additive migration must not be rolled back by deleting content. Restore a verified isolated backup instead.');
}
