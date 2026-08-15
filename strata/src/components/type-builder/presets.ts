/**
 * Starter Item Types.
 *
 * The two-minute acceptance criterion is the whole reason these exist: a
 * non-technical ops lead should reach a usable Item Type by picking a preset
 * and renaming a couple of fields, never by staring at an empty schema
 * wondering what a field is. Every preset therefore arrives populated, with
 * `select` options already written, sensible required flags, and the fields a
 * person would have added in the first ten minutes anyway.
 *
 * Option ids are stable, readable strings rather than generated uuids: they
 * appear in saved view filters, import mappings, and API payloads, and a
 * readable id makes those legible without a lookup. Labels can be renamed
 * freely — only the id is load-bearing.
 */

import type { FieldConfig, FieldType, InheritanceMode, SelectOption } from '@/types/fields';

export interface PresetField {
  key: string;
  label: string;
  type: FieldType;
  config?: FieldConfig;
  requiredForCompleteness?: boolean;
  inheritance?: InheritanceMode;
  isIndexed?: boolean;
  isSearchable?: boolean;
  helpText?: string;
  defaultValue?: unknown;
  /** Field group key; fields without one land in the default group. */
  group?: string;
}

export interface PresetGroup {
  key: string;
  label: string;
  collapsedByDefault?: boolean;
}

export interface ItemTypePreset {
  key: string;
  label: string;
  pluralLabel: string;
  description: string;
  icon: string;
  color: string;
  /** One sentence: what this is for, in the user's language. */
  conceptHint: string;
  groups: PresetGroup[];
  fields: PresetField[];
  /** Field keys forming variant axes. Only `Product Variant` ships with any. */
  variantAxes?: string[];
}

function options(...entries: Array<[id: string, label: string, color?: string]>): SelectOption[] {
  return entries.map(([id, label, color], i) => ({ id, label, order: i, ...(color ? { color } : {}) }));
}

const STATUS_OPTIONS = options(
  ['todo', 'To do', 'slate'],
  ['in_progress', 'In progress', 'blue'],
  ['blocked', 'Blocked', 'red'],
  ['review', 'In review', 'amber'],
  ['done', 'Done', 'green'],
);

const PRIORITY_OPTIONS = options(
  ['low', 'Low', 'slate'],
  ['medium', 'Medium', 'blue'],
  ['high', 'High', 'amber'],
  ['urgent', 'Urgent', 'red'],
);

const task: ItemTypePreset = {
  key: 'task',
  label: 'Task',
  pluralLabel: 'Tasks',
  description: 'A single piece of work with an owner and a due date.',
  icon: 'check-square',
  color: 'blue',
  conceptHint:
    'Tasks nest: a task can hold subtasks, so a phase of work and the work itself are the same kind of thing.',
  groups: [
    { key: 'details', label: 'Details' },
    { key: 'planning', label: 'Planning' },
  ],
  fields: [
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      config: { options: STATUS_OPTIONS },
      requiredForCompleteness: true,
      defaultValue: 'todo',
      isIndexed: true,
      group: 'details',
    },
    { key: 'assignee', label: 'Assignee', type: 'user', isIndexed: true, group: 'details' },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      config: { options: PRIORITY_OPTIONS },
      defaultValue: 'medium',
      isIndexed: true,
      group: 'details',
    },
    { key: 'due_date', label: 'Due date', type: 'date', isIndexed: true, group: 'planning' },
    {
      key: 'estimate_hours',
      label: 'Estimate (hours)',
      type: 'number',
      config: { min: 0, precision: 1, unit: 'h' },
      group: 'planning',
    },
    {
      key: 'notes',
      label: 'Notes',
      type: 'long_text',
      isSearchable: true,
      group: 'details',
    },
  ],
};

const clientProject: ItemTypePreset = {
  key: 'client_project',
  label: 'Client project',
  pluralLabel: 'Client projects',
  description: 'A named engagement with a client, a budget, and a delivery window.',
  icon: 'briefcase',
  color: 'violet',
  conceptHint:
    'Put deliverables underneath a project in the hierarchy, and file the project itself under a client in a category tree — the two are separate axes on purpose.',
  groups: [
    { key: 'client', label: 'Client' },
    { key: 'commercial', label: 'Commercial' },
    { key: 'delivery', label: 'Delivery' },
  ],
  fields: [
    { key: 'client_name', label: 'Client', type: 'text', requiredForCompleteness: true, isSearchable: true, isIndexed: true, group: 'client' },
    { key: 'account_lead', label: 'Owner', type: 'user', isIndexed: true, group: 'client' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      config: {
        options: options(
          ['scoping', 'Scoping', 'slate'],
          ['active', 'Active', 'blue'],
          ['on_hold', 'On hold', 'amber'],
          ['delivered', 'Delivered', 'green'],
          ['closed', 'Closed', 'slate'],
        ),
      },
      requiredForCompleteness: true,
      defaultValue: 'scoping',
      isIndexed: true,
      group: 'delivery',
    },
    {
      key: 'budget',
      label: 'Budget',
      type: 'currency',
      config: { currencyCode: 'USD', min: 0 },
      isIndexed: true,
      group: 'commercial',
    },
    {
      key: 'rate_card',
      label: 'Blended rate',
      type: 'currency',
      config: { currencyCode: 'USD', min: 0 },
      group: 'commercial',
    },
    { key: 'start_date', label: 'Start date', type: 'date', requiredForCompleteness: true, isIndexed: true, group: 'delivery' },
    { key: 'end_date', label: 'Due date', type: 'date', isIndexed: true, group: 'delivery' },
    { key: 'brief_url', label: 'Brief', type: 'url', group: 'client' },
    { key: 'scope', label: 'Scope of work', type: 'long_text', isSearchable: true, group: 'client' },
  ],
};

