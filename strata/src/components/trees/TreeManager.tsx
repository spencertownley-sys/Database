'use client';

/**
 * The tree manager (UI/UX §3.8): two panes — the tree and its node hierarchy
 * on the left, the selected node's items on the right with an
 * include-sub-categories toggle.
 *
 * Node deletion always offers the three dispositions inline — unassign, move
 * to parent, move to another node — because items are never silently orphaned
 * (PRD §4.5). The empty state teaches what a second tree is *for* rather than
 * just offering a button.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { Item } from '@/server/db/schema/items';
import type { TreeNode } from '@/server/db/schema/trees';
import { api, ApiError, setWorkspaceId } from '@/lib/api';
import { CompletenessBar } from '@/components/item-detail/CompletenessBar';

type NodeRow = TreeNode & { childCount: number; descendantItemCount: number };

export function TreeManager(props: { workspaceId: string; workspaceSlug: string }) {
  const queryClient = useQueryClient();
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<NodeRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // During render, not in an effect — an effect would race the first queries.
  setWorkspaceId(props.workspaceId);

  const { data: treesData } = useQuery({
    queryKey: ['trees', props.workspaceId],
    queryFn: ({ signal }) => api.trees.list(signal),
  });
  const trees = useMemo(() => treesData?.data ?? [], [treesData]);
  const activeTreeId = selectedTreeId ?? trees[0]?.id ?? null;

  const { data: nodesData } = useQuery({
    queryKey: ['tree-nodes', activeTreeId],
    queryFn: ({ signal }) => api.trees.nodes(activeTreeId as string, signal),
    enabled: activeTreeId !== null,
  });
  const nodes = useMemo(() => nodesData?.data ?? [], [nodesData]);

  const { data: itemsData } = useQuery({
    queryKey: ['node-items', selectedNodeId, includeDescendants],
    queryFn: ({ signal }) =>
      api.items.list(
        { treeNodeId: selectedNodeId as string, includeDescendants, limit: 100 },
        signal,
      ),
    enabled: selectedNodeId !== null,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['trees', props.workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['tree-nodes', activeTreeId] });
    void queryClient.invalidateQueries({ queryKey: ['node-items'] });
  }, [activeTreeId, props.workspaceId, queryClient]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'That change could not be saved.');
      }
    },
    [refresh],
  );

  const nodeRows = useMemo(() => buildNodeRows(nodes, collapsed), [nodes, collapsed]);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  return (
    <div className="flex h-full min-h-0">
      {/* ---- left: trees and nodes ---- */}
      <aside className="flex w-80 shrink-0 flex-col border-r bg-[var(--color-surface)]">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h1 className="text-sm font-semibold">Trees</h1>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
            onClick={() => {
              const label = window.prompt('Name the new tree — e.g. "Service line"');
              if (label?.trim()) void run(() => api.trees.create({ label: label.trim() }));
            }}
          >
            + New tree
          </button>
        </div>

        {error && (
          <p role="alert" className="border-b bg-[var(--color-danger-soft)] px-3 py-1.5 text-xs text-[var(--color-danger)]">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {trees.map((tree) => (
            <div key={tree.id}>
              <button
                type="button"
                aria-pressed={tree.id === activeTreeId}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-medium ${
                  tree.id === activeTreeId ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-muted)]'
                }`}
                onClick={() => {
                  setSelectedTreeId(tree.id);
                  setSelectedNodeId(null);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{tree.label}</span>
                {tree.isBuiltIn && (
                  <span className="rounded bg-[var(--color-muted)] px-1.5 text-[10px] uppercase text-[var(--color-ink-subtle)]">
                    built-in
                  </span>
                )}
                <span className="tabular text-xs text-[var(--color-ink-subtle)]">{tree.nodeCount}</span>
              </button>

              {tree.id === activeTreeId && (
                <div className="pb-2">
                  {nodeRows.map(({ node, depth }) => (
                    <div
                      key={node.id}
                      className={`group flex items-center gap-1 py-1 pr-2 text-sm ${
                        node.id === selectedNodeId
                          ? 'bg-[var(--color-accent-soft)]'
                          : 'hover:bg-[var(--color-muted)]'
                      }`}
                      style={{ paddingLeft: 12 + depth * 16 }}
                    >
                      {node.childCount > 0 ? (
                        <button
                          type="button"
                          aria-expanded={!collapsed.has(node.id)}
                          aria-label={collapsed.has(node.id) ? 'Expand' : 'Collapse'}
                          className="rounded p-0.5 text-[var(--color-ink-subtle)]"
                          onClick={() =>
                            setCollapsed((cur) => {
                              const next = new Set(cur);
                              if (next.has(node.id)) next.delete(node.id);
                              else next.add(node.id);
                              return next;
                            })
                          }
                        >
                          {collapsed.has(node.id) ? (
                            <ChevronRight className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4" aria-hidden />
                      )}

                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left"
                        onClick={() => setSelectedNodeId(node.id)}
                        onDoubleClick={() => {
                          const label = window.prompt('Rename node', node.label);
                          if (label?.trim() && label !== node.label) {
                            void run(() => api.trees.patchNode(node.id, { label: label.trim() }));
                          }
                        }}
                      >
                        {node.label}
                      </button>

                      <span className="tabular text-xs text-[var(--color-ink-subtle)]" title="Items in this node (including sub-categories)">
                        {node.descendantItemCount}
                      </span>
                      <button
                        type="button"
                        aria-label={`Add a sub-category under ${node.label}`}
                        className="rounded p-0.5 text-[var(--color-ink-subtle)] opacity-0 hover:text-[var(--color-ink)] group-hover:opacity-100"
                        onClick={() => {
                          const label = window.prompt(`Name the sub-category under "${node.label}"`);
                          if (label?.trim() && activeTreeId) {
                            void run(() =>
                              api.trees.createNode(activeTreeId, {
                                label: label.trim(),
                                parentId: node.id,
                              }),
                            );
                          }
                        }}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${node.label}`}
                        className="rounded p-0.5 text-[var(--color-ink-subtle)] opacity-0 hover:text-[var(--color-danger)] group-hover:opacity-100"
                        onClick={() => setDeleting(node)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className="mt-1 flex items-center gap-1 px-3 py-1 text-xs text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]"
                    onClick={() => {
                      const label = window.prompt('Name the new category');
                      if (label?.trim() && activeTreeId) {
                        void run(() =>
                          api.trees.createNode(activeTreeId, { label: label.trim(), parentId: null }),
                        );
                      }
                    }}
                  >
                    <Plus className="h-3 w-3" /> Add category
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* ---- right: the selected node's items ---- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedNode === null ? (
          <div className="mx-auto max-w-md p-10 text-center">
            <p className="text-sm font-medium">Trees classify items independently of their work hierarchy.</p>
            <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
              An agency might have a Client tree and a Service Line tree — one deliverable can sit
              in “Acme” on the first and “Design” on the second at the same time, without being
              duplicated. Pick a category on the left to see what&apos;s filed there.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex h-11 items-center gap-3 border-b bg-[var(--color-surface)] px-4">
              <h2 className="text-sm font-semibold">{selectedNode.label}</h2>
              <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
                <input
                  type="checkbox"
                  checked={includeDescendants}
                  onChange={(e) => setIncludeDescendants(e.target.checked)}
                />
                Include sub-categories
              </label>
              <span className="text-xs text-[var(--color-ink-subtle)]">
                {itemsData?.meta.total != null ? `${itemsData.meta.total} items` : ''}
              </span>
            </div>

            {(itemsData?.data ?? []).map((item: Item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 border-b px-4 py-2 text-sm hover:bg-[var(--color-muted)]"
              >
                <a
                  className="min-w-0 flex-1 truncate font-medium no-underline hover:underline"
                  href={`/w/${props.workspaceSlug}/items/${item.id}`}
                >
                  {item.title || 'Untitled'}
                </a>
                <span className="w-24 shrink-0">
                  <CompletenessBar pct={item.completenessPct} compact />
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-[var(--color-ink-subtle)] hover:text-[var(--color-danger)]"
                  onClick={() => void run(() => api.trees.unassignItems(selectedNode.id, [item.id]))}
                >
                  Remove
                </button>
              </div>
            ))}
            {(itemsData?.data ?? []).length === 0 && (
              <p className="p-6 text-sm text-[var(--color-ink-subtle)]">
                Nothing is filed {includeDescendants ? 'under' : 'directly in'} “{selectedNode.label}”
                yet. Select rows in the grid and use bulk edit to file items here.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ---- deletion dispositions ---- */}
      {deleting && (
        <div
          role="dialog"
          aria-label={`Delete ${deleting.label}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="w-full max-w-md rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-5 shadow-lg">
            <h3 className="text-sm font-semibold">Delete “{deleting.label}”?</h3>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {deleting.itemCount > 0
                ? `${deleting.itemCount} item${deleting.itemCount === 1 ? ' is' : 's are'} filed here. Choose what happens to them — nothing is orphaned silently.`
                : 'This category is empty. Sub-categories move up one level.'}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {deleting.itemCount > 0 ? (
                <>
                  <button type="button" className="rounded border px-3 py-1.5 text-left text-sm hover:bg-[var(--color-muted)]"
                    onClick={() => { void run(() => api.trees.deleteNode(deleting.id, 'unassign')); setDeleting(null); }}>
                    Unassign the items
                  </button>
                  {deleting.parentId && (
                    <button type="button" className="rounded border px-3 py-1.5 text-left text-sm hover:bg-[var(--color-muted)]"
                      onClick={() => { void run(() => api.trees.deleteNode(deleting.id, 'move_to_parent')); setDeleting(null); }}>
                      Move them to the parent category
                    </button>
                  )}
                  <MoveToPicker
                    nodes={nodes.filter((n) => n.id !== deleting.id)}
                    onPick={(targetId) => {
                      void run(() => api.trees.deleteNode(deleting.id, 'move_to', targetId));
                      setDeleting(null);
                    }}
                  />
                </>
              ) : (
                <button type="button" className="rounded bg-[var(--color-danger)] px-3 py-1.5 text-left text-sm text-white"
                  onClick={() => { void run(() => api.trees.deleteNode(deleting.id)); setDeleting(null); }}>
                  Delete the category
                </button>
              )}
              <button type="button" className="rounded px-3 py-1.5 text-left text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-muted)]"
                onClick={() => setDeleting(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MoveToPicker({
  nodes,
  onPick,
}: {
  nodes: NodeRow[];
  onPick: (targetId: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm">
      <span className="shrink-0">Move them to…</span>
      <select
        className="min-w-0 flex-1 rounded border px-1.5 py-0.5 text-sm"
        defaultValue=""
        onChange={(e) => e.target.value && onPick(e.target.value)}
        aria-label="Destination category"
      >
        <option value="" disabled>
          Choose a category
        </option>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Depth-first rows from the flat node list, respecting collapse state. */
function buildNodeRows(
  nodes: readonly NodeRow[],
  collapsed: ReadonlySet<string>,
): Array<{ node: NodeRow; depth: number }> {
  const byParent = new Map<string | null, NodeRow[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId);
    if (list) list.push(node);
    else byParent.set(node.parentId, [node]);
  }
  const rows: Array<{ node: NodeRow; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      rows.push({ node, depth });
      if (!collapsed.has(node.id)) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
