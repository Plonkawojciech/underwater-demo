import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` ADD \`reset_password_requested_at\` text;`)
}

export async function down(_: MigrateDownArgs): Promise<void> {
  throw new Error('Restore the isolated backup instead of removing authentication security data.')
}
