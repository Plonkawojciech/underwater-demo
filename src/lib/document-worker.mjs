// Native child: PDF input is parsed as data, never rendered or executed.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFParser, PDFRawStream, PDFRef, PDFString, PDFHexString } from 'pdf-lib'

const forbidden = new Set(['JavaScript', 'JS', 'EmbeddedFiles', 'EF', 'XFA', 'RichMedia', 'AA'])
const actions = new Set(['JavaScript', 'Launch', 'GoToR', 'GoToE', 'SubmitForm', 'ImportData', 'Rendition', 'Sound', 'Movie'])
const activeSubtypes = new Set(['RichMedia', '3D', 'Screen', 'Movie', 'Sound'])
const name = value => value.asString().slice(1).replace(/#([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
try {
  const chunks = []; let size = 0
  for await (const chunk of process.stdin) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error('Unsupported document.'); chunks.push(chunk) }
  const bytes = Buffer.concat(chunks)
  // Disallow ambiguous incremental/redefined objects: parser and viewer must
  // not select different definitions of an active object through the xref.
  const source = bytes.toString('latin1')
  const space = '(?:[\\0\\t\\n\\f\\r ]|%[^\\r\\n]*(?:\\r\\n?|\\n|$))+'
  const headers = [...source.matchAll(new RegExp('(?<![0-9])(\\d+)' + space + '(\\d+)' + space + 'obj\\b', 'g'))]
  const identities = new Set()
  for (const match of headers) {
    const objectNumber = Number(match[1]), generation = Number(match[2])
    if (!Number.isSafeInteger(objectNumber) || !Number.isSafeInteger(generation)) throw new Error('Unsupported document.')
    const identity = `${objectNumber} ${generation} R`
    if (identities.has(identity)) throw new Error('Ambiguous document.')
    identities.add(identity)
  }
  // Encryption cannot be hidden in a stream/trailer selected by a repairing viewer.
  for (const match of source.matchAll(/\/(?:#[0-9a-f]{2}|[^\0\t\n\f\r ()<>\[\]{}\/%])+/gi)) if (match[0].slice(1).replace(/#([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))) === 'Encrypt') throw new Error('Encrypted document.')
  const parser = PDFParser.forBytesWithOptions(bytes, 100, true, false)
  const parsed = new Map(), crossRefs = new Set(), streamCrossRefs = new Set()
  let activeOffset = null, encrypted = false, trailer = parser.context.trailerInfo
  Object.defineProperty(parser.context, 'trailerInfo', {
    configurable: false, enumerable: true, get: () => trailer,
    set: value => { if (value?.Encrypt) encrypted = true; if (activeOffset !== null) streamCrossRefs.add(activeOffset); trailer = value },
  })
  const parseIndirectObject = parser.parseIndirectObject.bind(parser)
  parser.parseIndirectObject = async () => {
    const offset = parser.bytes.offset()
    activeOffset = offset
    try { const ref = await parseIndirectObject(); parsed.set(ref.toString(), offset); return ref }
    finally { activeOffset = null }
  }
  const parseCrossRef = parser.maybeParseCrossRefSection.bind(parser)
  parser.maybeParseCrossRefSection = () => {
    parser.skipWhitespaceAndComments()
    const offset = parser.bytes.offset(), section = parseCrossRef()
    if (section) crossRefs.add(offset)
    return section
  }
  const assigned = new Set(), assign = parser.context.assign.bind(parser.context)
  parser.context.assign = (ref, object) => {
    const identity = ref.toString()
    if (assigned.has(identity)) throw new Error('Ambiguous document.')
    assigned.add(identity); assign(ref, object)
  }
  const context = await parser.parseDocument()
  // Include raw ObjStm/XRef headers which pdf-lib does not assign to context.
  // Every byte-level header must have been parsed at exactly that offset.
  for (const match of headers) if (parsed.get(`${Number(match[1])} ${Number(match[2])} R`) !== match.index) throw new Error('Hidden document object.')
  const tail = source.match(new RegExp('startxref' + space + '(\\d+)' + space + '%%EOF[\\0\\t\\n\\f\\r ]*$'))
  const xref = tail ? Number(tail[1]) : -1
  if (!Number.isSafeInteger(xref) || !(crossRefs.has(xref) || streamCrossRefs.has(xref))) throw new Error('Unparsed document xref.')
  if (encrypted || context.trailerInfo.Encrypt) throw new Error('Encrypted document.')
  const document = new PDFDocument(context, false, false)
  const pages = document.getPageCount()
  if (pages < 1 || pages > 1000) throw new Error('Unsupported document.')
  const objects = document.context.enumerateIndirectObjects()
  if (objects.length > 50_000) throw new Error('Unsupported document.')
  const pending = objects.map(([, object]) => object)
  const references = new Set()
  let steps = 0
  while (pending.length) {
    if (++steps > 2_000_000) throw new Error('Unsupported document.')
    const object = pending.pop()
    if (object instanceof PDFRef) {
      const identity = object.toString()
      if (references.has(identity)) continue
      references.add(identity)
      const resolved = context.lookup(object)
      if (resolved === undefined) throw new Error('Unresolved document reference.')
      pending.push(resolved)
    } else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        const keyName = name(key)
        // Viewers may resolve xref aliases differently; security selectors and
        // link targets must be literal values that this parser actually inspected.
        if (['S', 'Subtype', 'URI'].includes(keyName) && value instanceof PDFRef) throw new Error('Indirect document selector.')
        const resolved = ['S', 'Subtype'].includes(keyName) ? document.context.lookup(value) : value
        if (forbidden.has(keyName) || (keyName === 'S' && resolved instanceof PDFName && actions.has(name(resolved))) || (keyName === 'Subtype' && resolved instanceof PDFName && activeSubtypes.has(name(resolved)))) throw new Error('Active document.')
        if (keyName === 'URI') {
          const uri = context.lookup(value)
          if (!(uri instanceof PDFString || uri instanceof PDFHexString) || !/^(?:https?:\/\/|mailto:)/i.test(uri.decodeText()) || /[\0-\x1f]/.test(uri.decodeText())) throw new Error('Unsafe document link.')
        }
        pending.push(value)
      }
    } else if (object instanceof PDFArray) pending.push(...object.asArray())
    else if (object instanceof PDFRawStream) {
      // Recognized ObjStm/XRef streams are consumed by the parser, never assigned.
      // A remaining stream with their layout may be selected by a viewer's xref
      // even when pdf-lib missed an absent or forward-referenced /Type.
      const keys = new Set(object.dict.entries().map(([key]) => name(key)))
      const type = object.dict.get(PDFName.of('Type'))
      const resolved = context.lookup(type)
      if ((keys.has('N') && keys.has('First')) || keys.has('W') || type instanceof PDFRef || (resolved instanceof PDFName && ['ObjStm', 'XRef'].includes(name(resolved)))) throw new Error('Hidden document object.')
      pending.push(object.dict)
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, pages }))
} catch { process.stdout.write(JSON.stringify({ ok: false })) }
