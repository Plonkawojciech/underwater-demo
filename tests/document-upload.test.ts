import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, PDFDict, PDFName, PDFString } from 'pdf-lib'
import { createDeflate, deflateSync } from 'node:zlib'
import { once } from 'node:events'
import { verifyDocumentBytes, verifyDocumentUpload } from '../src/lib/document-upload'

async function pdf() { const document = await PDFDocument.create(); document.addPage([300, 300]); return document }
const bytes = async (document: PDFDocument) => Buffer.from(await document.save())
test('a real static PDF is parsed in an isolated child without changing original bytes', async () => {
  const data = await bytes(await pdf()), original = Buffer.from(data)
  assert.equal(await verifyDocumentBytes(data), 1)
  assert.deepEqual(data, original)
})
test('JavaScript in a compressed PDF is rejected', async () => {
  const document = await pdf(); document.addJavaScript('unsafe', 'app.alert("synthetic test")')
  await assert.rejects(verifyDocumentBytes(await bytes(document)), /aktywn|uszkodzony/)
})
test('embedded files and external submit actions are rejected', async () => {
  const embedded = await pdf(); await embedded.attach(Uint8Array.of(1, 2, 3), 'synthetic.txt')
  await assert.rejects(verifyDocumentBytes(await bytes(embedded)), /aktywn|uszkodzony/)
  const submit = await pdf()
  submit.catalog.set(PDFName.of('OpenAction'), submit.context.obj({ S: 'SubmitForm', F: PDFString.of('https://example.invalid') }))
  await assert.rejects(verifyDocumentBytes(await bytes(submit)), /aktywn|uszkodzony/)
})
test('an additional action inside a nested direct dictionary cannot evade validation', async () => {
  const document = await pdf()
  const nested = document.context.obj({ AA: { O: { S: 'JavaScript', JS: PDFString.of('synthetic') } } }) as PDFDict
  document.getPage(0).node.set(PDFName.of('SyntheticFixture'), nested)
  await assert.rejects(verifyDocumentBytes(await bytes(document)), /aktywn|uszkodzony/)
})
test('an action type behind an indirect reference cannot evade validation', async () => {
  const document = await pdf()
  const action = document.context.obj({ S: document.context.register(PDFName.of('Launch')), F: PDFString.of('synthetic') })
  document.catalog.set(PDFName.of('OpenAction'), action)
  await assert.rejects(verifyDocumentBytes(await bytes(document)), /aktywn|uszkodzony/)
})
test('lowercase hex PDF names, active annotation subtypes and redefined objects fail closed', async () => {
  const action = await pdf()
  action.catalog.set(PDFName.of('OpenAction'), action.context.obj({ S: 'JavaScript', JS: PDFString.of('synthetic') }))
  const escaped = Buffer.from(Buffer.from(await action.save({ useObjectStreams: false })).toString('latin1').replace('/S /JavaScript', '/S /#4aavaScript'), 'latin1')
  await assert.rejects(verifyDocumentBytes(escaped), /aktywn|uszkodzony/)
  for (const subtype of ['RichMedia', '3D', 'Screen', 'Movie', 'Sound']) {
    const document = await pdf(); document.getPage(0).node.set(PDFName.of('Annots'), document.context.obj([{ Subtype: subtype }]))
    await assert.rejects(verifyDocumentBytes(await bytes(document)), /aktywn|uszkodzony/)
  }
  const original = Buffer.from(await (await pdf()).save({ useObjectStreams: false }))
  await assert.rejects(verifyDocumentBytes(Buffer.concat([original, Buffer.from('\n1 0 obj\n<<>>\nendobj\n%%EOF')])), /aktywn|uszkodzony/)
})
test('a compressed object stream exceeding process memory bounds cannot exhaust the application', { timeout: 30_000 }, async () => {
  const deflater = createDeflate(), chunks: Buffer[] = []
  deflater.on('data', chunk => chunks.push(chunk))
  const finished = once(deflater, 'end')
  const block = Buffer.alloc(1024 * 1024, 32)
  for (let i = 0; i < 1024; i++) if (!deflater.write(block)) await once(deflater, 'drain')
  deflater.end(); await finished
  const compressed = Buffer.concat(chunks)
  const header = Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`)
  await assert.rejects(verifyDocumentBytes(Buffer.concat([header, compressed, Buffer.from('\nendstream\nendobj\n%%EOF')])), /aktywn|uszkodzony/)
  assert.equal(await verifyDocumentBytes(await bytes(await pdf())), 1, 'the application and validation queue survive the rejected child')
})
test('permission is checked before parsing and imported original bytes cannot be replaced', async () => {
  const data = Buffer.from('synthetic malformed input'), file = { name: 'synthetic.pdf', mimetype: 'application/pdf', data, size: data.length }
  await assert.rejects(async () => { await verifyDocumentUpload({ operation: 'create', args: { overrideAccess: false, req: { user: null, file } } } as never) }, /uprawnień/)
  await assert.rejects(async () => { await verifyDocumentUpload({ operation: 'update', args: { id: 1, overrideAccess: false, req: { user: { role: 'editor' }, file, payload: { findByID: async () => ({ legacyKey: 'source-original' }) } } } } as never) }, /chroniony/)
  await assert.rejects(async () => { await verifyDocumentUpload({ operation: 'update', args: { overrideAccess: false, req: { user: { role: 'editor' }, file } } } as never) }, /Zbiorcza/)
  for (const operation of ['create', 'update']) await assert.rejects(async () => { await verifyDocumentUpload({ operation, args: { data: { title: 'Sanitized identity' }, overrideAccess: false, req: { data: { url: 'https://example.invalid/fixture.pdf', filename: 'fixture.pdf' } } } } as never) }, /bezpośrednio/)
})
test('dangling PDF references and unsafe annotation URLs are rejected', async () => {
  const { PDFRef } = await import('pdf-lib')
  const missing = await pdf(); missing.catalog.set(PDFName.of('OpenAction'), PDFRef.of(9999))
  await assert.rejects(verifyDocumentBytes(await bytes(missing)), /aktywn|uszkodzony/)
  const sameLine = Buffer.concat([Buffer.from(await (await pdf()).save({ useObjectStreams: false })), Buffer.from(' endobj 1 0 obj <<>> endobj\n%%EOF')])
  await assert.rejects(verifyDocumentBytes(sameLine), /aktywn|uszkodzony/)
  for (const uri of ['javascript:synthetic', 'file:///synthetic']) {
    const document = await pdf(); document.catalog.set(PDFName.of('OpenAction'), document.context.obj({ S: 'URI', URI: PDFString.of(uri) }))
    await assert.rejects(verifyDocumentBytes(await bytes(document)), /aktywn|uszkodzony/)
  }
})
test('malformed bytes, mismatched upload MIME and path names fail closed', async () => {
  await assert.rejects(verifyDocumentBytes(Buffer.from('%PDF-1.7\nnot a document\n%%EOF')), /uszkodzony/)
  await assert.rejects(verifyDocumentBytes(Buffer.from('<html>synthetic</html>')), /prawidłowym/)
  const data = await bytes(await pdf())
  for (const file of [{ name: '../synthetic.pdf', mimetype: 'application/pdf' }, { name: 'synthetic.pdf', mimetype: 'image/jpeg' }]) {
    await assert.rejects(async () => { await verifyDocumentUpload({ operation: 'create', args: { overrideAccess: true, req: { file: { ...file, data, size: data.length } } } } as never) }, /bezpiecznej/)
  }
})

test('xref pointing to a catalogue hidden inside another stream cannot evade the parser', async () => {
  const originals = ['%PDF-1.7\n', '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n', '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n', '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >> endobj\n']
  const safe = Buffer.from(originals.join(''))
  const hiddenCatalog = Buffer.from('50%comment\n0 obj << /Type /Catalog /Pages 2 0 R /OpenAction 51 0 R >> endobj\n')
  const hiddenAction = Buffer.from('51 0 obj << /S /JavaScript /JS (synthetic unsafe action) >> endobj\n')
  const xrefHeader = Buffer.from('60 0 obj << /Type /XRef /Size 61 /Root 50 0 R /W [1 4 2] /Index [0 5 50 2 60 1] /Length 56 >> stream\n')
  const xrefEnd = Buffer.from('\nendstream\nendobj\n')
  const hiddenSize = hiddenCatalog.length + hiddenAction.length + xrefHeader.length + 56 + xrefEnd.length
  const streamHeader = Buffer.from(`4 0 obj << /Length ${hiddenSize} >> stream\n`)
  const offset50 = safe.length + streamHeader.length, offset51 = offset50 + hiddenCatalog.length, offset60 = offset51 + hiddenAction.length
  const originalOffsets = originals.slice(1).map((_, index) => Buffer.byteLength(originals.slice(0, index + 1).join('')))
  const records = [0, ...originalOffsets, safe.length, offset50, offset51, offset60]
  const xrefBytes = Buffer.alloc(56)
  records.forEach((offset, index) => { xrefBytes[index * 7] = index === 0 ? 0 : 1; xrefBytes.writeUInt32BE(offset, index * 7 + 1); xrefBytes.writeUInt16BE(index === 0 ? 65535 : 0, index * 7 + 5) })
  const body = Buffer.concat([safe, streamHeader, hiddenCatalog, hiddenAction, xrefHeader, xrefBytes, xrefEnd, Buffer.from('\nendstream\nendobj\n')])
  const classical = ['xref\n0 5\n0000000000 65535 f \n', ...[...originalOffsets, safe.length].map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`), `trailer << /Size 61 /Root 1 0 R >>\nstartxref\n${offset60}\n%%EOF\n`].join('')
  const hidden = Buffer.concat([body, Buffer.from(classical)])
  await assert.rejects(verifyDocumentBytes(hidden), /aktywn|uszkodzony/)
})

