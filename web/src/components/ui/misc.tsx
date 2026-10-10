import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}
    >
      <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-border bg-surface text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <div className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">{description}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </motion.div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string;
}) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-lg bg-muted p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative rounded-md px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors",
            value === o.value && "text-foreground",
          )}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${options.map((x) => x.value).join("")}`} className="absolute inset-0 rounded-md bg-card shadow-card"
              transition={{ type: "spring", bounce: 0.15, duration: 0.35 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-[13.5px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">{children}</kbd>;
}

export function Callout({ tone = "info", icon: Icon, title, children, className }: {
  tone?: "info" | "warning" | "danger" | "accent"; icon?: LucideIcon; title?: ReactNode; children?: ReactNode; className?: string;
}) {
  const tones = {
    info: "border-info/20 bg-info/5 [&_.ico]:text-info",
    warning: "border-warning/25 bg-warning/5 [&_.ico]:text-warning",
    danger: "border-danger/20 bg-danger/5 [&_.ico]:text-danger",
    accent: "border-accent/20 bg-accent-soft [&_.ico]:text-accent",
  };
  return (
    <div className={cn("flex gap-3 rounded-xl border p-3.5 text-[13px] leading-relaxed", tones[tone], className)}>
      {Icon && <Icon className="ico mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cn("text-foreground/80", title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}
