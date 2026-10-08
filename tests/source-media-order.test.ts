import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('download order preserves source product/album/body order and each caption', () => {
  const entities = [
    { collection: 'products', key: 'product', data: {} },
    { collection: 'albums', key: 'a', data: {} },
    { collection: 'albums', key: 'b', data: {} },
    { collection: 'courses', key: 'course', data: {} },
  ]
  const target = (collection: string, key: string, field: string, order: number, caption?: string) => ({ collection, key, field, order, ...(caption === undefined ? {} : { caption }) })
  const rows = [
    { key: 'alphabet-first', targets: [target('products', 'product', 'images', 1), target('albums', 'a', 'photos', 1, 'Drugie zdjęcie'), target('courses', 'course', 'body', 1)] },
    { key: 'source-first', targets: [target('products', 'product', 'images', 0), target('albums', 'a', 'photos', 0, 'Pierwsze zdjęcie'), target('albums', 'b', 'photos', 0, ''), target('courses', 'course', 'body', 0)] },
  ]
  const result = spawnSync('python3', ['-c', "import sys,json;sys.path.insert(0,'scripts/source');from bundle_media import attach_media;data=json.load(sys.stdin);attach_media(data['bundle'],data['rows']);print(json.dumps(data['bundle']))"], {
    input: JSON.stringify({ bundle: { media: rows.map(row => ({ key: row.key })), entities }, rows }),
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout).entities
  assert.deepEqual(output[0].relations.images, ['media:source-first', 'media:alphabet-first'])
  assert.deepEqual(output[1].data.photos, [{ image: 'media:source-first', caption: 'Pierwsze zdjęcie' }, { image: 'media:alphabet-first', caption: 'Drugie zdjęcie' }])
  assert.equal(output[2].data.photos[0].caption, '')
  assert.equal(output[3].relations.image, 'media:source-first')
})
