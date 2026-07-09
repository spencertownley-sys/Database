"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

interface SelectFilterProps {
  placeholder: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  className?: string;
}

const ALL = "__all__";

export function SelectFilter({
  placeholder,
  value,
  options,
  onChange,
  className,
}: SelectFilterProps) {
  return (
    <Select
      value={value === "" ? ALL : value}
      onValueChange={(v) => onChange(v === ALL ? "" : v)}
    >
      <SelectTrigger className={cn("h-8 w-auto min-w-[130px] text-xs", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface DateFilterProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
}

export function DateFilter({ value, onChange, label }: DateFilterProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-[140px] text-xs"
      />
    </div>
  );
}

interface FilterBarProps {
  children: React.ReactNode;
  hasFilters: boolean;
  onClear: () => void;
  className?: string;
}

export function FilterBar({ children, hasFilters, onClear, className }: FilterBarProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClear}>
          <X className="h-3 w-3" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
