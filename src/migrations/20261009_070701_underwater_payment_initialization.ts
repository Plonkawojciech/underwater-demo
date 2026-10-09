import { MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`payment_attempts\` ADD \`initialization\` text;`)
  await db.run(sql`ALTER TABLE \`payment_attempts\` ADD \`payment_url\` text;`)
  await db.run(sql`ALTER TABLE \`payment_attempts\` ADD \`initialization_lease\` text;`)
  await db.run(sql`ALTER TABLE \`payment_attempts\` ADD \`initialization_lease_until\` text;`)
  await db.run(sql`ALTER TABLE \`payment_attempts\` ADD \`initialization_key\` text;`)
  await db.run(sql`ALTER TABLE \`payment_attempts\` ADD \`provider_reference\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`payment_attempts_initialization_key_idx\` ON \`payment_attempts\` (\`initialization_key\`);`)
  await db.run(sql`CREATE INDEX \`payment_attempts_provider_reference_idx\` ON \`payment_attempts\` (\`provider_reference\`);`)
}

export async function down(): Promise<void> {
  throw new Error('This additive migration has no destructive rollback. Restore a verified preview backup instead.')
}
