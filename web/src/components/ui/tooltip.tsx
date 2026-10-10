import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = T.Provider;

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  if (!content) return <>{children}</>;
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-72 rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-relaxed text-background shadow-lg animate-[fade-in_120ms_ease-out]"
        >
          {content}
          <T.Arrow className="fill-foreground" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
