// The shared form helper (KOTOBA-159 B5): no submit event is relied on, and the button and Enter
// call the same handler. A minimal stand-in DOM is enough: the helper only uses querySelectorAll,
// elements, addEventListener and type.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { bindForm, formFields } from "./guest-form.js";

function target(props = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
    fire(type, event = {}) { const e = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...event }; for (const fn of listeners.get(type) ?? []) fn(e); return e; },
  }, props);
}
function fakeForm() {
  const submit = target({ tagName: "BUTTON", type: "submit" });
  const other = target({ tagName: "BUTTON", type: "button" });
  const name = target({ tagName: "INPUT", type: "text", name: "address", value: "東京都港区", disabled: false });
  const note = target({ tagName: "TEXTAREA", type: "textarea", name: "note", value: "メモ", disabled: false });
  const box = target({ tagName: "INPUT", type: "checkbox", name: "flag", value: "on", checked: false, disabled: false });
  const form = target({ elements: [name, note, box], querySelectorAll: () => [submit] });
  return { form, submit, other, name, note, box };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("the button and Enter call the same handler with the fields; the submit button is no longer a submit button", async () => {
  const { form, submit, name, note } = fakeForm();
  const calls = [];
  bindForm(form, (fields, { trigger }) => { calls.push([trigger, fields]); });
  assert.equal(submit.type, "button");
  const click = submit.fire("click");
  assert.ok(click.defaultPrevented);
  await tick();
  const enter = form.fire("keydown", { key: "Enter", target: name });
  assert.ok(enter.defaultPrevented);
  await tick();
  assert.deepEqual(calls, [["button", { address: "東京都港区", note: "メモ" }], ["enter", { address: "東京都港区", note: "メモ" }]]);
  // Enter in a textarea, while composing, or with a modifier is not a send.
  form.fire("keydown", { key: "Enter", target: note });
  form.fire("keydown", { key: "Enter", target: name, isComposing: true });
  form.fire("keydown", { key: "Enter", target: name, shiftKey: true });
  form.fire("keydown", { key: "a", target: name });
  await tick();
  assert.equal(calls.length, 2);
});

test("the submit event is not relied on: it is cancelled and does not call the handler", async () => {
  const { form } = fakeForm();
  let called = 0;
  bindForm(form, () => { called += 1; });
  const e = form.fire("submit");
  assert.ok(e.defaultPrevented);
  await tick();
  assert.equal(called, 0);
});

test("a second trigger while the handler runs is ignored; unbinding removes everything", async () => {
  const { form, submit } = fakeForm();
  let called = 0; let release;
  const unbind = bindForm(form, () => { called += 1; return new Promise((r) => { release = r; }); });
  submit.fire("click"); submit.fire("click");
  await tick();
  assert.equal(called, 1);
  release(); await tick();
  unbind();
  submit.fire("click");
  await tick();
  assert.equal(called, 1);
});

test("checked boxes only, and the shared copy is byte-identical", async () => {
  const { form, box } = fakeForm();
  assert.equal(formFields(form).flag, undefined);
  box.checked = true;
  assert.equal(formFields(form).flag, "on");
  const digest = createHash("sha256").update(await readFile(new URL("./guest-form.js", import.meta.url))).digest("hex");
  assert.equal(digest, "0dd8ca61b0b37cfc356627db13459a3765aab95e84be048734e05cb97d2fa7b9");
});
