import { asObject, mediaUrl, type MediaRef } from '@/lib/presentation'

type Dimensions = { width?: number | null; height?: number | null }
const dimension = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined

// Decorative scenes have checked-in derivatives; source JPEGs remain unchanged.
const STATIC_MEDIA: Record<string, { src: string; srcSet: string; width: number; height: number }> = {
  '/img/wyprawa.jpg': { src: '/img/wyprawa-960.webp', srcSet: '/img/wyprawa-480.webp 480w, /img/wyprawa-960.webp 960w, /img/wyprawa-2000.webp 2000w', width: 2000, height: 1250 },
  '/img/kurs.jpg': { src: '/img/kurs-960.webp', srcSet: '/img/kurs-480.webp 480w, /img/kurs-960.webp 960w, /img/kurs-1120.webp 1120w', width: 1120, height: 1400 },
  '/img/serwis.jpg': { src: '/img/serwis-960.webp', srcSet: '/img/serwis-480.webp 480w, /img/serwis-960.webp 960w, /img/serwis-2000.webp 2000w', width: 2000, height: 1250 },
  '/img/sklep.jpg': { src: '/img/sklep-960.webp', srcSet: '/img/sklep-480.webp 480w, /img/sklep-960.webp 960w, /img/sklep-1120.webp 1120w', width: 1120, height: 1400 },
}

/** Existing Payload derivatives only. Never fetch an external image through an optimizer. */
export function mediaImageProps(media: MediaRef, size: 'thumb' | 'card' = 'card') {
  const image = asObject(media)
  const src = mediaUrl(media, size)
  const derivatives = image?.sizes as { thumb?: Dimensions; card?: Dimensions } | null | undefined
  const variants = (['thumb', 'card'] as const).flatMap((variant) => {
    const url = mediaUrl(media, variant)
    // Older uploads can lack derivatives or dimension metadata. Keep their ordinary
    // src rather than guessing a width descriptor or duplicating the original URL.
    const width = dimension(derivatives?.[variant]?.width)
    return width && url && !/[\s,]/.test(url) ? [{ url, width }] : []
  })
  const unique = variants.filter((candidate, index) => variants.findIndex((other) => other.url === candidate.url || other.width === candidate.width) === index)
  return {
    src,
    srcSet: unique.length > 1 ? unique.sort((a, b) => a.width - b.width).map(({ url, width }) => `${url} ${width}w`).join(', ') : undefined,
    width: dimension(image?.width),
    height: dimension(image?.height),
  }
}

export function MediaImage({ media, fallback, alt, sizes, eager = false, className }: {
  media: MediaRef
  fallback?: string
  alt: string
  sizes: string
  eager?: boolean
  className?: string
}) {
  const props = mediaImageProps(media)
  const image = props.src ? props : fallback ? STATIC_MEDIA[fallback] || props : props
  if (!props.src && !fallback) return null
  return <img {...image} src={image.src || fallback} alt={alt} sizes={image.srcSet ? sizes : undefined} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : undefined} decoding="async" className={className} />
}
