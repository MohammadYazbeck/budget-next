import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.LOCAL_POSTGRES_PORT ?? "55432";
const user = process.env.LOCAL_POSTGRES_USER ?? "budget_admin";
const database = process.env.LOCAL_POSTGRES_DB ?? "budget_app";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
    ...options,
  });

  return result;
}

function runChecked(command, args) {
  const result = run(command, args, { stdio: "inherit" });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const ready = run("pg_isready", ["-h", "127.0.0.1", "-p", port, "-U", user], {
  stdio: "ignore",
});

if (ready.status !== 0) {
  console.error(
    `Local PostgreSQL is not running on 127.0.0.1:${port}. Run "npm.cmd run db:local:start" in another terminal first.`,
  );
  process.exit(1);
}

const create = run(
  "createdb",
  ["-h", "127.0.0.1", "-p", port, "-U", user, database],
  { stdio: "pipe" },
);

const createOutput = `${create.stdout ?? ""}${create.stderr ?? ""}`;

if (create.status !== 0 && !createOutput.includes("already exists")) {
  process.stderr.write(createOutput);
  process.exit(create.status ?? 1);
}

runChecked(npmBin, ["run", "db:migrate"]);
runChecked(npmBin, ["run", "db:seed"]);
runChecked("psql", [
  "-h",
  "127.0.0.1",
  "-p",
  port,
  "-U",
  user,
  "-d",
  database,
  "-c",
  'select (select count(*) from "Client") as clients, (select count(*) from "FixedCost") as fixed_costs, (select count(*) from "Transaction") as transactions, (select count(*) from "Liability") as liabilities;',
]);
