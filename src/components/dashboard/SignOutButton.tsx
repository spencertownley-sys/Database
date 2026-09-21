"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export function SignOutButton() {
  const { signOut } = useAuth();
  return (
    <Button variant="outline" size="sm" onClick={signOut}>
      Sign out
    </Button>
  );
}
