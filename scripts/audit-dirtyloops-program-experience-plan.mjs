import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDirectory, "..");
const artifactPath = join(repositoryRoot, "docs/plans/dirtyloops-program-experience/plan.html");
const reviewDirectory = join(repositoryRoot, ".impeccable/review");
const confirmation = process.argv.includes("--confirmation");
const executablePath = process.env.DPX_CHROMIUM_PATH ?? "/usr/bin/chromium";

await mkdir(reviewDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});

const results = [];
const runtimeErrors = [];
const externalRequests = [];

async function inspectViewport(name, width, height) {
  const context = await browser.newContext({
    colorScheme: "dark",
    reducedMotion: "reduce",
    viewport: { width, height },
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`${name}: console: ${message.text()}`);
  });
  page.on("pageerror", (error) => runtimeErrors.push(`${name}: page: ${error.message}`));
  page.on("request", (request) => {
    const protocol = new URL(request.url()).protocol;
    if (!["file:", "data:", "blob:"].includes(protocol)) {
      externalRequests.push(`${name}: ${request.method()} ${request.url()}`);
    }
  });

  await page.goto(pathToFileURL(artifactPath).href, { waitUntil: "load" });
  await page.evaluate(() => window.scrollTo(0, 0));

  const audit = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const parseRgb = (value) => {
      const match = value.match(
        /rgba?\(\s*(\d+(?:\.\d+)?)(?:\s*,\s*|\s+)(\d+(?:\.\d+)?)(?:\s*,\s*|\s+)(\d+(?:\.\d+)?)(?:\s*(?:,|\/)\s*(\d+(?:\.\d+)?))?\s*\)/,
      );
      if (!match) return null;
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: match[4] === undefined ? 1 : Number(match[4]),
      };
    };
    const luminance = ({ r, g, b }) => {
      const channels = [r, g, b].map((value) => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (foreground, background) => {
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    };
    const effectiveBackground = (element) => {
      let current = element;
      while (current) {
        const color = parseRgb(getComputedStyle(current).backgroundColor);
        if (color && color.a >= 0.95) return color;
        current = current.parentElement;
      }
      return { r: 0, g: 0, b: 0, a: 1 };
    };

    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    const headingJumps = [];
    for (let index = 1; index < headings.length; index += 1) {
      const previous = Number(headings[index - 1].tagName.slice(1));
      const current = Number(headings[index].tagName.slice(1));
      if (current > previous + 1) {
        headingJumps.push(
          `${headings[index - 1].textContent.trim()} -> ${headings[index].textContent.trim()}`,
        );
      }
    }

    const unlabeledControls = [
      ...document.querySelectorAll("a,button,summary,input,select,textarea"),
    ]
      .filter(visible)
      .filter((element) => {
        const name =
          element.getAttribute("aria-label") ??
          element.getAttribute("title") ??
          element.textContent;
        return !name?.trim();
      })
      .map((element) => element.outerHTML.slice(0, 160));
    const missingAlt = [...document.querySelectorAll("img:not([alt])")].map(
      (image) => image.outerHTML,
    );
    const positiveTabIndex = [...document.querySelectorAll("[tabindex]")]
      .filter((element) => Number(element.getAttribute("tabindex")) > 0)
      .map((element) => element.outerHTML.slice(0, 160));

    const overflow = [...document.querySelectorAll("body *")]
      .filter(visible)
      .filter((element) => !element.closest(".table-scroll, .pierre-output, .toc"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > window.innerWidth + 1;
      })
      .map((element) => ({
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}.${[...element.classList].slice(0, 2).join(".")}`,
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
      }));

    const contrastFailures = [...document.querySelectorAll("body *")]
      .filter(visible)
      .filter((element) => !["SCRIPT", "STYLE", "SVG", "PATH", "SYMBOL"].includes(element.tagName))
      .filter((element) =>
        [...element.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0,
        ),
      )
      .map((element) => {
        const style = getComputedStyle(element);
        const foreground = parseRgb(style.color);
        const background = effectiveBackground(element);
        if (!foreground) return null;
        const ratio = contrast(foreground, background);
        const size = Number.parseFloat(style.fontSize);
        const weight = Number.parseInt(style.fontWeight, 10) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const required = large ? 3 : 4.5;
        if (ratio + 0.01 >= required) return null;
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`,
          text: element.textContent.trim().slice(0, 80),
          ratio: Number(ratio.toFixed(2)),
          required,
          color: style.color,
          background: getComputedStyle(element).backgroundColor,
        };
      })
      .filter(Boolean);

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      duplicateIds,
      headingJumps,
      unlabeledControls,
      missingAlt,
      positiveTabIndex,
      overflow,
      contrastFailures,
      landmarks: {
        h1: document.querySelectorAll("h1").length,
        main: document.querySelectorAll("main").length,
        nav: document.querySelectorAll("nav").length,
        footer: document.querySelectorAll("footer").length,
      },
    };
  });

  await page.screenshot({
    path: join(reviewDirectory, `${name}.png`),
    fullPage: true,
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(reviewDirectory, `${name}-viewport.png`) });

  await page
    .locator("#build-policy .table-scroll")
    .first()
    .screenshot({ path: join(reviewDirectory, `${name}-review-matrix.png`) });
  await page
    .locator("#build-policy .stop-rule")
    .screenshot({ path: join(reviewDirectory, `${name}-stop-rule.png`) });

  if (name === "desktop") {
    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({
      className: document.activeElement?.className,
      text: document.activeElement?.textContent?.trim(),
    }));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(50);
    const skipDestination = await page.evaluate(() => document.activeElement?.id);
    await page.keyboard.press("Tab");
    const focusStyle = await page.evaluate(() => {
      const element = document.activeElement;
      const style = element ? getComputedStyle(element) : null;
      return {
        tag: element?.tagName,
        text: element?.textContent?.trim(),
        outlineStyle: style?.outlineStyle,
        outlineWidth: style?.outlineWidth,
      };
    });
    audit.keyboard = { firstFocus, skipDestination, focusStyle };

    await page.locator("#accepted-plan").evaluate((details) => {
      details.open = true;
    });
    const firstCode = page.locator("#accepted-plan .pierre-render").first();
    await firstCode.scrollIntoViewIfNeeded();
    await firstCode.screenshot({ path: join(reviewDirectory, "code-surface.png") });
  }

  results.push({ name, audit });
  await context.close();
}

