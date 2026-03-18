const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const { promises: fs } = require("node:fs");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const PID_FILE = path.join(DATA_DIR, "novel-maker.pid");
const PORT = 3000;
const URL = `http://localhost:${PORT}/`;

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  const command = process.argv[2];

  if (command === "start") {
    await startServer(process.argv.includes("--no-browser"));
    return;
  }

  if (command === "stop") {
    await stopServer();
    return;
  }

  throw new Error("Usage: node scripts/launcher.js <start|stop> [--no-browser]");
}

async function startServer(noBrowser) {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const existingPid = await readPid();
  if (existingPid && await isPidRunning(existingPid) && await isServerReady()) {
    if (!noBrowser) {
      openBrowser();
    }
    console.log(`Novel Maker is already running on ${URL}`);
    return;
  }

  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: "ignore"
  });

  child.unref();
  await fs.writeFile(PID_FILE, String(child.pid), "utf8");
  await waitForServer();

  if (!noBrowser) {
    openBrowser();
  }

  console.log(`Novel Maker started on ${URL}`);
}

async function stopServer() {
  const pid = await readPid();

  if (!pid) {
    console.log("Novel Maker is not running.");
    return;
  }

  if (await isPidRunning(pid)) {
    process.kill(pid);
  }

  await fs.rm(PID_FILE, { force: true });
  console.log("Novel Maker stopped.");
}

async function readPid() {
  const raw = await fs.readFile(PID_FILE, "utf8").catch(() => "");
  const pid = Number(String(raw).trim());
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

async function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isServerReady() {
  return new Promise((resolve) => {
    const request = http.get(`${URL}api/projects`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });

    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });

    request.on("error", () => resolve(false));
  });
}

async function waitForServer() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10000) {
    if (await isServerReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error("Novel Maker server did not start within 10 seconds.");
}

function openBrowser() {
  if (process.platform === "win32") {
    const browser = spawn("cmd", ["/c", "start", "", URL], {
      detached: true,
      stdio: "ignore"
    });
    browser.unref();
    return;
  }

  if (process.platform === "darwin") {
    const browser = spawn("open", [URL], { detached: true, stdio: "ignore" });
    browser.unref();
    return;
  }

  const browser = spawn("xdg-open", [URL], { detached: true, stdio: "ignore" });
  browser.unref();
}
