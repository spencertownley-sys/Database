import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, primaryId, timestamps, workspaceIdColumn } from './_shared';

export const memberRoleEnum = pgEnum('member_role', ['owner', 'admin', 'editor', 'viewer', 'guest']);
export const memberStatusEnum = pgEnum('member_status', ['pending', 'active', 'suspended']);
export const workspacePlanEnum = pgEnum('workspace_plan', ['free', 'team', 'business']);

/**
 * The tenant root. Every other tenant table carries `workspace_id` pointing
 * here, and RLS keys off it. `workspaces` itself is filtered by membership in
 * the middleware rather than by RLS, because resolving the slug happens before
 * a workspace context exists.
 */
export const workspaces = pgTable(
  'workspaces',
  {
    id: primaryId(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** Structured for billing; nothing reads it for gating in v1. */
    plan: workspacePlanEnum('plan').notNull().default('free'),
    settings: jsonb('settings').$type<WorkspaceSettings>().notNull().default({}),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('workspaces_slug_key').on(t.slug)],
);

export interface WorkspaceSettings {
  /** Default landing view id, if the owner pinned one. */
  homeViewId?: string;
  weekStartsOn?: 0 | 1;
  defaultCurrency?: string;
}

/**
 * Mirrors `auth.users`. Kept as its own table so an item can reference a user
 * across workspaces and so `user` fields resolve without a cross-schema join.
 * Not tenant-scoped: a person can belong to several workspaces.
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    /** Supabase `auth.users.id`. Null only for seeded fixture users. */
    authUserId: uuid('auth_user_id'),
    email: text('email').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(sql`lower(${t.email})`),
    uniqueIndex('users_auth_user_id_key').on(t.authUserId),
  ],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Set for invitations not yet accepted, where no user row exists yet. */
    invitedEmail: text('invited_email'),
    role: memberRoleEnum('role').notNull().default('editor'),
    status: memberStatusEnum('status').notNull().default('pending'),
    inviteToken: text('invite_token'),
    inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true, mode: 'date' }),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('workspace_members_ws_user_key')
      .on(t.workspaceId, t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex('workspace_members_ws_email_key')
      .on(t.workspaceId, sql`lower(${t.invitedEmail})`)
      .where(sql`${t.invitedEmail} is not null and ${t.userId} is null`),
    uniqueIndex('workspace_members_invite_token_key')
      .on(t.inviteToken)
      .where(sql`${t.inviteToken} is not null`),
    index('workspace_members_user_idx').on(t.userId),
  ],
);

/**
 * A guest's window onto the workspace: the tree nodes they may see and the
 * fields they may edit within them.
 *
 * `editableFieldKeys` is a *presentation* restriction inside the app, not a
 * security boundary — field-level permissions are Phase 2. v1 contains the gap
 * by denying guests API access entirely (see `permissions.service.ts`), so the
 * only path that honours the subset is the one that renders it.
 */
export const guestScopes = pgTable(
  'guest_scopes',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => workspaceMembers.id, { onDelete: 'cascade' }),
    treeNodeId: uuid('tree_node_id').notNull(),
    includeDescendants: boolean('include_descendants').notNull().default(true),
    canEdit: boolean('can_edit').notNull().default(false),
    editableFieldKeys: text('editable_field_keys').array(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('guest_scopes_member_node_key').on(t.memberId, t.treeNodeId),
    index('guest_scopes_ws_member_idx').on(t.workspaceId, t.memberId),
  ],
);

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
  guestScopes: many(guestScopes),
}));

export const guestScopesRelations = relations(guestScopes, ({ one }) => ({
  member: one(workspaceMembers, {
    fields: [guestScopes.memberId],
    references: [workspaceMembers.id],
  }),
}));

export type Workspace = typeof workspaces.$inferSelect;
export type User = typeof users.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type GuestScope = typeof guestScopes.$inferSelect;
export type MemberRole = (typeof memberRoleEnum.enumValues)[number];
