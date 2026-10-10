import * as M from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = M.Root;
export const DropdownTrigger = M.Trigger;

export function DropdownContent({ children, align = "end" }: { children: ReactNode; align?: "start" | "end" | "center" }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className="z-50 min-w-44 rounded-xl border border-border bg-card p-1 shadow-xl animate-[fade-in_120ms_ease-out]"
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function DropdownItem({ children, onSelect, danger, disabled }: {
  children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground",
        danger && "text-danger [&_svg]:text-danger",
      )}
    >
      {children}
    </M.Item>
  );
}

export function DropdownSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />;
}
