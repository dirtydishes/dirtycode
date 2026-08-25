import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { preloadFile, preloadPatchFile } from "@pierre/diffs/ssr";
import { marked, Renderer } from "marked";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = join(scriptDirectory, "..");
export const artifactDirectory = join(repositoryRoot, "docs/plans/dirtyloops-program-experience");
export const artifactPath = join(artifactDirectory, "plan.html");
export const displayFontPath = join(
  repositoryRoot,
  "node_modules/@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2",
);
export const sourceBaseCommit = "3d6b0f301e29272a930c242bc09f684ef6e1b8fb";

export const sourceDocuments = [
  {
    key: "plan",
    label: "Accepted product plan",
    path: "docs/plans/dirtyloops-program-experience/plan.md",
  },
  {
    key: "roadmap",
    label: "Implementation roadmap",
    path: "docs/implementation/dirtyloops-program-experience/00-roadmap.md",
  },
  {
    key: "phase-1",
    label: "Phase 1 contract",
    path: "docs/implementation/dirtyloops-program-experience/01-one-real-program.md",
  },
  {
    key: "phase-2",
    label: "Phase 2 contract",
    path: "docs/implementation/dirtyloops-program-experience/02-understandable-reachable.md",
  },
  {
    key: "phase-3",
    label: "Phase 3 contract",
    path: "docs/implementation/dirtyloops-program-experience/03-control-recovery.md",
  },
  {
    key: "phase-4",
    label: "Phase 4 contract",
    path: "docs/implementation/dirtyloops-program-experience/04-multi-phase.md",
  },
  {
    key: "phase-5",
    label: "Phase 5 contract",
    path: "docs/implementation/dirtyloops-program-experience/05-client-parity.md",
  },
];

