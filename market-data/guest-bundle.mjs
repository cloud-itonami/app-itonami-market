// One inline module script for the restricted-wasm-v1 guest (KOTOBA-159). The sandboxed guest is a
// single self-contained document and the host policy admits exactly one guest script by hash, so
// the app's ES modules are inlined here: each module becomes a function scope that returns its
// exports, in dependency order, and its imports become reads of those scopes. Only the forms this
// app uses are accepted (single-line `import { a, b as c } from "./x.js"` or './x.mjs', `import x from "./x.js"`,
// `export function|async function|const|let|class name`, `export default <expr>`); anything else
// fails the build instead of being guessed.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const IMPORT = /^import\s+(?:(\w+)|\{([^}]*)\})\s+from\s+["']\.\/([\w.-]+\.m?js)["'];\s*$/;
const EXPORT_DECL = /^export\s+(async\s+function|function|const|let|class)\s+(\w+)/;
const EXPORT_DEFAULT = /^export\s+default\s+/;

function transform(name, text) {
  const imports = [];
  const exportsList = [];
  let hasDefault = false;
  const lines = text.split("\n").map((line) => {
    const im = IMPORT.exec(line);
    if (im) {
      imports.push(im[3]);
      const scope = `__m[${JSON.stringify(im[3])}]`;
      if (im[1]) return `const ${im[1]} = ${scope}.default;`;
      const names = im[2].split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
        const [orig, alias] = s.split(/\s+as\s+/);
        return alias ? `${orig}: ${alias}` : orig;
      });
      return `const { ${names.join(", ")} } = ${scope};`;
    }
    if (/^\s*import\b/.test(line)) throw new Error(`${name}: unsupported import: ${line}`);
    const ex = EXPORT_DECL.exec(line);
    if (ex) { exportsList.push(ex[2]); return line.replace(/^export\s+/, ""); }
    if (EXPORT_DEFAULT.test(line)) { hasDefault = true; return line.replace(EXPORT_DEFAULT, "const __default = "); }
    if (/^\s*export\b/.test(line)) throw new Error(`${name}: unsupported export: ${line}`);
    return line;
  });
  const returns = [...exportsList, ...(hasDefault ? ["default: __default"] : [])].join(", ");
  return { imports, body: `${lines.join("\n")}\nreturn { ${returns} };` };
}

/**
 * modules: { "name.js": text }, entry: "app.js". Returns the script text. Throws on a cycle, a
 * missing module, `</script`, or a form the transform does not accept.
 */
export function bundleModules(modules, entry) {
  const parsed = Object.fromEntries(Object.entries(modules).map(([name, text]) => [name, transform(name, text)]));
  const order = [];
  const state = new Map();
  const visit = (name, path) => {
    if (!parsed[name]) throw new Error(`guest bundle: ${path.join(" -> ")} imports ${name}, which is not in the bundle`);
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") throw new Error(`guest bundle: import cycle at ${[...path, name].join(" -> ")}`);
    state.set(name, "visiting");
    for (const dep of parsed[name].imports) visit(dep, [...path, name]);
    state.set(name, "done");
    order.push(name);
  };
  visit(entry, []);
  const parts = ["const __m = Object.create(null);"];
  for (const name of order) {
    // Every scope is async, so a module's top-level await keeps working (the guest script is a module).
    parts.push(`// ---- ${name}\n__m[${JSON.stringify(name)}] = await (async () => {\n${parsed[name].body}\n})();`);
  }
  const script = parts.join("\n");
  if (/<\/script/i.test(script)) throw new Error("guest bundle contains </script");
  return script;
}

export async function readModules(dir, names) {
  return Object.fromEntries(await Promise.all(names.map(async (n) => [n, await readFile(resolve(dir, n), "utf8")])));
}
