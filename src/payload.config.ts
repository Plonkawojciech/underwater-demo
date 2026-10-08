import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { pl } from '@payloadcms/translations/languages/pl'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { captureEmail } from './lib/email-capture'
import { validateEnvironment } from './lib/environment'
import { leasedSqliteAdapter } from './lib/sqlite-adapter'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Categories } from './collections/Categories'
import { Products } from './collections/Products'
import { Courses } from './collections/Courses'
import { Signups } from './collections/Signups'
import { Orders } from './collections/Orders'
import { Settings } from './globals/Settings'
import { Pages } from './collections/Pages'
import { Trips } from './collections/Trips'
import { Albums } from './collections/Albums'
import { Events } from './collections/Events'
import { CourseSessions } from './collections/CourseSessions'
import { PaymentAttempts } from './collections/PaymentAttempts'
import { PaymentEvents } from './collections/PaymentEvents'
import { Outbox } from './collections/Outbox'
import { Contacts } from './collections/Contacts'
import { Newsletter } from './collections/Newsletter'
import { Redirects } from './collections/Redirects'
import { AuditEvents } from './collections/AuditEvents'
import { ImportRuns } from './collections/ImportRuns'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const runtime = validateEnvironment(process.env)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: ' · Underwater.pl CMS' },
    components: { graphics: { Logo: '@/components/admin/Logo', Icon: '@/components/admin/Icon' } },
  },
  i18n: { supportedLanguages: { pl }, fallbackLanguage: 'pl' },
  collections: [Products, Categories, Courses, CourseSessions, Pages, Trips, Albums, Events, Signups, Orders, PaymentAttempts, PaymentEvents, Outbox, Contacts, Newsletter, Redirects, ImportRuns, AuditEvents, Media, Users],
  globals: [Settings],
  editor: lexicalEditor(),
  secret: runtime.secret,
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: leasedSqliteAdapter({
    client: { url: runtime.databaseURI },
    migrationDir: path.resolve(dirname, 'migrations'),
    push: false,
    transactionOptions: { behavior: 'immediate' },
    busyTimeout: 5000,
    wal: { synchronous: 'FULL' },
  }),
  sharp,
  email: captureEmail,
  upload: { limits: { fileSize: 12 * 1024 * 1024 }, abortOnLimit: true },
  serverURL: runtime.serverURL,
  cors: [runtime.serverURL],
  csrf: [runtime.serverURL],
})