const campaign: ItemTypePreset = {
  key: 'campaign',
  label: 'Campaign',
  pluralLabel: 'Campaigns',
  description: 'A marketing push across channels, with a window and a budget.',
  icon: 'megaphone',
  color: 'amber',
  conceptHint:
    'Campaigns usually own a tree of deliverables — one per channel, per region, per format. Nest them rather than flattening the names.',
  variantAxes: ['region'],
  groups: [
    { key: 'plan', label: 'Plan' },
    { key: 'targeting', label: 'Targeting' },
    { key: 'measurement', label: 'Measurement', collapsedByDefault: true },
  ],
  fields: [
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      config: {
        options: options(
          ['draft', 'Draft', 'slate'],
          ['approved', 'Approved', 'blue'],
          ['live', 'Live', 'green'],
          ['paused', 'Paused', 'amber'],
          ['complete', 'Complete', 'violet'],
        ),
      },
      requiredForCompleteness: true,
      defaultValue: 'draft',
      isIndexed: true,
      group: 'plan',
    },
    {
      key: 'channels',
      label: 'Channels',
      type: 'multi_select',
      config: {
        options: options(
          ['email', 'Email'],
          ['paid_social', 'Paid social'],
          ['organic_social', 'Organic social'],
          ['search', 'Paid search'],
          ['display', 'Display'],
          ['events', 'Events'],
          ['pr', 'PR'],
        ),
      },
      requiredForCompleteness: true,
      isIndexed: true,
      group: 'plan',
    },
    { key: 'owner', label: 'Owner', type: 'user', requiredForCompleteness: true, isIndexed: true, group: 'plan' },
    { key: 'launch_date', label: 'Launch date', type: 'date', requiredForCompleteness: true, isIndexed: true, group: 'plan' },
    { key: 'end_date', label: 'Due date', type: 'date', isIndexed: true, group: 'plan' },
    {
      key: 'budget',
      label: 'Budget',
      type: 'currency',
      config: { currencyCode: 'USD', min: 0 },
      isIndexed: true,
      group: 'plan',
    },
    {
      // The declared variant axis (§3.2) — without this field, generating
      // per-region variants of a campaign has nothing to expand over.
      key: 'region',
      label: 'Region',
      type: 'select',
      config: {
        options: options(
          ['na', 'North America'],
          ['emea', 'EMEA'],
          ['apac', 'APAC'],
          ['latam', 'LATAM'],
        ),
      },
      isIndexed: true,
      group: 'plan',
    },
    { key: 'audience', label: 'Audience', type: 'text', isSearchable: true, group: 'targeting' },
    { key: 'landing_page', label: 'Landing page', type: 'url', group: 'targeting' },
    {
      key: 'goal_impressions',
      label: 'Goal impressions',
      type: 'number',
      config: { min: 0 },
      group: 'measurement',
    },
    {
      key: 'utm_verified',
      label: 'UTMs verified',
      type: 'checkbox',
      group: 'measurement',
    },
  ],
};

