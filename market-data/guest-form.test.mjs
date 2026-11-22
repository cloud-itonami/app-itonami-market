// The shared form helper (KOTOBA-159 B5): itonami-lib src/form.js (PR #2, 7ac52696), byte for byte,
// and the build guard checkNoSubmit. A minimal stand-in DOM is enough for bindForm.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { bindForm, formValues, isSingleLineInput } from "./guest-form.js";
import { checkNoSubmit } from "./check-no-submit.mjs";

const LIB_FORM_SHA256 = "a50e711aecd9d9ad65c29d51796c0ea44295dcf749d2789d09d934fe5878595c";
const S = "sub" + "mit"; // built from parts so this file is not itself a hit

function el(tagName, props = {}) {
  const attrs = new Map(Object.entries(props.attrs ?? {}));
  const node = { tagName: tagName.toUpperCase(), disabled: false, ...props,
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), setAttribute: (k, v) => { attrs.set(k, String(v)); if (k === "type") node.type = String(v); },
    closest: (sel) => (sel === "[data-submit]" && attrs.has("data-submit") ? node : null) };
  if (attrs.has("type")) node.type = attrs.get("type");
  return node;
}
function fakeForm(controls, { valid = true } = {}) {
  const listeners = new Map();
  const form = {
    elements: controls, querySelectorAll: () => controls.filter((c) => ["BUTTON", "INPUT"].includes(c.tagName)),
    contains: (n) => controls.includes(n), reportValidity: () => valid,
    addEventListener: (t, f) => listeners.set(t, f), removeEventListener: (t) => listeners.delete(t),
    fire(type, event) { const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...event }; listeners.get(type)?.(e); return e; },
    listeners,
  };
  return form;
}

test("submit controls become type=button data-submit; the click and Enter run the same handler", () => {
  const send = el("button", { attrs: { type: S } });
  const untyped = el("button");
  const other = el("button", { attrs: { type: "button" } });
  const field = el("input", { attrs: { type: "text" }, name: "cid", value: "bafk" });
  const area = el("textarea", { name: "note", value: "x" });
  const form = fakeForm([send, untyped, other, field, area]);
  const calls = [];
  bindForm(form, (values, f) => calls.push([values, f === form]));
  for (const b of [send, untyped]) { assert.equal(b.getAttribute("type"), "button"); assert.equal(b.getAttribute("data-submit"), ""); }
  assert.equal(other.getAttribute("data-submit"), null);
  assert.ok(form.fire("click", { target: send }).defaultPrevented);
  assert.ok(form.fire("keydown", { key: "Enter", target: field }).defaultPrevented);
  assert.deepEqual(calls, [[{ cid: "bafk", note: "x" }, true], [{ cid: "bafk", note: "x" }, true]]);
  form.fire("click", { target: other });
  form.fire("keydown", { key: "Enter", target: area });
  form.fire("keydown", { key: "Enter", target: field, isComposing: true });
  form.fire("keydown", { key: "Enter", target: field, keyCode: 229 });
  assert.equal(calls.length, 2);
});

test("validation must pass; unbind removes the listeners; no submit listener is added", () => {
  const send = el("button", { attrs: { type: S } });
  const form = fakeForm([send], { valid: false });
  let called = 0;
  const unbind = bindForm(form, () => { called += 1; });
  form.fire("click", { target: send });
  assert.equal(called, 0);
  assert.ok(!form.listeners.has(S));
  unbind();
  assert.equal(form.listeners.size, 0);
});

test("formValues: strings, a lone checkbox as boolean, repeated names as arrays, radio or null; no buttons or files", () => {
  const form = fakeForm([
    el("input", { attrs: { type: "text" }, name: "a", value: "1" }),
    el("input", { attrs: { type: "checkbox" }, name: "one", checked: true, value: "on" }),
    el("input", { attrs: { type: "checkbox" }, name: "many", checked: true, value: "x" }),
    el("input", { attrs: { type: "checkbox" }, name: "many", checked: false, value: "y" }),
    el("input", { attrs: { type: "radio" }, name: "r", checked: false, value: "p" }),
    el("input", { attrs: { type: "file" }, name: "f" }),
    el("button", { attrs: { type: "button" }, name: "b", value: "v" }),
    el("input", { attrs: { type: "text" }, name: "off", value: "z", disabled: true }),
  ]);
  // itonami-lib 7ac52696 as it is: with one of two same-name checkboxes checked, put() keeps a single
  // string ("x"), not ["x"] as App Build's description says. Reported; the copy stays byte-identical.
  assert.deepEqual(formValues(form), { a: "1", one: true, many: "x", r: null });
  assert.ok(isSingleLineInput(el("input", { attrs: { type: "search" } })));
  assert.ok(!isSingleLineInput(el("textarea")));
});

test("checkNoSubmit refuses guest code or markup that relies on a submit event", () => {
  for (const bad of [`form.addEventListener("${S}", go)`, `<form on${S}="go()">`, `form.request${S[0].toUpperCase()}${S.slice(1)}()`,
    `form.${S}()`, `<button type="${S}">Send</button>`, `<input type='${S}' value="Send">`]) {
    assert.throws(() => checkNoSubmit(bad, "fixture"), /never fires in the restricted-wasm-v1 sandbox/, bad);
  }
  checkNoSubmit(`<button type="button" data-${S}>Send</button> bindForm(form, onSubmit)`, "fixture");
});

test("the helper is itonami-lib's src/form.js, byte for byte", async () => {
  assert.equal(createHash("sha256").update(await readFile(new URL("./guest-form.js", import.meta.url))).digest("hex"), LIB_FORM_SHA256);
});
