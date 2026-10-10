import { Compass } from "lucide-react";
import { Component, lazy, Suspense, type ReactNode } from "react";
import { HashRouter, Link, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DataProvider } from "@/lib/data";
import Dashboard from "@/pages/Dashboard";

const Feed = lazy(() => import("@/pages/Feed"));
const Sources = lazy(() => import("@/pages/Sources"));
const Rules = lazy(() => import("@/pages/Rules"));
const History = lazy(() => import("@/pages/History"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const Settings = lazy(() => import("@/pages/Settings"));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-xl font-semibold">页面出现错误</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">{this.state.error.message}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">你的本地数据没有受到影响。</p>
        <Button className="mt-6" onClick={() => location.reload()}>重新加载</Button>
      </div>
    );
  }
}

function NotFound() {
  return (
    <EmptyState icon={Compass} title="页面不存在" description="你访问的地址没有对应的页面。"
      action={<Button asChild variant="outline"><Link to="/">返回总览</Link></Button>} />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <TooltipProvider>
        <DataProvider>
          <HashRouter>
            <AppShell>
              <Suspense fallback={<Skeleton className="h-96" />}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/feed" element={<Feed />} />
                  <Route path="/sources" element={<Sources />} />
                  <Route path="/rules" element={<Rules />} />
                  <Route path="/history" element={<History />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </AppShell>
          </HashRouter>
          <Toaster />
        </DataProvider>
      </TooltipProvider>
    </ErrorBoundary>
  );
}
