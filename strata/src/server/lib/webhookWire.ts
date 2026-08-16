import type { Webhook } from '@/server/db/schema/webhooks';

/** The stored secret never leaves the server after creation — only a hint. */
export function shapeWebhook(hook: Webhook): Record<string, unknown> {
  return {
    id: hook.id,
    url: hook.url,
    events: hook.events,
    description: hook.description,
    active: hook.active,
    secretHint: `${hook.secret.slice(0, 10)}…`,
    consecutiveFailures: hook.consecutiveFailures,
    disabledReason: hook.disabledReason,
    lastDeliveryAt: hook.lastDeliveryAt,
    createdAt: hook.createdAt,
  };
}
