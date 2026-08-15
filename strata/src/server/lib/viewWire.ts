import type { View } from '@/server/db/schema/views';

/** `share_url` is derived, never stored — the token is the durable part. */
export function shapeView(view: View): Record<string, unknown> {
  return {
    id: view.id,
    itemTypeId: view.itemTypeId,
    type: view.type,
    name: view.name,
    description: view.description,
    visibility: view.visibility,
    config: view.config,
    isDefault: view.isDefault,
    ownerId: view.ownerId,
    position: view.position,
    shareToken: view.shareToken,
    shareUrl: view.shareToken ? `/share/${view.shareToken}` : null,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}