const productVariant: ItemTypePreset = {
  key: 'product_variant',
  label: 'Product',
  pluralLabel: 'Products',
  description: 'A product with per-region and per-size variants that inherit shared copy.',
  icon: 'package',
  color: 'emerald',
  conceptHint:
    'Write the description once on the product; each regional variant inherits it until you deliberately override that one field.',
  groups: [
    { key: 'identity', label: 'Identity' },
    { key: 'commercial', label: 'Commercial' },
    { key: 'content', label: 'Content' },
  ],
  variantAxes: ['region', 'size'],
  fields: [
    { key: 'sku', label: 'SKU', type: 'text', requiredForCompleteness: true, inheritance: 'variant', isIndexed: true, isSearchable: true, group: 'identity' },
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      config: {
        options: options(['apparel', 'Apparel'], ['footwear', 'Footwear'], ['accessories', 'Accessories']),
      },
      inheritance: 'shared',
      isIndexed: true,
      group: 'identity',
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      config: {
        options: options(
          ['draft', 'Draft', 'slate'],
          ['active', 'Active', 'green'],
          ['discontinued', 'Discontinued', 'slate'],
        ),
      },
      inheritance: 'variant',
      defaultValue: 'draft',
      isIndexed: true,
      group: 'identity',
    },
    {
      key: 'region',
      label: 'Region',
      type: 'select',
      config: {
        options: options(
          ['na', 'North America'],
          ['emea', 'EMEA'],
          ['apac', 'APAC'],
          ['latam', 'LATAM'],
        ),
      },
      requiredForCompleteness: true,
      inheritance: 'variant',
      isIndexed: true,
      group: 'identity',
    },
    {
      key: 'size',
      label: 'Size',
      type: 'select',
      config: {
        options: options(['xs', 'XS'], ['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']),
      },
      inheritance: 'variant',
      isIndexed: true,
      group: 'identity',
    },
    {
      key: 'price',
      label: 'Price',
      type: 'currency',
      config: { currencyCode: 'USD', min: 0 },
      requiredForCompleteness: true,
      inheritance: 'variant',
      isIndexed: true,
      helpText: 'Set per variant — regional pricing rarely matches.',
      group: 'commercial',
    },
    {
      key: 'stock_on_hand',
      label: 'Stock on hand',
      type: 'number',
      config: { min: 0 },
      inheritance: 'variant',
      group: 'commercial',
    },
    {
      key: 'description',
      label: 'Description',
      type: 'long_text',
      requiredForCompleteness: true,
      inheritance: 'shared',
      isSearchable: true,
      helpText: 'Written once on the product; every variant inherits it.',
      group: 'content',
    },
    { key: 'material', label: 'Material', type: 'text', inheritance: 'shared', isSearchable: true, group: 'content' },
    { key: 'care_instructions', label: 'Care instructions', type: 'long_text', inheritance: 'shared', group: 'content' },
    { key: 'hero_image', label: 'Hero image', type: 'url', inheritance: 'shared', group: 'content' },
    { key: 'launch_date', label: 'Launch date', type: 'date', inheritance: 'shared', isIndexed: true, group: 'commercial' },
  ],
};

const structuredRecord: ItemTypePreset = {
  key: 'structured_record',
  label: 'Record',
  pluralLabel: 'Records',
  description: 'A general-purpose catalogued record with an owner, a category, and a status.',
  icon: 'file-text',
  color: 'slate',
  conceptHint:
    'Use completeness to find the records nobody has finished — the percentage is per item and filterable.',
  groups: [
    { key: 'summary', label: 'Summary' },
    { key: 'governance', label: 'Governance' },
  ],
  fields: [
    { key: 'reference', label: 'Reference ID', type: 'text', requiredForCompleteness: true, isIndexed: true, isSearchable: true, group: 'summary' },
    {
      key: 'category',
      label: 'Record type',
      type: 'select',
      config: {
        options: options(
          ['policy', 'Policy'],
          ['asset', 'Asset'],
          ['contract', 'Contract'],
          ['supplier', 'Supplier'],
          ['other', 'Other'],
        ),
      },
      requiredForCompleteness: true,
      isIndexed: true,
      group: 'summary',
    },
    { key: 'summary', label: 'Summary', type: 'long_text', requiredForCompleteness: true, isSearchable: true, group: 'summary' },
    { key: 'owner', label: 'Owner', type: 'user', requiredForCompleteness: true, isIndexed: true, group: 'governance' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      config: {
        options: options(
          ['draft', 'Draft', 'slate'],
          ['in_review', 'In review', 'amber'],
          ['approved', 'Approved', 'green'],
          ['retired', 'Retired', 'slate'],
        ),
      },
      requiredForCompleteness: true,
      defaultValue: 'draft',
      isIndexed: true,
      group: 'governance',
    },
    { key: 'effective_date', label: 'Effective date', type: 'date', isIndexed: true, group: 'governance' },
    { key: 'review_date', label: 'Next review', type: 'date', isIndexed: true, group: 'governance' },
    {
      key: 'tags',
      label: 'Tags',
      type: 'multi_select',
      config: {
        options: options(['confidential', 'Confidential'], ['external', 'External'], ['legal', 'Legal review']),
      },
      group: 'summary',
    },
    { key: 'source_url', label: 'Source', type: 'url', group: 'summary' },
    { key: 'verified', label: 'Verified', type: 'checkbox', group: 'governance' },
  ],
};

/**
 * Blank is exactly what the card says: Title only (UI/UX §3.2). It is the
 * escape hatch for a shape none of the others fit — shipping it with fields
 * would mean every custom type starts by deleting somebody else's guesses.
 */
const blank: ItemTypePreset = {
  key: 'blank',
  label: 'Item',
  pluralLabel: 'Items',
  description: 'Start from a title and add your own fields.',
  icon: 'square',
  color: 'slate',
  conceptHint: 'Add fields as you discover you need them — renaming one never touches stored data.',
  groups: [],
  fields: [],
};

export const ITEM_TYPE_PRESETS: ItemTypePreset[] = [
  task,
  clientProject,
  campaign,
  productVariant,
  structuredRecord,
  blank,
];

export const PRESETS_BY_KEY: Record<string, ItemTypePreset> = Object.fromEntries(
  ITEM_TYPE_PRESETS.map((p) => [p.key, p]),
);

/** Seeded into a brand-new workspace so it is never empty on first login. */
export const DEFAULT_WORKSPACE_PRESETS = ['task', 'client_project'] as const;
