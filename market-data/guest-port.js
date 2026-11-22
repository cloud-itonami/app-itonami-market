// The restricted-wasm-v1 guest's only way out (KOTOBA-159). mountRestrictedClientApp transfers a
// MessagePort to this document; each call is one kotoba.client.operation.v1 message, and the
// canonical broker on the host page validates it, shows the consent dialog and sends it. The reply
// is a bounded text body and its status, returned here as a Response.
const TIMEOUT_MS = 120_000;

export function createGuestPort(win = globalThis) {
  const port = new Promise((resolve) => {
    win.addEventListener("message", function accept(event) {
      const p = event.ports?.[0];
      if (event.source !== win.parent || event.data?.protocol !== "kotoba.client.host.v1" || !p) return;
      win.removeEventListener("message", accept);
      resolve(p);
    });
  });
  const waiting = new Map();
  let next = 0;
  port.then((p) => {
    p.onmessage = ({ data }) => {
      const done = waiting.get(data?.id);
      if (!done) return;
      waiting.delete(data.id);
      done(data);
    };
  });
  async function invoke(selector, payload, { signal } = {}) {
    if (signal?.aborted) throw new Error("client operation cancelled");
    const p = await port;
    const id = "op-" + (++next);
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error("no answer from the host")); }, TIMEOUT_MS);
      // The host keeps the request until consent is decided; an abort here only stops waiting.
      signal?.addEventListener("abort", () => { clearTimeout(timer); waiting.delete(id); reject(new Error("client operation cancelled")); }, { once: true });
      waiting.set(id, (data) => { clearTimeout(timer); resolve(data); });
    });
    p.postMessage({ protocol: "kotoba.client.operation.v1", id, selector, payload });
    const data = await reply;
    if (data.ok !== true) throw new Error(typeof data.error === "string" ? data.error : "client operation failed");
    if (typeof data.content !== "string") throw new Error("unexpected operation result");
    return new Response(data.content, { status: data.status });
  }
  return { ready: port.then(() => true), invoke };
}
