import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { holdingTransaction, writeLease } from '../sqlite-adapter'

// Financial operations use the leased SQLite adapter (src/lib/sqlite-adapter.ts):
// every write transaction in this process, CMS or financial, waits for the
// same per-database lease, and a failed COMMIT rejects instead of being
// reported as success. SQLITE_BUSY can still come from a separate process
// after busy_timeout; the whole transaction is then retried from BEGIN.
export async function transaction<T>(payload: Payload, action: string, run: (req: PayloadRequest) => Promise<T>): Promise<T> {
  writeLease(payload.db)
  for (let attempt = 0; attempt < 8; attempt++) {
    let id: string | undefined
    try {
      const begun = await payload.db.beginTransaction()
      if (begun == null) throw new Error('Transactional database sessions are required.')
      id = String(begun)
      const req = await createLocalReq({ context: { systemAction: action } }, payload)
      req.transactionID = id
      const result = await holdingTransaction(() => run(req))
      if (req.transactionID !== id) throw new Error('Transaction context was lost before commit.')
      await payload.db.commitTransaction(id)
      return result
    } catch (error) {
      if (id) await payload.db.rollbackTransaction(id).catch(() => undefined)
      const busy = /SQLITE_BUSY|database is locked|busy/i.test(error instanceof Error ? error.message : '')
      if (!busy || attempt === 7) throw error
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
  throw new Error('Transaction retry exhausted.')
}
