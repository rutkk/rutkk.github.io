import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE_URL = process.env.POSTER_BASE_URL ?? 'http://127.0.0.1:5173/';
const PROFILE_DIR = join(tmpdir(), `card-poster-chrome-${Date.now()}`);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);

const CAPTURES = [
  {
    name: 'desktop',
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    output: 'public/assets/card-poster-desktop.webp',
  },
  {
    name: 'mobile',
    viewport: { width: 390, height: 760 },
    deviceScaleFactor: 2,
    output: 'public/assets/card-poster-mobile.webp',
  },
];

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

if (!chromePath) {
  throw new Error('Could not find a local Chrome/Chromium executable.');
}

await mkdir(PROFILE_DIR, { recursive: true });

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-background-networking',
  '--disable-extensions',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-default-browser-check',
  '--no-first-run',
  '--use-angle=swiftshader',
  '--remote-debugging-port=0',
  `--user-data-dir=${PROFILE_DIR}`,
  'about:blank',
]);

chrome.once('exit', (code, signal) => {
  if (code !== null && code !== 0) {
    console.error(`Chrome exited with code ${code}.`);
  }

  if (signal) {
    console.error(`Chrome exited from signal ${signal}.`);
  }
});

try {
  const port = await readDevToolsPort(PROFILE_DIR);
  const page = await connectToPage(port);

  for (const capture of CAPTURES) {
    await capturePoster(page, capture);
  }

  page.close();
} finally {
  chrome.kill('SIGTERM');
  await rm(PROFILE_DIR, { recursive: true, force: true });
}

async function readDevToolsPort(profileDir) {
  const activePortPath = join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(activePortPath, 'utf8')).trim().split('\n');
      return port;
    } catch {
      await sleep(100);
    }
  }

  throw new Error('Timed out waiting for Chrome DevTools port.');
}

async function connectToPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await response.json();
  const target = targets.find((entry) => entry.type === 'page');

  if (!target?.webSocketDebuggerUrl) {
    throw new Error('Could not find a debuggable Chrome page target.');
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let requestId = 0;

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);

    if (!request) return;

    pending.delete(message.id);

    if (message.error) {
      request.reject(new Error(message.error.message));
    } else {
      request.resolve(message.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return {
    close: () => socket.close(),
    send,
  };
}

async function capturePoster(page, capture) {
  const url = new URL(BASE_URL);
  url.searchParams.set('spin', 'none');
  url.searchParams.set('capture', 'poster');

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: capture.viewport.width,
    height: capture.viewport.height,
    deviceScaleFactor: capture.deviceScaleFactor,
    mobile: capture.viewport.width < 768,
  });
  await page.send('Page.navigate', { url: url.toString() });
  await waitForReadyFrame(page);
  await sleep(150);

  const rect = await getCanvasContainerRect(page);
  const screenshot = await page.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    clip: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      scale: 1,
    },
  });

  const pngOutput = capture.output.replace(/\.webp$/, '.png');
  await writeFile(pngOutput, Buffer.from(screenshot.data, 'base64'));
  await convertToWebp(pngOutput, capture.output);
  console.log(`Wrote ${capture.name} poster to ${capture.output}`);
}

async function convertToWebp(input, output) {
  const result = spawnSync('cwebp', ['-quiet', '-q', '82', input, '-o', output], {
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`cwebp failed with status ${result.status}.`);
  }
}

async function waitForReadyFrame(page) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const result = await page.send('Runtime.evaluate', {
      expression:
        "Boolean(document.querySelector('#canvas-container.is-ready canvas'))",
      returnByValue: true,
    });

    if (result.result.value) return;

    await sleep(100);
  }

  throw new Error('Timed out waiting for the 3D scene to become ready.');
}

async function getCanvasContainerRect(page) {
  const result = await page.send('Runtime.evaluate', {
    expression: `(() => {
      const rect = document.querySelector('#canvas-container').getBoundingClientRect();

      return {
        x: Math.max(0, rect.x),
        y: Math.max(0, rect.y),
        width: rect.width,
        height: rect.height
      };
    })()`,
    returnByValue: true,
  });

  return result.result.value;
}
