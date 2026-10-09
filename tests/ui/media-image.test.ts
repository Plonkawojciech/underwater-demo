import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MediaImage, mediaImageProps } from '../../src/components/MediaImage'

const media = {
  url: '/api/media/file/original.jpg', width: 1920, height: 1280,
  sizes: {
    thumb: { url: '/api/media/file/small.jpg', width: 480, height: 320 },
    card: { url: '/api/media/file/card.jpg', width: 960, height: 640 },
  },
}

test('responsive media uses actual derivative dimensions and does not request the original', () => {
  const props = mediaImageProps(media)
  assert.equal(props.src, '/api/media/file/card.jpg')
  assert.equal(props.srcSet, '/api/media/file/small.jpg 480w, /api/media/file/card.jpg 960w')
  assert.equal(props.width, 1920)
  assert.equal(props.height, 1280)
  assert.doesNotMatch(props.srcSet!, /original/)
})

test('older media without derivative metadata renders one ordinary image without guessed descriptors', () => {
  assert.deepEqual(mediaImageProps({ url: '/api/media/file/old.jpg' }), {
    src: '/api/media/file/old.jpg', srcSet: undefined, width: undefined, height: undefined,
  })
  const duplicate = { ...media, sizes: { thumb: media.sizes.thumb, card: media.sizes.thumb } }
  assert.equal(mediaImageProps(duplicate).srcSet, undefined)
  const small = { ...media, sizes: { thumb: media.sizes.thumb, card: { ...media.sizes.card, width: 480 } } }
  assert.equal(mediaImageProps(small).srcSet, undefined, 'two files with the same width cannot repeat the width descriptor')
})

test('invalid asset and dimension metadata never reaches a responsive source descriptor', () => {
  const invalid = {
    url: 'javascript:alert(1)', width: -1, height: Number.NaN,
    sizes: { thumb: { url: 'data:image/png;base64,abcd', width: 480 }, card: { url: '/api/media/file/name with spaces.jpg', width: Number.POSITIVE_INFINITY } },
  }
  const props = mediaImageProps(invalid)
  assert.equal(props.srcSet, undefined)
  assert.equal(props.width, undefined)
  assert.equal(props.height, undefined)
  assert.equal(mediaImageProps({ url: 'javascript:alert(1)' }).src, '')
})

test('above-fold media is eager and prioritized; lower images stay lazy, with escaped alternatives', () => {
  const eager = renderToStaticMarkup(createElement(MediaImage, { media, alt: 'Maska "Ocean"', sizes: '100vw', eager: true }))
  assert.match(eager, /loading="eager"/)
  assert.match(eager, /fetchPriority="high"/)
  assert.match(eager, /alt="Maska &quot;Ocean&quot;"/)
  assert.match(eager, /sizes="100vw"/)
  assert.doesNotMatch(eager, /src="\/api\/media\/file\/original/)
  const lazy = renderToStaticMarkup(createElement(MediaImage, { media, alt: '', sizes: '50vw' }))
  assert.match(lazy, /loading="lazy"/)
  assert.doesNotMatch(lazy, /fetchPriority="high"/)
  assert.equal(renderToStaticMarkup(createElement(MediaImage, { media: null, alt: '', sizes: '100vw' })), '')
})

test('static fallback selects its responsive WebP derivatives and real dimensions', () => {
  const html = renderToStaticMarkup(createElement(MediaImage, { media: null, fallback: '/img/wyprawa.jpg', alt: '', sizes: '100vw', eager: true }))
  assert.match(html, /src="\/img\/wyprawa-960.webp"/)
  assert.match(html, /srcSet="\/img\/wyprawa-480.webp 480w, \/img\/wyprawa-960.webp 960w, \/img\/wyprawa-2000.webp 2000w"/)
  assert.match(html, /width="2000" height="1250"/)
  assert.doesNotMatch(html, /src="\/img\/wyprawa.jpg"/)
})

test('static scene dimensions and width descriptors agree with every checked-in encoded file', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/img')
  for (const name of ['wyprawa', 'kurs', 'serwis', 'sklep']) {
    const original = await sharp(path.join(root, `${name}.jpg`)).metadata()
    const html = renderToStaticMarkup(createElement(MediaImage, { media: null, fallback: `/img/${name}.jpg`, alt: '', sizes: '100vw' }))
    assert.match(html, new RegExp(`width="${original.width}" height="${original.height}"`))
    const srcset = html.match(/srcSet="([^"]+)"/)?.[1]
    assert.ok(srcset)
    for (const candidate of srcset.split(', ')) {
      const [file, descriptor] = candidate.split(' ')
      const metadata = await sharp(path.join(root, path.basename(file))).metadata()
      assert.equal(`${metadata.width}w`, descriptor)
      assert.equal(metadata.format, 'webp')
    }
  }
})
