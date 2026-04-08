import { ThreadId, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatHeader } from "./ChatHeader";
import { SidebarProvider } from "../ui/sidebar";

function renderHeader(showPopoutAction: boolean) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <ChatHeader
        activeThreadId={ThreadId.makeUnsafe("thread-1")}
        activeThreadTitle="Prepare Docker deployment"
        activeProjectName={undefined}
        isGitRepo={false}
        openInCwd={null}
        activeProjectScripts={undefined}
        preferredScriptId={null}
        keybindings={[] as ResolvedKeybindingsConfig}
        availableEditors={[]}
        terminalAvailable={false}
        terminalOpen={false}
        terminalToggleShortcutLabel={null}
        diffToggleShortcutLabel={null}
        gitCwd={null}
        diffOpen={false}
        showPopoutAction={showPopoutAction}
        onRunProjectScript={vi.fn()}
        onAddProjectScript={vi.fn(async () => undefined)}
        onUpdateProjectScript={vi.fn(async () => undefined)}
        onDeleteProjectScript={vi.fn(async () => undefined)}
        onToggleTerminal={vi.fn()}
        onToggleDiff={vi.fn()}
        onPopoutThread={vi.fn()}
      />
    </SidebarProvider>,
  );
}

describe("ChatHeader", () => {
  it("renders the pop-out action when enabled", () => {
    const html = renderHeader(true);

    expect(html).toContain('aria-label="Pop out thread"');
  });

  it("omits the pop-out action when disabled", () => {
    const html = renderHeader(false);

    expect(html).not.toContain('aria-label="Pop out thread"');
  });
});
