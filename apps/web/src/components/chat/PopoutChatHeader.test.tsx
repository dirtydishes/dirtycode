import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PopoutChatHeader } from "./PopoutChatHeader";

describe("PopoutChatHeader", () => {
  it("renders the focused pop-out controls", () => {
    const html = renderToStaticMarkup(
      <PopoutChatHeader
        activeThreadTitle="Prepare Docker deployment"
        activeProjectName="islandflow"
        onFocusMainThread={vi.fn()}
        onCloseWindow={vi.fn()}
      />,
    );

    expect(html).toContain("Prepare Docker deployment");
    expect(html).toContain("islandflow");
    expect(html).toContain("Open in main");
    expect(html).toContain('aria-label="Close pop-out window"');
  });
});
