import type { Access, FieldAccess, PayloadRequest } from 'payload'

export type StaffRole = 'admin' | 'editor' | 'operations'
export function staffRole(req: Pick<PayloadRequest, 'user'>): StaffRole | undefined {
  const role = (req.user as { role?: string } | null)?.role
  return ['admin', 'editor', 'operations'].includes(role || '') ? role as StaffRole : undefined
}
export const adminOnly: Access = ({ req }) => staffRole(req) === 'admin'
export const adminField: FieldAccess = ({ req }) => staffRole(req) === 'admin'
export const contentEditor: Access = ({ req }) => ['admin', 'editor'].includes(staffRole(req) || '')
export const operationsOnly: Access = ({ req }) => ['admin', 'operations'].includes(staffRole(req) || '')
export const staffOnly: Access = ({ req }) => !!staffRole(req)
export const publicPublished: Access = ({ req }) =>
  staffRole(req) ? true : { published: { equals: true } }

export const publicContentAccess = {
  read: publicPublished,
  create: contentEditor,
  update: contentEditor,
  delete: adminOnly,
}
export const privateSubmissionAccess = {
  read: operationsOnly,
  create: () => false,
  update: operationsOnly,
  delete: adminOnly,
}
