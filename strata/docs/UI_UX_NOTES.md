# Strata — UI/UX Design Notes

**Version:** 1.0
**Date:** August 15, 2026
**Companion to:** `strata-PRD.md` (§6 is the requirement this document implements)

---

## 1. Design Philosophy

**Tone:** Dense and data-forward, but calm. Strata shows more information per screen than Monday does, so it cannot also be as loud as Monday. Color carries meaning — status, completeness, validity, inheritance — and is never decorative. If a color does not encode something, it should be a neutral.

**Key design values, in priority order:**

1. **Speed of input.** The primary persona is doing data entry for two hours. Every keystroke saved compounds. Nothing that can be done with the keyboard should require the mouse.
2. **Legibility of structure.** Three hierarchy axes are the product's hardest concept. Structure must be visible without being explained.
3. **Reversibility.** Users edit boldly when undo is real. Every destructive or wide-reaching action shows what it will do and offers a way back.
4. **Progressive disclosure.** Complexity exists but is not the first thing anyone sees. This is the difference between Strata and Akeneo, and it is a design problem before it is an engineering one.

**Reference aesthetics:** **Linear** for density, keyboard-first interaction, and restraint. **Airtable** for grid feel and field-type affordances. **Stripe Dashboard** for information hierarchy in data-heavy tables. **Notion** for how side panels and nested structure feel.

**Explicitly not:** Monday's saturated color blocks. They read as friendly at 30 items and as chaos at 3,000.

### 1.1 The one thing to get right

If a designer reads only one paragraph: **the grid must feel like a spreadsheet within three seconds of a user touching it.** Arrow keys move the selection. Typing replaces the cell. Enter commits and moves down. Tab commits and moves right. Ctrl+C copies TSV that pastes into Excel. If any of those is wrong, the user concludes it is "a table, not a spreadsheet" and stops evaluating the differentiator.

---

## 2. Design System

| Token | Value / Approach |
|---|---|
| **Primary** | Indigo `#4F46E5` — actions, active nav, focus rings |
| **Accent** | Amber `#F59E0B` — inherited-value markers, propagation states, warnings |
| **Success** | Emerald `#10B981` — 100% completeness, valid, committed |
| **Danger** | Rose `#E11D48` — destructive actions, validation errors |
| **Info** | Sky `#0EA5E9` — preview states, hints |
| **Neutrals** | Slate 50→950. Grid chrome lives in 100–300; text in 700–900 |
| **Completeness ramp** | Rose 500 (0–33) → Amber 500 (34–66) → Emerald 500 (67–99) → Emerald 600 solid (100). Never a rainbow gradient; three stops plus a "done" state, tested for AA contrast on white and on Slate-50 row stripes. |
| **Font — UI** | Inter var. `-0.011em` tracking at body size |
| **Font — numeric/grid** | Inter with `font-variant-numeric: tabular-nums`. **Mandatory in grid cells** — proportional digits make columns of numbers unreadable |
| **Font — code/keys** | JetBrains Mono, for field keys and API examples |
| **Type scale** | 11 / 12 / 13 / 14 / 16 / 20 / 24 / 32. Grid body is **13px** — 14 wastes horizontal space at 40 columns, 12 fails readability over a two-hour session |
| **Radius** | 6px default, 4px inside the grid, 10px on modals and panels |
| **Spacing** | 4px base grid. Grid row heights: short 32px, medium 40px, tall 56px |
| **Shadows** | Two only: `sm` for raised chrome, `lg` for overlays. No shadow soup |
| **Borders** | 1px Slate-200. The grid uses borders, not zebra striping — stripes fight cell selection highlighting |
| **Motion** | 120ms ease-out for state changes, 200ms for panels. **Zero animation inside the grid viewport** — animated cells at 60fps scroll is a frame budget nobody has |
| **Component library** | shadcn/ui (copy-in, modified freely for dense chrome) |
| **Icons** | Lucide, 16px in chrome, 14px in grid cells |
| **Dark mode** | Phase 2. Design tokens are defined as CSS variables from day one so it is not a rewrite |

### 2.1 Field type visual language

Each field type gets a consistent icon and cell treatment, so a user learns the vocabulary once:

| Type | Icon | Cell treatment |
|---|---|---|
| `text` | `Type` | Left-aligned, truncate with ellipsis, full value in tooltip |
| `long_text` | `AlignLeft` | Single line + expand affordance; opens a popover editor |
| `number` / `currency` / `percent` | `Hash` / `DollarSign` / `Percent` | **Right-aligned, tabular numerals**, formatted per config |
| `date` / `datetime` | `Calendar` / `Clock` | Left-aligned, relative for ±7 days ("in 3 days"), absolute otherwise |
| `select` | `ChevronDownCircle` | Colored pill, left-aligned |
| `multi_select` | `Tags` | Up to 2 pills + "+N" overflow chip |
| `checkbox` | `CheckSquare` | Centered checkbox, no label |
| `url` / `email` | `Link` / `Mail` | Link-styled, click opens; **click target is a small icon** so clicking the cell still selects it |
| `user` | `User` | Avatar + name; avatar only under 120px column width |
| `relation` | `ArrowUpRight` | Item title as a chip; click opens that item's detail panel |

