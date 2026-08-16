'use client';

/**
 * Client shell for the deep-linked item page: pins the workspace id for the
 * API client, then renders the same panel the views open — one component, two
 * surfaces, so they cannot drift.
 */

import type { Field, FieldGroup } from '@/server/db/schema/itemTypes';
import { setWorkspaceId } from '@/lib/api';
import { ItemDetailPanel } from './ItemDetailPanel';
import type { WorkspaceMemberOption } from '@/components/grid/editors/UserEditor';

export function ItemDetailPage(props: {
  workspaceId: string;
  itemId: string;
  fields: Field[];
  fieldGroups: FieldGroup[];
  members: WorkspaceMemberOption[];
}) {
  // Pinned during render, not in an effect: the panel is a child, child
  // effects run before parent effects, and the panel's first queries would
  // fire without the workspace header and 400.
  setWorkspaceId(props.workspaceId);

  return (
    <ItemDetailPanel
      itemId={props.itemId}
      fields={props.fields}
      fieldGroups={props.fieldGroups}
      members={props.members}
      fullPage
    />
  );
}