test('encryption in any parsed trailer cannot be erased by a later XRef stream', async () => {
  const document = await pdf()
  const encrypted = document.context.register(document.context.obj({ Filter: 'Standard', V: 4, R: 4, Length: 128 }))
  const original = Buffer.from(await document.save({ useObjectStreams: false })).toString('latin1')
  const xref = Number(original.match(/startxref\s+(\d+)\s+%%EOF/)?.[1]);assert.ok(Number.isSafeInteger(xref))
  const declared = original.replace('trailer\n<<', `trailer\n<<\n/Encrypt ${encrypted.toString()}`)
  // Insertion is after xref; its original offset remains unchanged.
  const later = Buffer.from(`\n10001 0 obj << /Type /XRef /Size 1 /W [1 1 1] /Length 3 >> stream\n\0\0\0\nendstream\nendobj\nstartxref\n${xref}\n%%EOF\n`, 'latin1')
  await assert.rejects(verifyDocumentBytes(Buffer.concat([Buffer.from(declared,'latin1'),later])), /aktywn|uszkodzony/)
})

test('an unrecognized compressed object stream cannot select a hidden active catalogue', async () => {
  for (const type of ['', '/Type 6 0 R']) {
    const parts: Buffer[] = [Buffer.from('%PDF-1.7\n')]
    const offsets = new Map<number, number>()
    const object = (id: number, body: Buffer | string) => {
      offsets.set(id, parts.reduce((total, part) => total + part.length, 0))
      parts.push(Buffer.from(`${id} 0 obj\n`), typeof body === 'string' ? Buffer.from(body) : body, Buffer.from('\nendobj\n'))
    }
    object(1, '<< /Type /Catalog /Pages 2 0 R >>')
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
    object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>')
    const compressed = deflateSync(Buffer.from('1 0 << /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (synthetic unsafe) >> >>'))
    object(5, Buffer.concat([Buffer.from(`<< ${type} /N 1 /First 4 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`), compressed, Buffer.from('\nendstream')]))
    object(6, '/ObjStm')
    const xrefOffset = parts.reduce((total, part) => total + part.length, 0)
    const entries = Buffer.alloc(8 * 7)
    for (let id = 0; id < 8; id++) {
      entries[id * 7] = id === 1 ? 2 : offsets.has(id) || id === 7 ? 1 : 0
      entries.writeUInt32BE(id === 1 ? 5 : id === 7 ? xrefOffset : offsets.get(id) || 0, id * 7 + 1)
      entries.writeUInt16BE(id === 0 ? 65535 : 0, id * 7 + 5)
    }
    object(7, Buffer.concat([Buffer.from(`<< /Type /XRef /Size 8 /Root 1 0 R /W [1 4 2] /Length ${entries.length} >>\nstream\n`), entries, Buffer.from('\nendstream')]))
    parts.push(Buffer.from(`startxref\n${xrefOffset}\n%%EOF\n`))
    await assert.rejects(verifyDocumentBytes(Buffer.concat(parts)), /aktywn|uszkodzony/)
  }
})

test('repair-only xref layouts and indirect action selectors fail closed', async () => {
  const { PDFRef } = await import('pdf-lib')
  const xref = await pdf()
  const raw = xref.context.stream(Buffer.from([0, 0, 0, 0, 0, 0, 0]), { W: [1, 4, 2], Index: [9, 1] })
  xref.catalog.set(PDFName.of('SyntheticFixture'), xref.context.register(raw))
  await assert.rejects(verifyDocumentBytes(await bytes(xref)), /aktywn|uszkodzony/)
  for (const key of ['S', 'Subtype', 'URI']) {
    const document = await pdf()
    const value = key === 'URI' ? PDFString.of('https://example.invalid/synthetic') : PDFName.of(key === 'S' ? 'GoTo' : 'Text')
    const indirect = document.context.register(value)
    assert.ok(indirect instanceof PDFRef)
    document.catalog.set(PDFName.of('SyntheticFixture'), document.context.obj({ [key]: indirect }))
    await assert.rejects(verifyDocumentBytes(await bytes(document)), /aktywn|uszkodzony/)
  }
})