---

## 3. Screen-by-Screen

### 3.1 Workspace Shell

**Purpose:** navigation frame for everything. Present on every authenticated screen.

**Layout:** fixed 240px left sidebar, collapsible to a 56px icon rail. Content fills the rest. No top nav — vertical space belongs to data.

**Sidebar contents, top to bottom:**

- Workspace switcher (name + avatar, dropdown)
- Search / command palette trigger (`⌘K`)
- **Item Types** — list with icon + label + item count; each expands to its saved views
- **Trees** — built-in and custom, each expandable to browse nodes
- **Activity**, **Import**
- Bottom: user avatar → settings, members, API keys, sign out

**States:**
- *Empty (new workspace):* Item Types section shows a single primary "Create your first Item Type" card with the six preset chips visible inline. The user should be able to start without opening anything.
- *Loading:* skeleton rows, no spinner.
- *Error:* inline banner at the top of the content area; the sidebar stays usable.

**Primary CTA:** "New Item Type" for a new workspace; the last-used view for a returning user (the app remembers and lands there directly).

---

### 3.2 Item Type Builder

**Purpose:** the two-minute gate. A non-technical user defines a structured schema without knowing they did.

**Layout:** centered single column, max 720px. Not a split-pane schema editor — that framing alone signals "database tool" and loses the persona.

**Default (non-Advanced) contents, and nothing else:**

1. Icon picker + name input, on one row
2. Optional one-line description
3. **Fields list** — each row: drag handle · name input · type picker · required toggle · overflow menu
4. "+ Add field" ghost row at the bottom, always visible
5. `> Advanced` collapsed disclosure
6. Sticky footer: "Create Item Type" / "Save changes"

**The preset step comes first.** Clicking "New Item Type" shows six cards before the builder:

| Preset | Ships with |
|---|---|
| **Task** | Title, Assignee, Status, Due Date, Priority |
| **Client Project** | Title, Client, Owner, Status, Start, Due, Budget, Brief URL |
| **Campaign** | Title, Owner, Channel, Status, Launch Date, Budget, Region *(variants pre-enabled on Region)* |
| **Product Variant** | Title, SKU, Category, Price, Status, Region, Size *(two variant axes)* |
| **Structured Record** | Title, Record Type, Owner, Status, Reference ID, Notes |
| **Blank** | Title only |

Each card shows its field names on the face. A user who picks "Client Project" is one click from a working schema — that is the two-minute path, and the presets exist to make it real rather than aspirational.

**Advanced section (collapsed, remembers per-user state):**

- Field groups — create, name, drag fields between
- Variants — enable, choose axis field(s), mark each field shared vs. variant-level
- Completeness — which fields count as required (this is also reachable per-field via the required toggle, so most users never open this)
- API — the immutable `key` for each field, copyable

**Field row interaction:**

- New field: type the name, press Tab, pick a type. Type-specific config expands *inline beneath the row* only after a type is chosen — select options, number precision, relation target.
- Changing a field's type opens a conversion preview: "412 values convert cleanly · 18 will be rounded · 3 will be kept as text and flagged." Confirm or cancel. **Nothing is destroyed silently.**
- Deleting a field: "Delete 'Budget'? Its values are kept for 30 days and can be restored." Not a bare "are you sure."

**States:**
- *Empty:* the preset picker, never a blank field list.
- *Editing an in-use type:* a persistent info bar — "Used by 1,247 items. Changes apply immediately."
- *Adding a required field to an in-use type:* blocking dialog — supply a default, or acknowledge "1,247 items will become incomplete."
- *Error:* inline per field row.

**Primary CTA:** "Create Item Type" → lands directly in the grid view with the new-item row focused. The user should be typing data within seconds of finishing the schema.

---

### 3.3 Grid View — the hero screen

**Purpose:** edit hundreds of structured items as fast as a spreadsheet.

