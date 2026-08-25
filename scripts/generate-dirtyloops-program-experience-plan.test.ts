import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  artifactPath,
  generatePlanHtml,
  repositoryRoot,
  sourceBaseCommit,
  sourceDocuments,
} from "./generate-dirtyloops-program-experience-plan.mjs";

function matches(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map((match) => match[1] ?? match[0]);
}

describe("Dirtyloops Program plan artifact", () => {
  it("is reproducible from the seven accepted source documents", async () => {
    const [committed, generated] = await Promise.all([
      readFile(artifactPath, "utf8"),
      generatePlanHtml(),
    ]);

    expect(sourceDocuments).toHaveLength(7);
    expect(generated).toBe(committed);
    expect(generated).toContain(sourceBaseCommit);

    for (const source of sourceDocuments) {
      const markdown = await readFile(join(repositoryRoot, source.path), "utf8");
      expect(markdown.length).toBeGreaterThan(100);
      expect(generated).toContain(source.path);
    }
  });

  it("contains the complete policy and all five Phase contracts", async () => {
    const html = await readFile(artifactPath, "utf8");
    const normalizedHtml = html.replace(/\s+/g, " ");

    for (const phase of [1, 2, 3, 4, 5]) {
      expect(html).toContain(`id="phase-${phase}"`);
      expect(html).toContain(
        `data-source="docs/implementation/dirtyloops-program-experience/0${phase}-`,
      );
    }

    expect(normalizedHtml).toContain("one vertical red-green slice at a time");
    expect(normalizedHtml).toContain(
      "Get user agreement on that seam before writing its first test",
    );
    expect(normalizedHtml).toContain("Exact checkpoint reviewer matrix");
    expect(normalizedHtml).toContain(
      "Combine and deduplicate all blocking findings into one batch",
    );
    expect(normalizedHtml).toContain("A third rejected review pass");
    expect(normalizedHtml).toContain("There is no repair pass <code>3</code> by default");
    expect(normalizedHtml).toContain(
      "Accepted work, dependencies, ordering, blockers, and completion",
    );
    expect(normalizedHtml).toContain(
      "Readiness, worktree permits, review, checks, Admission, integration",
    );
    expect(normalizedHtml).toContain(
      "The installed Dirtyloops skill and its matching source in the Agents repository remain frozen inputs",
    );
  });

  it("server-renders every fenced code block through Pierre SSR", async () => {
    const html = await readFile(artifactPath, "utf8");
    let fencedBlocks = 0;
    for (const source of sourceDocuments) {
      const markdown = await readFile(join(repositoryRoot, source.path), "utf8");
      fencedBlocks += matches(markdown, /^```/gm).length / 2;
    }

    const pierreBlocks = matches(html, /data-renderer="@pierre\/diffs\/ssr"/g).length;
    const preElements = matches(html, /<pre(?:\s|>)/g).length;

    expect(fencedBlocks).toBe(4);
    expect(pierreBlocks).toBe(fencedBlocks);
    expect(preElements).toBe(fencedBlocks);
    expect(html).toContain(`data-pierre-block-count="${fencedBlocks}"`);
    expect(html).not.toMatch(/<pre[^>]*>\s*<code class="language-/);
  });

  it("ships one self-contained semantic document with valid internal navigation", async () => {
    const html = await readFile(artifactPath, "utf8");
    const ids = matches(html, /\sid="([^"]+)"/g);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    const internalTargets = matches(html, /<a\b[^>]*\shref="#([^"]+)"/g);

    expect(matches(html, /<h1(?:\s|>)/g)).toHaveLength(1);
    expect(matches(html, /<main(?:\s|>)/g)).toHaveLength(1);
    expect(matches(html, /<nav(?:\s|>)/g).length).toBeGreaterThanOrEqual(1);
    expect(matches(html, /<footer(?:\s|>)/g)).toHaveLength(1);
    expect(duplicateIds).toEqual([]);
    expect(internalTargets.length).toBeGreaterThan(10);
    expect(internalTargets.every((target) => ids.includes(target))).toBe(true);
    expect(html).toContain('class="skip-link" href="#main-content"');
    expect(html).toContain('font-family: "Newsreader Plan"');
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).toContain('<strong class="accepted-status">Accepted</strong>');
    expect(html).not.toContain('class="status-line"');
    expect(html).toContain("const updateProgress = () =>");
    expect(html).not.toContain("__DIRTYLOOPS_PLAN_CLIENT__");
    expect(html).not.toMatch(/{{[A-Z_]+}}/);
    expect(html).not.toMatch(/tabindex="[1-9]/);
    expect(html).not.toMatch(/<(?:script|link|img)\b[^>]*(?:src|href)="https?:/i);
    expect(html).not.toMatch(/url\(["']?https?:/i);
  });
});
