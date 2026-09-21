import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground",
        className
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <path
          d="M9 18V6l10-2v12"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
        <circle cx="16" cy="16" r="3" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 font-semibold", className)}>
      <LogoMark />
      <span className="text-base tracking-tight">Downbeat</span>
    </div>
  );
}
