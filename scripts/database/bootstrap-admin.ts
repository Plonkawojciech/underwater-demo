import { getPayload } from 'payload'
import config from '../../src/payload.config'
const password = process.env.UNDERWATER_ADMIN_PASSWORD
const address = process.env.UNDERWATER_ADMIN_EMAIL
if (!password || password.length < 24 || !address) throw new Error('Supply a private bootstrap credential through the environment.')
const payload = await getPayload({ config, disableOnInit: true })
try {
  const admins = await payload.count({ collection: 'users', where: { role: { equals: 'admin' } }, overrideAccess: true })
  if (admins.totalDocs) throw new Error('An administrator already exists; bootstrap will not modify existing users.')
  await payload.create({ collection: 'users', context: { systemAction: 'bootstrap-admin' }, overrideAccess: true, data: { email: address, password, name: 'Administrator podglądu', role: 'admin' } })
  console.log('Private preview administrator created. Credential values were not printed.')
} finally { await payload.destroy() }
