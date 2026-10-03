import { randomUUID } from "node:crypto";

const policyKey = "kodbox-tool-json-v1";

// Retry the failed model request, never attempt to repair or execute partial JSON.
export function installModelRecovery(ctx, isBound) {
  const lifetime = new AbortController();
  const active = new Set();
  const dispose = ctx.on("agent/request-error", (payload, next) => {
    const { agent, turn, step, provider, failure, signal } = payload;
    if (!isBound(agent) || failure?.code !== "MALFORMED_RESPONSE" ||
        !/tool input is invalid JSON/.test(failure.message || "") ||
        typeof agent.session.snapshotEvents !== "function") return next();
    const operation = (async () => {
      const fused = AbortSignal.any([signal, lifetime.signal]);
      if (fused.aborted) return;
      const previous = agent.session.snapshotEvents().filter(event => event.type === "llm/retry" &&
        event.data.policyKey === policyKey && event.data.turn === turn && event.data.step === step && event.data.provider === provider);
      if (previous.length >= 2) return next();
      const retry = previous.length + 1;
      const retryId = randomUUID();
      const delayMs = retry * 500;
      agent.session.append("llm/retry", { retryId, turn, step, provider, policyKey, mode: "normal", retry, maxRetries: 2, delayMs, failure });
      const ready = await new Promise(resolve => {
        const onAbort = () => { clearTimeout(timer); resolve(false); };
        const timer = setTimeout(() => { fused.removeEventListener("abort", onAbort); resolve(true); }, delayMs);
        fused.addEventListener("abort", onAbort, { once: true });
      });
      if (!ready || fused.aborted) return;
      agent.session.append("llm/retry-started", { retryId, turn, step, retry });
      return { kind: "retry" };
    })();
    active.add(operation);
    operation.then(() => active.delete(operation), () => active.delete(operation));
    return operation;
  });
  ctx.effect(() => async () => { dispose(); lifetime.abort(); await Promise.allSettled([...active]); });
}
