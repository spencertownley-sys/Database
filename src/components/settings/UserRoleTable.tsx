"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { updateUserRole } from "@/app/actions/settings";
import { USER_ROLES, type UserRole } from "@/lib/constants";
import type { Profile } from "@/types";

interface UserRoleTableProps {
  users: Profile[];
  canManage: boolean;
  selfId: string;
}

export function UserRoleTable({ users, canManage, selfId }: UserRoleTableProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  function changeRole(userId: string, role: UserRole) {
    startTransition(async () => {
      const result = await updateUserRole(userId, role);
      if (result.ok) {
        toast({ title: "Role updated" });
        router.refresh();
      } else {
        toast({ title: "Update failed", description: result.error, variant: "destructive" });
      }
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => (
          <TableRow key={u.id}>
            <TableCell className="font-medium">
              {u.fullName}
              {u.id === selfId && (
                <Badge variant="secondary" className="ml-2 text-[10px]">you</Badge>
              )}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{u.email}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {u.department ?? "—"}
            </TableCell>
            <TableCell>
              {canManage ? (
                <Select
                  value={u.role}
                  disabled={isPending}
                  onValueChange={(v) => changeRole(u.id, v as UserRole)}
                >
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(USER_ROLES) as UserRole[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {USER_ROLES[r].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline" className="capitalize">
                  {USER_ROLES[(u.role in USER_ROLES ? u.role : "viewer") as UserRole].label}
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
