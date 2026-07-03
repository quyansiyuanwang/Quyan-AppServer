import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

const declaredDependencies = new Set([
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.devDependencies || {}),
  ...Object.keys(packageJson.optionalDependencies || {}),
  ...Object.keys(packageJson.peerDependencies || {}),
]);

const builtins = new Set();
for (const name of builtinModules) {
  const normalized = name.startsWith("node:") ? name.slice(5) : name;
  builtins.add(normalized);
  builtins.add(`node:${normalized}`);
}

const scanExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);

function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

function shouldSkipPath(relativePath) {
  const p = normalizePath(relativePath);
  return (
    p.startsWith("node_modules/") ||
    p.includes("/node_modules/") ||
    p.startsWith("dist/") ||
    p.includes("/dist/") ||
    p.startsWith("coverage/") ||
    p.includes("/coverage/") ||
    p.startsWith(".git/") ||
    p.includes("/.git/") ||
    p.startsWith("src/build/") ||
    p.includes("/src/build/")
  );
}

function walkFiles(dirPath, out) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = normalizePath(path.relative(rootDir, fullPath));

    if (shouldSkipPath(relativePath)) continue;

    if (entry.isDirectory()) {
      walkFiles(fullPath, out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!scanExtensions.has(path.extname(entry.name))) continue;

    out.push({ fullPath, relativePath });
  }
}

function extractPackageName(specifier) {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length < 2) return specifier;
    return `${parts[0]}/${parts[1]}`;
  }
  return specifier.split("/")[0];
}

function isInternalSpecifier(specifier) {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("#") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("~/")
  );
}

function collectSpecifiers(code) {
  const patterns = [
    /\bimport\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+[^"']+?\s+from\s+["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];

  const specifiers = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null)
      specifiers.push(match[1]);
  }
  return specifiers;
}

const filesToScan = [];
walkFiles(rootDir, filesToScan);

const missing = new Map();

for (const file of filesToScan) {
  const content = fs.readFileSync(file.fullPath, "utf8");
  const specifiers = collectSpecifiers(content);

  for (const specifier of specifiers) {
    if (isInternalSpecifier(specifier)) continue;
    if (builtins.has(specifier)) continue;

    const packageName = extractPackageName(specifier);
    if (builtins.has(packageName)) continue;
    if (declaredDependencies.has(packageName)) continue;

    if (!missing.has(packageName))
      missing.set(packageName, new Set());

    missing.get(packageName).add(`${file.relativePath} -> ${specifier}`);
  }
}

if (missing.size > 0) {
  console.error("\nMissing explicit dependencies detected (pnpm strict mode):");

  for (const [pkg, refs] of [...missing.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.error(`\n- ${pkg}`);
    for (const ref of [...refs].slice(0, 5))
      console.error(`  ${ref}`);
    if (refs.size > 5)
      console.error(`  ...and ${refs.size - 5} more`);
  }

  console.error("\nAdd missing packages to package.json dependencies/devDependencies.");
  process.exit(1);
}

console.log(`check-explicit-deps: OK (${filesToScan.length} files scanned)`);
