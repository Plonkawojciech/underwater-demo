import { getPayload, generateImportMap } from 'payload'
import { generateTypes } from 'payload/node'
import config from '../../src/payload.config'

const payload = await getPayload({ config, disableOnInit: true })
try {
  const command = process.argv[2]
  if (command === 'import-map') await generateImportMap(payload.config, { log: true, force: true })
  else if (command === 'types') await generateTypes(payload.config)
  else if (command === 'create') await payload.db.createMigration({ migrationName: process.argv[3] || 'underwater_isolated_content_commerce', skipEmpty: true, payload })
  else if (command === 'migrate') await payload.db.migrate()
  else throw new Error('Use create, migrate, import-map or types.')
} finally { await payload.destroy() }
