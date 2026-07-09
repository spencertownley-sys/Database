"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Tag, Anchor, Ship, ScrollText, Clock } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useDebounce } from "@/hooks/useDebounce";
import type { SearchResults } from "@/types";

const RECENT_KEY = "promovault.recentSearches";
const EMPTY: SearchResults = { promotions: [], voyages: [], ships: [], disclaimers: [] };

const GROUP_META = [
  { key: "promotions", label: "Promotions", icon: Tag },
  { key: "voyages", label: "Voyages", icon: Anchor },
  { key: "ships", label: "Ships", icon: Ship },
  { key: "disclaimers", label: "Disclaimers", icon: ScrollText },
] as const;

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const debouncedQuery = useDebounce(query, 250);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      try {
        setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"));
      } catch {
        setRecent([]);
      }
    }
  }, [open]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults(EMPTY);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch(() => {
        if (!cancelled) setResults(EMPTY);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const rememberSearch = useCallback((q: string) => {
    if (!q.trim()) return;
    try {
      const prev: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      const next = [q, ...prev.filter((p) => p !== q)].slice(0, 6);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const go = useCallback(
    (url: string) => {
      rememberSearch(query);
      setOpen(false);
      setQuery("");
      router.push(url);
    },
    [query, rememberSearch, router]
  );

  const hasResults = GROUP_META.some((g) => results[g.key].length > 0);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-sm items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search promos, voyages, ships…</span>
        <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 font-mono text-[10px] font-medium sm:inline-block">
          ⌘K
        </kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search promotions, voyages, ships, disclaimers…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {!query.trim() && recent.length > 0 && (
            <CommandGroup heading="Recent searches">
              {recent.map((r) => (
                <CommandItem key={r} onSelect={() => setQuery(r)}>
                  <Clock />
                  {r}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {query.trim() && !loading && !hasResults && (
            <CommandEmpty>No results for “{query}”.</CommandEmpty>
          )}
          {loading && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Searching…
            </p>
          )}
          {GROUP_META.map((g) =>
            results[g.key].length > 0 ? (
              <CommandGroup key={g.key} heading={g.label}>
                {results[g.key].map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${g.key}-${item.id}`}
                    onSelect={() => go(item.url)}
                  >
                    <g.icon />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{item.title}</span>
                      {item.subtitle && (
                        <span className="truncate text-xs text-muted-foreground">
                          {item.subtitle}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