try {
  await inspectViewport("desktop", 1440, 1000);
  await inspectViewport("mobile", 390, 844);
} finally {
  await browser.close();
}

const failures = [];
for (const result of results) {
  const { audit, name } = result;
  for (const key of [
    "duplicateIds",
    "headingJumps",
    "unlabeledControls",
    "missingAlt",
    "positiveTabIndex",
    "overflow",
    "contrastFailures",
  ]) {
    if (audit[key].length > 0) failures.push(`${name}.${key}: ${JSON.stringify(audit[key])}`);
  }
  if (audit.documentWidth > audit.viewport.width) {
    failures.push(`${name}.documentWidth: ${audit.documentWidth} > ${audit.viewport.width}`);
  }
  for (const [landmark, count] of Object.entries(audit.landmarks)) {
    if (count !== 1) failures.push(`${name}.${landmark}: expected 1, received ${count}`);
  }
}

const keyboard = results.find((result) => result.name === "desktop")?.audit.keyboard;
if (keyboard?.firstFocus.className !== "skip-link") {
  failures.push(`keyboard.firstFocus: ${JSON.stringify(keyboard?.firstFocus)}`);
}
if (keyboard?.skipDestination !== "main-content") {
  failures.push(`keyboard.skipDestination: ${JSON.stringify(keyboard?.skipDestination)}`);
}
if (keyboard?.focusStyle.outlineStyle === "none" || keyboard?.focusStyle.outlineWidth === "0px") {
  failures.push(`keyboard.focusStyle: ${JSON.stringify(keyboard?.focusStyle)}`);
}
failures.push(...runtimeErrors, ...externalRequests);

const report = {
  pass: failures.length === 0,
  confirmation,
  artifactPath,
  screenshots: [
    join(reviewDirectory, "desktop.png"),
    join(reviewDirectory, "mobile.png"),
    join(reviewDirectory, "desktop-viewport.png"),
    join(reviewDirectory, "mobile-viewport.png"),
    join(reviewDirectory, "desktop-review-matrix.png"),
    join(reviewDirectory, "mobile-review-matrix.png"),
    join(reviewDirectory, "desktop-stop-rule.png"),
    join(reviewDirectory, "mobile-stop-rule.png"),
    join(reviewDirectory, "code-surface.png"),
  ],
  results,
  runtimeErrors,
  externalRequests,
  failures,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
