import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function localDependencyNames(manifest, localNames) {
  const names = new Set();

  for (const field of dependencyFields) {
    const dependencies = manifest[field] ?? {};
    for (const name of Object.keys(dependencies)) {
      if (localNames.has(name)) names.add(name);
    }
  }

  return [...names].sort();
}

export function getOrderedWorkspaces(root = defaultRoot) {
  const manifest = readJson(join(root, "package.json"));
  const workspacePatterns = Array.isArray(manifest.workspaces) ? manifest.workspaces : [];
  const discovered = [];

  for (const pattern of workspacePatterns) {
    const base = pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern;
    const baseDir = join(root, base);
    if (!existsSync(baseDir)) continue;

    const entries = readdirSync(baseDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const workspaceDir = join(baseDir, entry.name);
      const manifestPath = join(workspaceDir, "package.json");
      if (!existsSync(manifestPath)) continue;

      const workspaceManifest = readJson(manifestPath);
      discovered.push({
        dir: workspaceDir,
        manifest: workspaceManifest,
        name: workspaceManifest.name ?? `${base}/${entry.name}`,
      });
    }
  }

  return orderWorkspaces(discovered);
}

export function orderWorkspaces(workspaces) {
  const byName = new Map();

  for (const workspace of workspaces) {
    if (byName.has(workspace.name)) {
      throw new Error(`Duplicate workspace name: ${workspace.name}`);
    }
    byName.set(workspace.name, workspace);
  }

  const localNames = new Set(byName.keys());
  const ordered = [];
  const state = new Map();

  function visit(workspace, stack) {
    const currentState = state.get(workspace.name);
    if (currentState === "done") return;
    if (currentState === "visiting") {
      throw new Error(
        `Local workspace dependency cycle: ${[...stack, workspace.name].join(" -> ")}`,
      );
    }

    state.set(workspace.name, "visiting");
    for (const dependencyName of localDependencyNames(workspace.manifest, localNames)) {
      visit(byName.get(dependencyName), [...stack, workspace.name]);
    }
    state.set(workspace.name, "done");
    ordered.push(workspace);
  }

  for (const workspace of workspaces) {
    visit(workspace, []);
  }

  return ordered;
}

export function runWorkspaceScript(scriptName, root = defaultRoot) {
  const workspaces = getOrderedWorkspaces(root);
  let ran = 0;

  for (const workspace of workspaces) {
    if (!workspace.manifest.scripts?.[scriptName]) continue;
    ran += 1;

    const result = spawnSync("npm", ["run", scriptName], {
      cwd: workspace.dir,
      stdio: "inherit",
      shell: false,
    });

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }

  if (workspaces.length === 0) {
    console.log(`No workspace packages found for '${scriptName}'.`);
  } else if (ran === 0) {
    console.log(`No workspace package defines '${scriptName}'.`);
  }
}

function main() {
  const scriptName = process.argv[2];
  if (!scriptName) {
    console.error("Usage: node scripts/run-workspaces.mjs <script>");
    process.exit(1);
  }

  runWorkspaceScript(scriptName);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
