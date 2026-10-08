import test from 'node:test'
import assert from 'node:assert/strict'
import type { PayloadRequest } from 'payload'
import { adminOnly, contentEditor, privateSubmissionAccess, publicPublished, staffRole } from '../src/lib/access'

function request(role?: string): PayloadRequest {
  return { user: role ? { id: 1, role } : null } as unknown as PayloadRequest
}

test('anonymous and unrecognized roles cannot write or read private submissions', async () => {
  for (const role of [undefined, 'customer', 'superadmin']) {
    const req = request(role)
    assert.equal(staffRole(req), undefined)
    assert.equal(await adminOnly({ req }), false)
    assert.equal(await contentEditor({ req }), false)
    assert.equal(await privateSubmissionAccess.read({ req }), false)
    assert.deepEqual(await publicPublished({ req }), { published: { equals: true } })
  }
  assert.equal(privateSubmissionAccess.create(), false)
})

test('staff permissions separate content, operations and administration', async () => {
  assert.equal(await adminOnly({ req: request('admin') }), true)
  assert.equal(await adminOnly({ req: request('editor') }), false)
  assert.equal(await contentEditor({ req: request('editor') }), true)
  assert.equal(await contentEditor({ req: request('operations') }), false)
  assert.equal(await privateSubmissionAccess.read({ req: request('operations') }), true)
  assert.equal(await privateSubmissionAccess.read({ req: request('editor') }), false)
})
