import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { useSyncExternalStore } from "react";

interface Toast { id: number; text: string; tone: "success" | "error" }
let toasts: Toast[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function toast(text: string, tone: Toast["tone"] = "success") {
  const id = ++seq;
  toasts = [...toasts, { id, text, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 3200);
}

export function Toaster() {
  const list = useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => toasts, () => toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      <AnimatePresence>
        {list.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }} className="pointer-events-auto flex items-center gap-2 rounded-xl bg-foreground px-3.5 py-2.5 text-[13px] text-background shadow-xl">
            {t.tone === "success" ? <CheckCircle2 className="size-4 text-success" /> : <AlertCircle className="size-4 text-danger" />}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
