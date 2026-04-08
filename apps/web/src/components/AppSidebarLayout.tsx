import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import ThreadSidebar from "./Sidebar";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribers: Array<() => void> = [];
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction === "function") {
      unsubscribers.push(
        onMenuAction((action) => {
          if (action !== "open-settings") return;
          void navigate({ to: "/settings" });
        }),
      );
    }

    const onNavigateToThread = window.desktopBridge?.onNavigateToThread;
    if (typeof onNavigateToThread === "function") {
      unsubscribers.push(
        onNavigateToThread((threadId) => {
          void navigate({
            to: "/$threadId",
            params: { threadId },
          });
        }),
      );
    }

    if (unsubscribers.length === 0) {
      return;
    }
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [navigate]);

  return (
    <SidebarProvider defaultOpen>
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border bg-card text-foreground"
        resizable={{
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ nextWidth, wrapper }) =>
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <ThreadSidebar />
        <SidebarRail />
      </Sidebar>
      {children}
    </SidebarProvider>
  );
}
