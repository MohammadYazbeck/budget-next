import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(rootDir, ".local", "postgres-data");
const pidFile = join(dataDir, "postmaster.pid");
const port = process.env.LOCAL_POSTGRES_PORT ?? "55432";
const user = process.env.LOCAL_POSTGRES_USER ?? "budget_admin";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function isReady() {
  const result = spawnSync(
    "pg_isready",
    ["-h", "127.0.0.1", "-p", port, "-U", user],
    {
      cwd: rootDir,
      stdio: "ignore",
      shell: false,
    },
  );

  return result.status === 0;
}

mkdirSync(dirname(dataDir), { recursive: true });

if (!existsSync(join(dataDir, "PG_VERSION"))) {
  run("initdb", [
    "-D",
    dataDir,
    "-U",
    user,
    "-A",
    "trust",
    "--encoding=UTF8",
    "--locale=C",
  ]);
}

if (isReady()) {
  console.log(`Local PostgreSQL is already running on 127.0.0.1:${port}.`);
  process.exit(0);
}

if (existsSync(pidFile)) {
  rmSync(pidFile);
}

console.log(`Starting local PostgreSQL on 127.0.0.1:${port}`);
console.log("Keep this terminal open while developing. Press Ctrl+C to stop.");

const server = spawn("postgres", ["-D", dataDir, "-p", port], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false,
});

process.on("SIGINT", () => {
  server.kill("SIGINT");
});

process.on("SIGTERM", () => {
  server.kill("SIGTERM");
});

server.on("exit", (code) => {
  process.exit(code ?? 0);
});
