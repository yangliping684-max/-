import * as S from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ checked, onCheckedChange, id, disabled, className, ...rest }: {
  checked: boolean; onCheckedChange: (v: boolean) => void; id?: string; disabled?: boolean; className?: string;
  "aria-label"?: string;
}) {
  return (
    <S.Root
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors",
        "bg-border data-[state=checked]:bg-accent disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      <S.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </S.Root>
  );
}
