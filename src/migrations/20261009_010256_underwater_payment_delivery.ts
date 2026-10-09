import { MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`orders\` ADD \`delivery_kind\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`pickup_point_id\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`pickup_point_name\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`pickup_point_address\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`delivery_base_cents\` numeric;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`payment_surcharge_cents\` numeric;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`free_shipping_threshold_cents\` numeric;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`free_shipping_applied\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`payment_method\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`payment_label\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`reservation_minutes\` numeric;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`shipped_at\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`cod_collected_at\` text;`)
  await db.run(sql`ALTER TABLE \`settings_delivery_methods\` ADD \`kind\` text;`)
  await db.run(sql`ALTER TABLE \`settings_delivery_methods\` ADD \`cod_allowed\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`settings\` ADD \`free_shipping_threshold_cents\` numeric;`)
  await db.run(sql`ALTER TABLE \`settings\` ADD \`test_payments_bank_transfer_enabled\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`settings\` ADD \`test_payments_cod_enabled\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`settings\` ADD \`test_payments_offline_reservation_minutes\` numeric;`)
  await db.run(sql`ALTER TABLE \`settings\` ADD \`test_payments_cod_surcharge_cents\` numeric;`)
}

export async function down(): Promise<void> {
  throw new Error('Destructive rollback is disabled. Restore a verified isolated preview backup instead.')
}
