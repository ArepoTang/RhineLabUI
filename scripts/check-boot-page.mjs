// The standalone opening must stop on the hand-over frame and must contain
// every element the shared BootSequence binds to.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bootMotion } from "../src/boot-motion.ts";

const END = 21.92; // app time; video 26.92 s, first white frame of the array cut
assert.equal(bootMotion(END).white, 1, "END is not the white hand-over frame");
assert.equal(bootMotion(END).backgroundOpacity, 0);
assert.equal(bootMotion(END).welcomeVisible, false);
assert.equal(bootMotion(21).welcomeVisible, true, "END cut the welcome page");
assert.deepEqual(
  [0.5, 5, 8, 16, 18].map((t) => bootMotion(t).step),
  ["access", "logo", "auth", "scan", "welcome"],
);

const page = await readFile(new URL("../src/boot-page.ts", import.meta.url), "utf8");
const boot = await readFile(new URL("../src/boot.ts", import.meta.url), "utf8");
const list = boot.slice(
  boot.indexOf("private stage: HTMLElement) {"),
  boot.indexOf("].forEach((s) => this.nodes.set(s,"),
);
const selectors = [...list.matchAll(/"([.#][^"]*)"/g)].map((match) => match[1]);
assert.ok(selectors.length >= 18, `BootSequence selector list not found (${selectors.length})`);

const markup = page.slice(page.indexOf("stage.innerHTML = `"), page.indexOf("`;\nstage.dataset.mode"));
const missing = selectors
  .flatMap((selector) => selector.split(/\s+/))
  .map((token) => token.replace(/^[.#]/, ""))
  .filter((name) => !markup.includes(name));
assert.deepEqual(missing, [], `standalone markup is missing: ${missing.join(", ")}`);

const html = await readFile(new URL("../boot.html", import.meta.url), "utf8");
assert.match(html, /src="\/src\/boot-page\.ts"/);
console.log(`Standalone opening: ${selectors.length} bound elements present, ends at ${END}s (white).`);
