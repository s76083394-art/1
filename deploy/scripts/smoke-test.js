const { spawn } = require("node:child_process");

const child = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"]
});

let finished = false;

function finish(code) {
  if (finished) {
    return;
  }
  finished = true;
  child.kill();
  process.exitCode = code;
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout")), 5000);

    child.stdout.on("data", (buffer) => {
      if (String(buffer).includes("Novel Maker listening")) {
        clearTimeout(timer);
        resolve();
      }
    });

    child.stderr.on("data", (buffer) => {
      const text = String(buffer).trim();
      if (text) {
        clearTimeout(timer);
        reject(new Error(text));
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early: ${code}`));
    });
  });
}

(async () => {
  await waitForServer();
  const root = await fetch("http://localhost:3000/");
  const api = await fetch("http://localhost:3000/api/projects");

  console.log(`ROOT_STATUS=${root.status}`);
  console.log(`API_STATUS=${api.status}`);
  console.log(`API_BODY=${await api.text()}`);
  finish(0);
})().catch((error) => {
  console.error(error.message);
  finish(1);
});