**Layout:**

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Client Projects ▾   Grid  List  Board        [⚙ Fields] [⇅ Sort] [▼ Filter] [↑]│
├────────────────────────────────────────────────────────────────────────────────┤
│ ▣ │ ⛶ Title            │ Client   │ Status   │ Owner  │ Due      │ ▓ Compl. │ + │
├───┼────────────────────┼──────────┼──────────┼────────┼──────────┼──────────┼───┤
│ ▸ │ Acme Q3 Rebrand    │ Acme     │ ●Active  │ 🅐 Dana │ Sep 12   │ ███░ 78% │   │
│   │   ├ Logo refresh   │ Acme     │ ●Active  │ 🅑 Sam  │ Aug 29   │ ████ 100%│   │
│   │   └ Style guide    │ Acme     │ ○Blocked │ 🅐 Dana │ Sep 05   │ ██░░ 45% │   │
│ ▸ │ Globex Site Build  │ Globex   │ ●Active  │ 🅒 Ali  │ Oct 01   │ ███░ 82% │   │
│   │ Initech Campaign   │ Initech  │ ◐Draft   │ —      │ —        │ █░░░ 30% │   │
│ + │ New item…                                                                  │
├────────────────────────────────────────────────────────────────────────────────┤
│ 1,247 items · 12 selected · Avg completeness 71%          [Bulk edit ▾] [Export]│
└────────────────────────────────────────────────────────────────────────────────┘
```

**Key elements:**

- **View bar:** view name with a dropdown of saved views; view-type switcher (Grid / List / Board) that preserves filters and sort; field picker; sort builder; filter builder; export.
- **Header row:** sticky. Each column shows the field-type icon, label, and a sort indicator. Right-click for column actions (pin, hide, sort, group by, insert field). Drag to reorder; drag the edge to resize. The trailing `+` adds a field inline without leaving the grid.
- **Row gutter:** expander chevron for items with work-hierarchy children (children render indented, in-place), selection checkbox, row-hover actions (open detail, overflow menu).
- **Cells:** 32px tall by default. Selected cell gets a 2px indigo border. A multi-cell selection gets a filled indigo-50 background and a single border around the rectangle, with a fill handle at the bottom-right.
- **Completeness column:** always available, a 4-segment bar plus a %.
- **New-item row:** permanently pinned at the bottom. Type a title, press Enter, item exists, cursor lands on the next new row.
- **Footer bar:** total count, selection count, aggregate completeness, and the bulk-edit entry point (which is only enabled when > 1 row is selected).

**States:**

- *Empty (no items):* not a shrug. A three-option card — "Add your first item," "Import a spreadsheet," "See an example." Import is deliberately as prominent as manual creation, because the persona has a file.
- *Empty (filtered to nothing):* "No items match these filters" + a "Clear filters" button that names how many filters are active.
- *Loading:* skeleton rows preserving the column layout — never a centered spinner. The chrome should never appear to move.
- *Loading more (scroll):* a shimmer on the incoming rows only.
- *Cell error:* rose left-edge bar on the cell, rose text, and a tooltip with the specific message ("Expected a number — got 'TBD'"). **The row saves anyway.** The flagged value persists and is visible.
- *Saving:* a subtle indigo dot in the row gutter, cleared on confirmation. No blocking, no spinner over the cell.
- *Offline / write failure:* the cell reverts to the server value with a toast: "Couldn't save — Dana changed this 4 seconds ago. [Review]"

**Primary CTA:** none, in the button sense. The grid's CTA is the cursor. The most important design outcome is that a user starts typing without being invited to.

---

### 3.4 Bulk Edit — preview and undo

**Purpose:** make wide changes trustworthy. This flow is the reason people will use the bulk tools at all.

**Trigger:** select > 1 row → footer "Bulk edit" enables → pick an operation → configure → **Preview**.

**Preview modal:**

```
┌─────────────────────────────────────────────────────────────┐
│  Preview changes                                       [✕]  │
├─────────────────────────────────────────────────────────────┤
│  Set  Status  →  ● Active                                   │
│                                                             │
│  142 items will change · 8 items skipped                    │
│                                                             │
│  ⚠ 8 skipped:  6 no permission · 2 locked      [Show all]   │
│                                                             │
│  ┌───────────────────┬────────────┬────────────┐            │
│  │ Item              │ Before     │ After      │            │
│  ├───────────────────┼────────────┼────────────┤            │
│  │ Acme Q3 Rebrand   │ ◐ Draft    │ ● Active   │            │
│  │ Logo refresh      │ ○ Blocked  │ ● Active   │            │
│  │ … 17 more shown · 142 total                 │            │
│  └───────────────────┴────────────┴────────────┘            │
│                                                             │
│                            [Cancel]  [Apply to 142 items]   │
└─────────────────────────────────────────────────────────────┘
```

Rules:

- The commit button **names the count**. "Apply to 142 items," never "Confirm."
- Skipped items are surfaced with reasons, always, even when zero (as a quiet "0 skipped").
- Nothing is applied on a timer or on modal dismiss.
- Above 500 items, the modal explains it will run in the background and stays dismissible.

**Undo toast**, immediately on commit, bottom-center, persistent for 60 seconds:

```
┌──────────────────────────────────────────────────┐
│ ✓ Updated Status on 142 items       [Undo]  [✕]  │
└──────────────────────────────────────────────────┘
```

A thin progress line drains across the 60 seconds. After it expires the change set remains undoable from the activity feed for 24 hours, and the toast says so as it fades.

---

### 3.5 Item Detail Panel

**Purpose:** the full picture of one item, including everything the grid cannot show.

**Layout:** right side panel, 480px, resizable to 720px, over any view. Full screen on tablet. Deep-linkable.

```
┌──────────────────────────────────────────┐
│ ← Acme Q3 Rebrand              [⋯]  [✕]  │
│ Client Projects · Acme › Q3              │  ← type + hierarchy breadcrumb
├──────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓░░░  78% complete                 │
│ Missing: Budget · Brief URL              │  ← each is a click-to-focus link
├──────────────────────────────────────────┤
│ 🏷 [Client: Acme ✕] [Product: Widgets ✕]│  ← tree chips, removable
├──────────────────────────────────────────┤
│ ⌄ Details                                │
│   Client      Acme Corp                  │
│   Owner       🅐 Dana Reyes               │
│   Status      ● Active                   │
│ ⌄ Timeline                               │
│   Start       Jul 01, 2026               │
│   Due         Sep 12, 2026               │
│ ⌄ Commercial                             │
│   Budget      —  Required                │
├──────────────────────────────────────────┤
│ ⌄ Sub-items (2)                          │
│   Logo refresh          ████ 100%        │
│   Style guide           ██░░  45%        │
├──────────────────────────────────────────┤
│ ⌄ Activity                               │
│   Dana set Status Draft → Active   2h ago│
│   Sam imported 142 items          Aug 12 │
└──────────────────────────────────────────┘
```

**Notes:**

- Fields are grouped by **field group**, collapsible, state remembered per user per Item Type. A 40-field item must never render as a 40-row wall.
- Missing required fields are listed at the top and clicking one scrolls to and focuses it.
- Empty required fields show a subtle "Required" tag inline; empty optional fields show `—`.
- Every value edits in place. No edit-mode toggle.

**Variant banner** (only when the item is a variant):

```
┌──────────────────────────────────────────┐
│ ⟲ Variant of “Q3 Launch Campaign”        │
│   Region: EMEA                           │
│   6 fields inherited · 2 overridden      │
│   (Region is this variant's own axis)    │
└──────────────────────────────────────────┘
```

Inherited values render in Slate-500 with a small amber `⟲` and an "Inherited from Q3 Launch Campaign" tooltip. Hovering reveals **Override**. An overridden value renders in normal text with an amber left-edge bar and a **Revert to inherited** action. Both states are distinguishable at a glance without reading — this is the single most important detail in making variants comprehensible.

---

### 3.6 Board View

**Purpose:** the Contributor's screen. Someone can live here for months and never learn the data model.

**Layout:** horizontally scrolling columns grouped by any `select` or `user` field. Column header: value pill, count, "+" to add. Cards show title, avatar, due date, up to 2 configured fields, and a thin completeness bar along the bottom edge.

**States:** empty column shows a dashed drop target with the value name. Drag between columns writes the field via a change set and shows the same undo toast — consistency across surfaces matters more than board-specific polish.

---

### 3.7 List View

**Purpose:** the familiar on-ramp for Monday/ClickUp switchers, and the best surface for reading the work hierarchy.

Rows with indent-based nesting, expander chevrons, inline editing of primary fields only, and the same filter/sort as grid. Denser than board, less dense than grid. This is the view a new user should land on before they discover the grid.

---

### 3.8 Tree Manager

**Purpose:** build and maintain category trees.

**Layout:** two panes. Left: tree list and node hierarchy, drag to reorder and reparent, item count per node. Right: the items in the selected node, with an "Include sub-categories" toggle.

**Drag from the item pane onto a node** assigns membership. Multi-select drag assigns in bulk, with a preview when > 1 item.

**Node deletion** always asks: "3 items are in 'Retainer'. Unassign them · Move to parent ('Acme') · Move to another node…" **Never silently orphan.**

**Empty state** teaches: "Trees classify items independently of their work hierarchy. An agency might have a Client tree and a Service Line tree — an item can be in both at once." Concrete, drawn from a real use case, not abstract.

---

### 3.9 Import Flow

Four steps with a persistent progress header. Any step is navigable backward without losing state.

1. **Upload** — drop zone, CSV/XLSX, 50MB. If an Import Profile exists for this Item Type, offer it here and skip straight to step 3.
2. **Map** — two columns: source column (with 3 sample values) → target field (fuzzy-suggested, with a confidence dot: green = high, amber = guess, grey = unmapped). Unmapped columns are explicit, not silent. Choose an optional match key for update-vs-create. "Save as profile" checkbox.
3. **Validate** — dry run. "4,812 rows · 4,780 will be created · 18 will update matched items · 14 warnings." Warnings grouped by column with examples. Download error CSV.
4. **Commit** — one change set, progress bar, then the undo toast and a link to the imported set.

**States:** parse failure names the row and column. A file over the row cap says so before parsing. Nothing writes until step 4.

---

### 3.10 Shared View (Guest)

Simplified chrome: view name, workspace name, no sidebar, no bulk tools. Only the fields in the view's `visible_fields`.

**Two distinct surfaces, deliberately not conflated:**

| Surface | Auth | Rights |
|---|---|---|
| `/share/[token]` | None — anyone with the link | **Read-only.** No editing, because an anonymous request has no member row to scope permissions against. |
| Signed-in Guest | Invited, has a `workspace_members` row + `guest_scopes` | Read plus edit on granted fields, within their scoped tree branch. Uses the normal app shell with a scoped sidebar. No create, no delete, no bulk, no API. |

The share link is for showing a client a status board. Editing requires an account. Merging the two would mean granting write access to a URL, which is a permission model nobody can reason about.

**Required admin-side warning** wherever a view is shared externally:

> ⚠️ Hiding fields in a view controls what's *displayed*, not what's *permitted*. Only share with people you'd trust with the whole item type. Field-level permissions are coming in a future release.

This is uncomfortable copy and it ships anyway. See PRD §9 Risk 3.

---

## 4. Navigation Structure

```
Strata
├── /login · /signup · /invite/[token]
└── /w/[slug]
    ├── (home)                     — recent views, activity summary
    ├── types/
    │   ├── (list)                 — all item types
    │   └── [typeId]/
    │       ├── builder            — Item Type Builder
    │       └── v/[viewId]         — Grid | List | Board
    ├── items/[itemId]             — detail (deep link; renders as full page)
    ├── trees                      — Tree Manager
    ├── import                     — Import flow
    ├── activity                   — workspace change history
    └── settings/
        ├── members                — invites, roles, guest scopes
        ├── api-keys
        └── webhooks
/share/[token]                     — public shared view (no auth, READ-ONLY)
```

- **Nav type:** left sidebar, collapsible to an icon rail. No top nav.
- **Auth gates:** everything under `/w/` requires membership. `/share/[token]` needs no auth and is read-only; signed-in Guests get the normal `/w/` shell with a scoped sidebar.
- **Deep links:** every view, item, and tree node is directly linkable. Filter state serializes to the URL so a filtered grid can be pasted into Slack.
- **Command palette (`⌘K`):** jump to any view, item, or Item Type; run "New item," "Import," "Create view."

---

## 5. Key Interaction Patterns

### 5.1 The grid keyboard map — normative

This table is the specification. Implement it exactly; users bring these bindings with them from Excel and any deviation reads as a bug.

| Key | Action |
|---|---|
| `↑ ↓ ← →` | Move selection one cell |
| `Tab` / `Shift+Tab` | Commit, move right / left (wraps to next row) |
| `Enter` / `Shift+Enter` | Commit, move down / up |
| `Ctrl/⌘ + ↑↓←→` | Jump to the edge of the data region |
| `Shift + ↑↓←→` | Extend selection |
| `Ctrl/⌘ + Shift + ↑↓←→` | Extend selection to edge |
| `Ctrl/⌘ + A` | Select all loaded rows |
| *any printable char* | Replace cell contents, enter edit mode |
| `F2` / `Double-click` | Edit in place, cursor at end |
| `Esc` | Cancel edit / collapse selection to one cell |
| `Delete` / `Backspace` | Clear selected cells |
| `Ctrl/⌘ + C` / `X` / `V` | Copy / cut / paste TSV |
| `Ctrl/⌘ + D` | Fill down from the top row of the selection |
| `Ctrl/⌘ + Z` / `Shift+Z` | Undo / redo (≥ 50 operations, bulk included) |
| `Ctrl/⌘ + Enter` | Open the selected row's detail panel |
| `Space` | Toggle a checkbox cell / expand a hierarchy row |
| `Ctrl/⌘ + K` | Command palette |
| `/` | Focus the filter bar |

**Clipboard contract:**
- Copy writes `text/plain` as TSV (tab-delimited, `\n` rows, values containing tabs/newlines quoted) and `text/html` as a table, so rich targets get structure.
- Paste reads TSV, maps onto the selection rectangle (a single selected cell means paste extends down and right from it), coerces per destination column type, and **previews non-convertible values before committing**.
- Pasting more rows than exist offers to create the extra items rather than silently truncating.

### 5.2 Forms and validation

- Validate on blur, not on keystroke. Keystroke validation on a date field means telling someone "invalid" while they type it.
- Errors render below the field or inside the cell, in specific language: "Expected a number — got 'TBD'." Never "Invalid input."
- **Never block the save.** Bad values persist as flagged drafts; every other field commits. (PRD §6.4.)
- Required fields are marked with a "Required" tag, not an asterisk. Asterisks are a convention users have to remember.

### 5.3 Confirmations

Reserved for actions that are genuinely irreversible or wide-reaching, so they retain meaning:

| Action | Treatment |
|---|---|
| Single-cell edit | None. Undo covers it. |
| Bulk edit | Preview modal + undo toast |
| Delete items | Preview modal naming the count + undo toast (soft delete, 30 days) |
| Delete a field | Dialog naming the 30-day retention |
| Delete a tree node with members | Dialog with three explicit dispositions |
| Change a field's type | Conversion preview with clean/coerced/preserved counts |
| Delete an Item Type in use | Type-the-name-to-confirm |
| Delete a workspace | Type-the-name-to-confirm + email |

Confirmation copy always names the object and the count. Never "Are you sure?"

### 5.4 Feedback

- Async actions ≤ 1s: optimistic, no indicator.
- 1–5s: inline progress in place (a row-gutter dot, a button spinner).
- \> 5s: background job, toast with progress, UI stays usable, notification on completion.
- Success toasts only where the result is not visible on screen. A cell edit is its own confirmation; a background export is not.
- Errors are toasts *with an action* ("Couldn't save · [Retry]"), never a bare message.

### 5.5 Motion

120ms ease-out for state changes; 200ms for panel and modal entry. Row expansion animates height. **Nothing animates inside the grid viewport during scroll.** All motion respects `prefers-reduced-motion`.

### 5.6 Responsive

| Breakpoint | Behavior |
|---|---|
| ≥ 1280px | Full grid, sidebar expanded, detail panel side-by-side |
| 1024–1280px | Sidebar auto-collapses to icon rail; detail panel overlays |
| 768–1024px (tablet) | Grid becomes horizontally scrollable with the title column pinned; inline editing still works; bulk tools move into a bottom sheet; detail panel is full-screen |
| < 768px (phone) | Read-mostly. List and board only; grid shows a "best on a larger screen" notice with a link to list view. Single-field editing via the detail panel. **No pretense of spreadsheet editing on a phone.** |

Touch targets ≥ 44px below 1024px. Drag interactions get long-press activation on touch.

---

## 6. Progressive Disclosure — the mechanism

PRD §6.1 is a requirement; this is how it is enforced in the interface.

**Three tiers, applied consistently:**

| Tier | What lives here | Where |
|---|---|---|
| **Tier 1 — always visible** | Item name, fields, types, required toggle, the item grid | Default screens |
| **Tier 2 — one click away** | Field groups, filters, sort, view config, tree assignment | `Advanced` disclosure, or a toolbar popover |
| **Tier 3 — opt-in per Item Type** | Variants, variant axes, shared/variant field marking, completeness configuration, field-level API keys | Advanced section; the *concept* stays invisible until enabled |

**The invisibility rule:** a user never encounters the words "variant," "axis," "inheritance," or "completeness" until they have either enabled the feature or opened an item that already uses it. A workspace using none of them should present as a slightly nicer Monday.

**Where the rule gets enforced in code:** `AdvancedSection.tsx` is collapsed by default and remembers state *per user*, not per workspace. Preset-created Item Types with variants pre-enabled (Campaign, Product Variant) are the exception — those users chose the concept by picking the preset, and the concept hint fires on first open.

---

## 7. In-Product Concept Explanations

Per PRD §6.6, each hard concept explains itself where it is first encountered. A help-center article does not count as shipped.

**Pattern:** a dismissible inline card, appearing once per concept per user, with a one-sentence *what* and a concrete *why* drawn from the workspace's own preset.

**Variants** — on first opening an item that is a variant, or first enabling variants:

> **Variants let one item have versions that share most of their data.**
> A "Q3 Launch Campaign" can have EMEA, APAC, and AMER versions. The tagline and budget are shared — change them once and all three update. Launch date and local assets belong to each version.
> [Got it] [Show me an example]

**Category trees** — on first opening the tree manager:

> **Trees organize items separately from how they're nested.**
> A deliverable can sit under "Q3 Rebrand" in your project hierarchy *and* in "Acme" on your Client tree *and* "Design" on your Service tree — all at once, without duplicating it.
> [Got it] [Show me an example]

**Completeness** — on first seeing a completeness bar under 100%:

> **Completeness shows how much required data an item is missing.**
> You choose which fields count. This one is at 78% — Budget and Brief URL are empty. Filter any view to "Incomplete only" to find gaps before a client does.
> [Got it] [Set required fields]

**The three axes** — a one-time diagram on first opening an item that participates in more than one:

```
      Work hierarchy          Category trees            Variants
      "part of"               "classified as"           "version of"

      Q3 Rebrand              Client › Acme             Q3 Campaign
        └ Logo refresh        Service › Design            ├ EMEA
            └ Icon set        Product › Widgets           └ APAC
```

**Rules:** dismissible forever, per concept, per user. Never modal — always inline, in context, at the moment of encounter. Re-accessible via a `?` affordance on the relevant section header.

---

## 8. Accessibility

Target: **WCAG 2.2 AA** as an aspiration; the items below are commitments for v1.

- **Contrast:** all text ≥ 4.5:1, UI borders and icons ≥ 3:1. The completeness ramp is verified at every stop against both white and Slate-50 backgrounds. **Completeness is never encoded by color alone** — the % is always present.
- **Keyboard:** every interactive element reachable and operable. The grid implements the full §5.1 map. Focus rings are visible, 2px indigo, never suppressed. Modals trap focus and restore it on close.
- **Grid semantics:** `role="grid"` with `rowindex`/`colindex`, `aria-selected` on cells, `aria-rowcount` reflecting the total (not the virtualized window) — virtualization must not lie to a screen reader about how much data exists.
- **Announcements:** `aria-live="polite"` for selection changes ("12 cells selected"), save confirmations, and bulk results ("142 items updated"). `aria-live="assertive"` for validation errors only.
- **Forms:** every input has an associated `<label>`; errors linked via `aria-describedby` and marked `aria-invalid`.
- **Icons:** decorative icons `aria-hidden`; icon-only buttons carry an `aria-label`.
- **Motion:** `prefers-reduced-motion` disables all transitions.
- **Screen-reader specifics:** inherited variant values are announced as "inherited from Q3 Launch Campaign" rather than relying on the amber marker; tree depth is announced via `aria-level`; hierarchy expanders use `aria-expanded`.
- **Testing:** `@axe-core/playwright` on every major screen in CI, plus a manual keyboard-only walkthrough of the grid and the Item Type builder before every release. Automated checks do not catch a grid that is technically labeled and practically unusable.

**Known gap:** a virtualized 10,000-row grid is inherently difficult with a screen reader. v1 mitigation is the List view, which is fully accessible and covers the same data. This is a stated limitation, not an oversight.

---

## 9. Wireframes

### 9.1 Item Type Builder

```
┌────────────────────────────────────────────────────────────┐
│  ← Item Types                                              │
│                                                            │
│   ┌──┐                                                     │
│   │📁│  Client Projects                                    │
│   └──┘  Work we deliver for retainer clients               │
│                                                            │
│   FIELDS                                                   │
│   ┌──────────────────────────────────────────────────────┐ │
│   │ ⠿  Title            [Aa Text        ▾]  Req ●   ⋯   │ │
│   │ ⠿  Client           [🔗 Relation    ▾]  Req ●   ⋯   │ │
│   │ ⠿  Owner            [👤 User        ▾]  Req ○   ⋯   │ │
│   │ ⠿  Status           [◉ Select       ▾]  Req ●   ⋯   │ │
│   │      ● Draft  ● Active  ● Blocked  ● Done   + Add    │ │  ← inline config
│   │ ⠿  Due Date         [📅 Date        ▾]  Req ○   ⋯   │ │
│   │ ⠿  Budget           [$ Currency     ▾]  Req ●   ⋯   │ │
│   │ +  Add field                                         │ │
│   └──────────────────────────────────────────────────────┘ │
│                                                            │
│   ▸ Advanced                                               │
│     (field groups · variants · completeness · API keys)    │
│                                                            │
├────────────────────────────────────────────────────────────┤
│                                  [Cancel]  [Save changes]  │
└────────────────────────────────────────────────────────────┘
```

### 9.2 Grid with an active multi-cell selection

```
┌──────────────────────────────────────────────────────────────────────┐
│ Client Projects ▾  │ Grid │ List │ Board │      [⚙][⇅][▼]  [Export] │
├──────────────────────────────────────────────────────────────────────┤
│ ▣ │⛶ Title          │ Client │ Status  │ Owner │ Due    │ ▓ Compl.  │
├───┼─────────────────┼────────┼─────────┼───────┼────────┼───────────┤
│ ☑ │ Acme Q3 Rebrand │ Acme   │╔═══════╗│🅐 Dana│ Sep 12 │ ███░  78% │
│ ☑ │  ├ Logo refresh │ Acme   │║●Active║│🅑 Sam │ Aug 29 │ ████ 100% │
│ ☑ │  └ Style guide  │ Acme   │║○Blockd║│🅐 Dana│ Sep 05 │ ██░░  45% │
│ ☑ │ Globex Site     │ Globex │║●Active║│🅒 Ali │ Oct 01 │ ███░  82% │
│   │ Initech Camp.   │ Initech│╚══════◢║│  —    │  —     │ █░░░  30% │
│ + │ New item…                        ▲ fill handle                  │
├──────────────────────────────────────────────────────────────────────┤
│ 1,247 items · 4 cells, 4 rows selected · Avg 71%  [Bulk edit ▾][↑]  │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.3 Grid + detail panel

```
┌─────────────────────────────────┬────────────────────────────┐
│ ▣│⛶ Title        │Client│Status│ │ ← Acme Q3 Rebrand   [⋯][✕]│
├──┼───────────────┼──────┼──────┤ │ Client Projects·Acme › Q3  │
│  │▸Acme Q3 Rebra…│ Acme │●Actv │ ├────────────────────────────┤
│  │  ├ Logo refr… │ Acme │●Actv │ │ ▓▓▓▓▓▓▓░░░ 78% complete    │
│  │  └ Style gui… │ Acme │○Blkd │ │ Missing: Budget·Brief URL  │
│  │ Globex Site   │Globex│●Actv │ ├────────────────────────────┤
│  │ Initech Camp. │Initec│◐Draft│ │ 🏷[Client:Acme ✕][Widgets ✕]│
│  │               │      │      │ ├────────────────────────────┤
│  │               │      │      │ │ ⌄ Details                  │
│  │               │      │      │ │   Client   Acme Corp       │
│  │               │      │      │ │   Owner    🅐 Dana Reyes    │
│  │               │      │      │ │   Status   ● Active        │
│  │               │      │      │ │ ⌄ Commercial               │
│  │               │      │      │ │   Budget   —      Required │
│  │               │      │      │ ├────────────────────────────┤
│  │               │      │      │ │ ⌄ Activity                 │
│  │               │      │      │ │   Dana · Status → Active   │
└──┴───────────────┴──────┴──────┴─┴────────────────────────────┘
```

### 9.4 Variant model and its variants, in grid

```
┌────────────────────────────────────────────────────────────────────┐
│ Campaigns ▾   Grid │ List │ Board                                  │
├────────────────────────────────────────────────────────────────────┤
│ ▣│⛶ Title              │Region│ Tagline        │Launch  │ Budget   │
├──┼─────────────────────┼──────┼────────────────┼────────┼──────────┤
│  │▾ ⟲ Q3 Launch Campgn │  —   │ Build Better   │  —     │  —       │  ← model
│  │   ├ Q3 Launch (EMEA)│ EMEA │⟲Build Better   │Sep 01  │⟲ £40,000 │
│  │   ├ Q3 Launch (APAC)│ APAC │⟲Build Better   │Sep 15  │▎£52,000  │  ← override
│  │   └ Q3 Launch (AMER)│ AMER │⟲Build Better   │Sep 01  │⟲ £40,000 │
└────────────────────────────────────────────────────────────────────┘
   ⟲ = inherited (Slate-500 text, amber glyph)
   ▎ = overridden (normal text, amber left bar)
```

### 9.5 Import — mapping step

```
┌──────────────────────────────────────────────────────────────┐
│  Import to Client Projects        ①Upload ②Map ③Check ④Done  │
├──────────────────────────────────────────────────────────────┤
│  projects_q3.xlsx · 4,812 rows · 6 columns                   │
│                                                              │
│  SOURCE COLUMN            SAMPLE           →  FIELD          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Project Name    Acme Q3 Rebrand, …     → [Title    ▾]● │  │
│  │ Account         Acme, Globex, …        → [Client   ▾]● │  │
│  │ Lead            dana@, sam@, …         → [Owner    ▾]◐ │  │
│  │ Deadline        2026-09-12, …          → [Due Date ▾]● │  │
│  │ Value           40000, 52000, …        → [Budget   ▾]● │  │
│  │ Notes           —                      → [Skip     ▾]○ │  │
│  └────────────────────────────────────────────────────────┘  │
│    ● matched   ◐ guess — please confirm   ○ not imported     │
│                                                              │
│  Match existing items by:  [Title ▾]   ☑ Save as profile     │
├──────────────────────────────────────────────────────────────┤
│                                     [Back]  [Check import →] │
└──────────────────────────────────────────────────────────────┘
```

---

## 10. Design Risks

| Risk | Mitigation |
|---|---|
| **Grid feels "almost like a spreadsheet"** — the uncanny valley is worse than an obviously plain table | Implement §5.1 exactly and completely. Test against real Excel and Google Sheets on macOS and Windows. Partial fidelity is the failure mode. |
| **Three axes overwhelm** | Progressive disclosure (§6) + concept hints (§7). Test comprehension in moderated sessions before build completes; if users conflate axes, hide variants behind per-type opt-in. |
| **Density reads as complexity** | Generous vertical rhythm in every surface *except* the grid. The grid earns its density; nothing else should imitate it. |
| **Completeness feels like nagging** | It's informational, never blocking. No red badges in the sidebar, no "you have 47 incomplete items" interruptions. The user goes looking for it. |
| **Inherited vs. overridden is invisible** | Two independent channels — color/weight *and* an icon/bar — never color alone. Verified in the accessibility pass. |
| **Preview modal becomes a habituated click-through** | It names the count on the button and surfaces skipped items. Track undo rate (PRD §8): a rising undo rate means the preview isn't being read, and the fix is design, not copy. |
