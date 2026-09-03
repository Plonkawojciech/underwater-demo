import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { pl } from '@payloadcms/translations/languages/pl'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Categories } from './collections/Categories'
import { Products } from './collections/Products'
import { Courses } from './collections/Courses'
import { Trips } from './collections/Trips'
import { Posts } from './collections/Posts'
import { Signups } from './collections/Signups'
import { Orders } from './collections/Orders'
import { Settings } from './globals/Settings'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: ' · Underwater.pl CMS' },
  },
  i18n: { supportedLanguages: { pl }, fallbackLanguage: 'pl' },
  collections: [Products, Categories, Courses, Trips, Posts, Signups, Orders, Media, Users],
  globals: [Settings],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'dev-secret',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: sqliteAdapter({
    client: { url: process.env.DATABASE_URI || 'file:./payload.db' },
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  sharp,
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL,
})
