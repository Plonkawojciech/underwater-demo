import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`signups\` ADD \`reservation_expires_at\` text;`)
  await db.run(sql`ALTER TABLE \`signups\` ADD \`confirmation_token_hash\` text;`)
  await db.run(sql`ALTER TABLE \`signups\` ADD \`deduplication_key\` text;`)
  await db.run(sql`ALTER TABLE \`signups\` ADD \`email_confirmed_at\` text;`)
  await db.run(sql`CREATE INDEX \`signups_reservation_expires_at_idx\` ON \`signups\` (\`reservation_expires_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`signups_confirmation_token_hash_idx\` ON \`signups\` (\`confirmation_token_hash\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`signups_deduplication_key_idx\` ON \`signups\` (\`deduplication_key\`);`)
}

export async function down(_: MigrateDownArgs): Promise<void> {
  throw new Error('Restore the isolated database backup instead of dropping reservation data.')
}