const phases = [
  {
    key: "phase-1",
    number: 1,
    title: "Create and finish one real Program",
    outcome:
      "A developer describes one task, accepts one one-Phase proposal, starts a real provider, opens the ordinary T3 threads, and receives one reviewed and integrated result.",
  },
  {
    key: "phase-2",
    number: 2,
    title: "Make Program work understandable and reachable",
    outcome:
      "A developer can understand the Program within seconds and open every related conversation without filling normal project recents.",
  },
  {
    key: "phase-3",
    number: 3,
    title: "Make Program controls and recovery reliable",
    outcome:
      "A developer can pause, resume, stop, retry, and replan while the interface reports each command's durable result.",
  },
  {
    key: "phase-4",
    number: 4,
    title: "Run bounded multi-Phase Programs",
    outcome:
      "A developer can run dependent and bounded parallel Phases while the runner stays readable and mutation ownership stays safe.",
  },
  {
    key: "phase-5",
    number: 5,
    title: "Finish mobile, remote, and accessibility support",
    outcome:
      "A developer can create, monitor, control, and open the same Program through supported T3 clients and remote connections.",
  },
];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stripFirstHeading(markdown) {
  return markdown.replace(/^# .+\r?\n(?:\r?\n)?/, "");
}

function headingSlug(value) {
  return (
    value
      .toLowerCase()
      .replaceAll(/<[^>]+>/g, "")
      .replaceAll(/[`*_~]/g, "")
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "") || "section"
  );
}

function codeExtension(language) {
  const extensions = {
    bash: "sh",
    diff: "diff",
    html: "html",
    javascript: "js",
    js: "js",
    json: "json",
    markdown: "md",
    md: "md",
    shell: "sh",
    sh: "sh",
    text: "txt",
    ts: "ts",
    typescript: "ts",
    yaml: "yaml",
    yml: "yml",
  };
  return extensions[language] ?? "txt";
}

function codeFilename(sourcePath, language, localIndex) {
  const acceptedPlanNames = [
    "program-product-loop.txt",
    "ProgramAuthoring.ts",
    "StartAcceptedProgram.ts",
    "programPresentation.ts",
  ];
  if (sourcePath.endsWith("/plan.md") && acceptedPlanNames[localIndex]) {
    return acceptedPlanNames[localIndex];
  }
  const base = sourcePath.split("/").at(-1).replace(extname(sourcePath), "");
  return `${base}-block-${localIndex + 1}.${codeExtension(language)}`;
}

function collectCodeTokens(tokens) {
  const codeTokens = [];
  marked.walkTokens(tokens, (token) => {
    if (token.type === "code") codeTokens.push(token);
  });
  return codeTokens;
}

function removePierreSprite(html, renderState) {
  const spritePattern = /<svg data-icon-sprite[\s\S]*?<\/svg>/;
  const match = html.match(spritePattern);
  if (match && renderState.pierreSprite.length === 0) {
    renderState.pierreSprite = match[0];
  }
  return html.replace(spritePattern, "");
}

async function renderCodeBlock(token, sourcePath, localIndex, renderState) {
  const language = (token.lang ?? "text").trim().split(/\s+/)[0].toLowerCase() || "text";
  const filename = codeFilename(sourcePath, language, localIndex);
  const options = {
    theme: "github-dark-high-contrast",
    themeType: "dark",
    disableFileHeader: true,
    disableVirtualizationBuffers: true,
    overflow: "wrap",
  };

  let renderedParts;
  let kind = "code";
  if (language === "diff" || language === "patch") {
    const diffs = await preloadPatchFile({
      patch: token.text,
      options: { ...options, diffStyle: "unified", expandUnchanged: true },
    });
    if (diffs.length > 0) {
      renderedParts = diffs.map((diff) => diff.prerenderedHTML);
      kind = "diff";
    }
  }

  if (!renderedParts) {
    const file = await preloadFile({
      file: {
        name: filename,
        contents: token.text,
        lang: language === "text" ? "text" : undefined,
      },
      options,
    });
    renderedParts = [file.prerenderedHTML];
  }

  const rendered = renderedParts.map((html) => removePierreSprite(html, renderState)).join("\n");
  renderState.pierreBlockCount += 1;

  return `<figure class="pierre-render" data-renderer="@pierre/diffs/ssr" data-kind="${kind}">
  <figcaption><span>${escapeHtml(filename)}</span><code>${escapeHtml(language)}</code></figcaption>
  <div class="pierre-output">${rendered}</div>
</figure>`;
}

async function renderMarkdown(markdown, { idPrefix, sourcePath, headingOffset = 1 }, renderState) {
  const tokens = marked.lexer(markdown, { gfm: true });
  const codeTokens = collectCodeTokens(tokens);
  const renderedBlocks = await Promise.all(
    codeTokens.map((token, index) => renderCodeBlock(token, sourcePath, index, renderState)),
  );
  let codeIndex = 0;
  const slugCounts = new Map();
  const renderer = new Renderer();

  renderer.code = () => renderedBlocks[codeIndex++];
  renderer.heading = function (token) {
    const level = Math.min(6, token.depth + headingOffset);
    const base = `${idPrefix}-${headingSlug(token.text)}`;
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    const content = this.parser.parseInline(token.tokens);
    return `<h${level} id="${id}">${content}</h${level}>\n`;
  };

  const html = marked.parser(tokens, { gfm: true, renderer });
  return html
    .replaceAll(
      "<table>",
      '<div class="table-scroll" role="region" aria-label="Scrollable source table" tabindex="0"><table>',
    )
    .replaceAll("</table>", "</table></div>");
}

function phaseContractMarkup(phase, sourceHtml, sourcePath) {
  return `<section class="phase-contract" id="phase-${phase.number}" aria-labelledby="phase-${phase.number}-title">
  <header>
    <span class="phase-number">${String(phase.number).padStart(2, "0")}</span>
    <div>
      <h2 id="phase-${phase.number}-title">${escapeHtml(phase.title)}</h2>
      <p>${escapeHtml(phase.outcome)}</p>
    </div>
  </header>
  <div class="source-document" data-source="${escapeHtml(sourcePath)}">${sourceHtml}</div>
</section>`;
}

function sourceLedgerMarkup(sources) {
  return sources
    .map(
      (source) => `<li>
  <code>${escapeHtml(source.path)}</code>
  <samp title="sha256:${source.digest}">${source.digest}</samp>
</li>`,
    )
    .join("\n");
}

function inject(template, replacements) {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  const unresolved = result.match(/{{[A-Z0-9_]+}}/g);
  if (unresolved) {
    throw new Error(`Unresolved plan template tokens: ${unresolved.join(", ")}`);
  }
  return result;
}

export async function generatePlanHtml() {
  const [template, css, clientScript, displayFont] = await Promise.all([
    readFile(join(artifactDirectory, "plan.template.html"), "utf8"),
    readFile(join(artifactDirectory, "plan.css"), "utf8"),
    readFile(join(artifactDirectory, "plan.client.js"), "utf8"),
    readFile(displayFontPath),
  ]);
  const inlineCss = css.replaceAll("{{DISPLAY_FONT_BASE64}}", displayFont.toString("base64"));
  const sources = await Promise.all(
    sourceDocuments.map(async (source) => {
      const markdown = await readFile(join(repositoryRoot, source.path), "utf8");
      return { ...source, markdown, digest: sha256(markdown) };
    }),
  );
  const sourceByKey = new Map(sources.map((source) => [source.key, source]));
  const renderState = { pierreBlockCount: 0, pierreSprite: "" };

  const phaseContracts = [];
  for (const phase of phases) {
    const source = sourceByKey.get(phase.key);
    const rendered = await renderMarkdown(
      stripFirstHeading(source.markdown),
      { idPrefix: phase.key, sourcePath: source.path },
      renderState,
    );
    phaseContracts.push(phaseContractMarkup(phase, rendered, source.path));
  }

  const plan = sourceByKey.get("plan");
  const planSource = await renderMarkdown(
    stripFirstHeading(plan.markdown),
    { idPrefix: "accepted-plan", sourcePath: plan.path },
    renderState,
  );
  const roadmap = sourceByKey.get("roadmap");
  const roadmapSource = await renderMarkdown(
    stripFirstHeading(roadmap.markdown),
    { idPrefix: "accepted-roadmap", sourcePath: roadmap.path },
    renderState,
  );

  const html = inject(template, {
    INLINE_CSS: inlineCss.trimEnd(),
    PHASE_CONTRACTS: phaseContracts.join("\n\n"),
    PIERRE_BLOCK_COUNT: String(renderState.pierreBlockCount),
    PIERRE_SPRITE: renderState.pierreSprite,
    PLAN_SOURCE: planSource,
    ROADMAP_SOURCE: roadmapSource,
    SOURCE_BASE_COMMIT: sourceBaseCommit,
    SOURCE_BASE_COMMIT_SHORT: sourceBaseCommit.slice(0, 10),
    SOURCE_COUNT: String(sources.length),
    SOURCE_LEDGER: sourceLedgerMarkup(sources),
  }).replace("/* __DIRTYLOOPS_PLAN_CLIENT__ */", clientScript.trimEnd());
  const normalizedHtml = html.replace(/^[\t ]+$/gm, "");
  return normalizedHtml.endsWith("\n") ? normalizedHtml : `${normalizedHtml}\n`;
}

export async function writePlanHtml() {
  const html = await generatePlanHtml();
  await writeFile(artifactPath, html, "utf8");
  return { artifactPath, bytes: Buffer.byteLength(html), sha256: sha256(html) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await writePlanHtml();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
