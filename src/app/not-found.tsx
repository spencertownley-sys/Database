import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-4xl font-semibold tabular-nums">404</p>
      <h2 className="text-base font-semibold">Page not found</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or may have been removed.
      </p>
      <Button variant="outline" size="sm" asChild>
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
