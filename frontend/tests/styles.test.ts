import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// jsdom's getComputedStyle does not resolve CSS custom properties (var(...) round-trips
// unresolved), so we can't snapshot a browser-computed color here. Instead we parse the
// stylesheet source directly: extract the --wa-bg-panel value declared on :root and the
// background-color declared for .message-in, and assert they resolve to the same color.
// This is "computed" in the sense that matters for the plan's intent: .message-in's
// background is driven by (near) --wa-bg-panel, not hardcoded to something else.

const testDir = dirname(fileURLToPath(import.meta.url));
const cssPath = join(testDir, "..", "public", "styles.css");
const css = readFileSync(cssPath, "utf-8");

function extractDeclaration(selector, property) {
  const ruleRe = new RegExp(`${escapeRegExp(selector)}\\s*{([^}]*)}`);
  const ruleMatch = css.match(ruleRe);
  if (!ruleMatch) throw new Error(`selector not found: ${selector}`);
  const body = ruleMatch[1];
  const declRe = new RegExp(`${escapeRegExp(property)}\\s*:\\s*([^;]+);`);
  const declMatch = body.match(declRe);
  if (!declMatch) throw new Error(`property ${property} not found in ${selector}`);
  return declMatch[1].trim();
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hexToRgb(hex) {
  const m = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
}

function colorDistance(hexA, hexB) {
  const [ra, ga, ba] = hexToRgb(hexA);
  const [rb, gb, bb] = hexToRgb(hexB);
  return Math.sqrt((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2);
}

describe("styles.css", () => {
  it("defines the WhatsApp Web color variables", () => {
    expect(extractDeclaration(":root", "--wa-green")).toBe("#00a884");
    expect(extractDeclaration(":root", "--wa-bg-panel")).toBe("#efeae2");
  });

  it(".message-in background color is near --wa-bg-panel", () => {
    const panelHex = extractDeclaration(":root", "--wa-bg-panel");
    const messageInBg = extractDeclaration(".message-in", "background-color");
    expect(messageInBg).toMatch(/^var\(--wa-/);

    // Resolve the var() .message-in references back to its declared hex, then compare.
    const varName = messageInBg.match(/^var\((--wa-[a-z-]+)\)$/)[1];
    const resolvedHex = extractDeclaration(":root", varName);

    expect(colorDistance(resolvedHex, panelHex)).toBeLessThan(40);
  });

  it("uses only system fonts (no @font-face / external font imports)", () => {
    expect(css).not.toMatch(/@font-face/);
    expect(css).not.toMatch(/@import/);
    expect(extractDeclaration(":root", "--font-system")).toMatch(/-apple-system/);
  });

  it("sets a large base font size and larger button font size", () => {
    expect(extractDeclaration(":root", "--font-size-base")).toBe("16px");
    expect(extractDeclaration(":root", "--font-size-button")).toBe("18px");
  });
});
