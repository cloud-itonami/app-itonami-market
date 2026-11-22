// Forms inside the restricted-wasm-v1 guest (KOTOBA-159 B5, Dev 2026-11-22). The guest sandbox has
// no allow-forms, so a form's submit event never fires; together with the CSP form-action 'none'
// that is what keeps a form from sending anything outside. The form is therefore never submitted:
// each submit button becomes type="button", and its click and Enter in a single-line field call
// one handler with the form's fields. Anything leaving the device goes through the broker, as an
// operation, from inside that handler.
//
// Shared copy: the same file is placed in each migrated app until itonami-lib carries it.
// Keep the copies byte-identical (each app's test checks the digest).

/** The fields of a form as a plain object (last value wins for a repeated name). */
export function formFields(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
    if (el.type === "file") { out[el.name] = el.files; continue; }
    out[el.name] = el.value;
  }
  return out;
}

/**
 * bindForm(form, handler): handler(fields, { form, trigger }) runs for a click on any of the form's
 * submit buttons, and for Enter in an input that is not a textarea, button or checkbox (not while
 * an IME is composing). The submit event is not relied on; if a browser does fire it, it is
 * cancelled and ignored. Returns a function that removes the bindings.
 */
export function bindForm(form, handler) {
  const buttons = [...form.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]')];
  for (const b of buttons) b.type = "button";
  let running = false;
  const run = async (trigger) => {
    if (running) return;
    running = true;
    try { await handler(formFields(form), { form, trigger }); } finally { running = false; }
  };
  const onClick = (event) => { event.preventDefault(); run("button"); };
  const onKeydown = (event) => {
    const t = event.target;
    if (event.key !== "Enter" || event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!t || t.tagName !== "INPUT" || ["button", "submit", "checkbox", "radio", "file", "reset"].includes(t.type)) return;
    event.preventDefault();
    run("enter");
  };
  const onSubmit = (event) => event.preventDefault();
  for (const b of buttons) b.addEventListener("click", onClick);
  form.addEventListener("keydown", onKeydown);
  form.addEventListener("submit", onSubmit);
  return () => {
    for (const b of buttons) b.removeEventListener("click", onClick);
    form.removeEventListener("keydown", onKeydown);
    form.removeEventListener("submit", onSubmit);
  };
}
