import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const store = JSON.parse(readFileSync(join(homedir(), ".dsh", "storages", "workspace.json"), "utf8"));
const table = store.tables.workspaces;

const normalizePath = (path) => {
  if (typeof path !== "string" || !path) return "";
  return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
};

const byPath = {};
for (const [id, workspace] of Object.entries(table)) {
  const path = workspace.path || workspace.cwd;
  if (path) byPath[normalizePath(path)] = id;
}

const cwd = "C:\\Users\\fsx\\Desktop";
console.log("normalized cwd :", JSON.stringify(normalizePath(cwd)));
console.log("map size       :", Object.keys(byPath).length);
console.log("hit            :", byPath[normalizePath(cwd)]);
console.log("sample key     :", JSON.stringify(Object.keys(byPath)[0]));
