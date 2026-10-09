import { MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`products\` ADD \`search_text\` text;`)
  // SQLite's built-in lower() does not fold Polish letters. Preserve all source
  // fields and backfill only the derived index using the same Unicode rules.
  const rows = await db.all<{ id: number; name: string; manufacturer: string | null; sku: string | null }>(sql`SELECT id, name, manufacturer, sku FROM products`)
  for (const row of rows) {
    const text = [row.name, row.manufacturer, row.sku].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase('pl-PL').replace(/\s+/g, ' ').trim()
    await db.run(sql`UPDATE products SET search_text = ${text} WHERE id = ${row.id}`)
  }
}

export async function down(): Promise<void> {
  throw new Error('Destructive rollback is disabled. Restore a verified isolated preview backup instead.')
}
