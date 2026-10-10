// Standalone opening: app time 0 – 21.92 s (video 5 – 26.92 s), the frame the
// white field hands over to the archive. Same tracks, DOM renderer and CSS as
// the main app; no 3D scene, archive UI, audio or preference layer.
//
//   /boot.html                    loop from the white field
//   /boot.html?time=12            hold on one frame (video 17 s), ← / → to step
//   /boot.html?loop=0             play once and stop at the end
//
// Click replays, space pauses, R restarts.
import "./style.css";
import "./responsive.css";
import { brandHeading, logo } from "./brand";
import { BootSequence } from "./boot";
import { OPENING_END } from "./boot-motion";
import { loadBootWebfonts } from "./boot-lettering";
import { loadOperatorId } from "./operator";
import { openingLayout } from "./viewport-layout";

// 与主应用同一个终点（见 boot-motion 的 OPENING_END）。
const END = OPENING_END;
const HOLD = 1.4;
const stage = document.querySelector<HTMLElement>("#stage")!;
const viewport = document.querySelector<HTMLElement>("#viewport")!;

// ponytail: opening markup copied out of main.ts (the #stage template, boot
// parts only). If the app's opening DOM changes, re-copy — or move these
// fragments into a shared module once a third host needs them.
stage.innerHTML = `
  <div id="boot-background" class="boot-background"><svg viewBox="0 0 1920 1080" preserveAspectRatio="none"><g fill="none" stroke="#fff" stroke-width="3"><path d="M-210 705C-45 705 182 704 247 567C337 377 99 306 4 435S27 680 169 631C309 584 227 314 279 111S568-113 568-113"/><path d="M1560-80C1374 114 1671 168 1601 323S1371 367 1431 480S1692 666 1559 787S1329 886 1498 1130"/><circle cx="1450" cy="648" r="346"/><circle cx="1450" cy="648" r="348"/></g></svg></div>
  <header class="brand">${brandHeading}</header>
  <section id="boot" class="boot" aria-label="系统启动">
    <div class="access-text">ACCESS</div>
    <div class="boot-logo">${logo}</div>
    <div class="auth-status"><span>▪</span> <span id="auth-message"></span><i></i></div>
    <div class="scan"><svg viewBox="0 0 1920 1080" aria-hidden="true"><g fill="none" stroke="#080a08" stroke-width="2" stroke-linecap="round"><path/><path stroke="#fff"/><path/><path/><path/><path/><circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/><circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/><circle class="scan-core" cx="960" cy="540" r="5" fill="#080a08" stroke="none"/></g></svg><span>PERMISSION AUTHORIZED</span></div>
    <div class="welcome"><div class="welcome-panel"></div><div class="welcome-heading">WELCOME TO</div><div class="welcome-company"><strong>RHINE LAB.LLC.</strong><strong class="welcome-highlight" aria-hidden="true">RHINE LAB.LLC.</strong></div><div class="welcome-database">INTERNAL DATABASE</div><div class="welcome-logo">${logo}</div></div>
  </section>
  <div class="powered">POWERED BY <b>RHINE LAB</b><i></i></div>
  <div class="boot-white"></div>
`;
stage.dataset.mode = "boot";
// Frame-driven state only: no elapsed CSS animation between seeks.
stage.dataset.review = "true";
const boot = new BootSequence(stage);
void loadBootWebfonts();
// 同一台机器上用主站设置过的 ID，独立开场页也照用。
loadOperatorId();

// Same opening fit as the main app: the film keeps 1920 × 1080 coordinates,
// the backdrop fills the real viewport on other aspect ratios.
function fit() {
  const { width, height, scale, kind } = openingLayout(viewport.clientWidth, viewport.clientHeight);
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  stage.dataset.layout = kind;
  stage.dataset.openingPortrait = String(width < height);
  stage.style.setProperty("--opening-width", `${width}px`);
  stage.style.setProperty("--opening-height", `${height}px`);
  stage.style.setProperty("--opening-scan-scale", String(Math.min(1, width / 1920)));
  viewport.dataset.mobileBoot = String(matchMedia("(pointer: coarse)").matches || viewport.clientWidth < 1100);
}

const params = new URLSearchParams(location.search);
const frozen = params.has("time") ? Number(params.get("time")) : null;
const loop = params.get("loop") !== "0";
let time = Number.isFinite(frozen) ? Math.max(0, Math.min(END, frozen!)) : 0;
let paused = frozen !== null;
let previous = performance.now() / 1000;
let step = "";

function draw(value: number) {
  const motion = boot.update(Math.max(0, Math.min(value, END)));
  if (motion.step !== step) {
    step = motion.step;
    stage.dataset.boot = step;
  }
}

function frame(ms: number) {
  const now = ms / 1000;
  const elapsed = Math.min(0.1, Math.max(0, now - previous));
  previous = now;
  if (!paused) {
    time += elapsed;
    if (time > END + HOLD) {
      if (loop) time = 0;
      else {
        time = END;
        paused = true;
      }
    }
  }
  draw(time);
  requestAnimationFrame(frame);
}

addEventListener("resize", fit);
addEventListener("click", () => {
  time = 0;
  paused = false;
});
addEventListener("keydown", (event) => {
  if (event.key === " ") {
    paused = !paused;
    event.preventDefault();
  } else if (event.key.toLowerCase() === "r") {
    time = 0;
    paused = false;
  } else if (event.key === "ArrowRight") {
    paused = true;
    time = Math.min(END, time + 0.04);
  } else if (event.key === "ArrowLeft") {
    paused = true;
    time = Math.max(0, time - 0.04);
  }
});

fit();
requestAnimationFrame(frame);
