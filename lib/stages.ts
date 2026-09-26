/**
 * Generation stages — the server half of the Generation Console (PRD v2 §1).
 *
 * A Reporter wraps each real backend step (a model call, a TrueForge API
 * call, an MCP handshake). When the client asks for a stage stream
 * (`x-stage-stream: 1`), the route answers with Server-Sent Events: one
 * `stage` event when a step starts and one when it resolves, then a final
 * `result` (or `error`). Without that header the route answers plain JSON, so
 * any other caller keeps working. Nothing here has its own timeline — a stage
 * exists only while the call it names is running.
 */

export type StageStatus = "running" | "done" | "error" | "skipped";

export type StageEvent = {
  type: "stage";
  id: string;
  label: string;
  /** The real technology/service doing the work. */
  tech: string;
  status: StageStatus;
  detail?: string;
  /** Data URL of an intermediate artifact (e.g. the painted frame before hotspots). */
  preview?: string;
  ms?: number;
};

type Described = { detail?: string; preview?: string } | string | void;

export type Reporter = {
  stage<T>(label: string, tech: string, fn: () => Promise<T>, describe?: (r: T) => Described): Promise<T>;
  /** A step that resolved without a call worth timing (e.g. "not configured"). */
  note(label: string, tech: string, status: StageStatus, detail?: string): void;
};

export const silentReporter: Reporter = {
  stage: (_l, _t, fn) => fn(),
  note: () => {},
};

function normalize(d: Described): { detail?: string; preview?: string } {
  if (!d) return {};
  return typeof d === "string" ? { detail: d } : d;
}

function makeReporter(emit: (e: StageEvent) => void): Reporter {
  let n = 0;
  return {
    async stage(label, tech, fn, describe) {
      const id = `s${++n}`;
      const t0 = Date.now();
      emit({ type: "stage", id, label, tech, status: "running" });
      try {
        const result = await fn();
        let extra: { detail?: string; preview?: string } = {};
        try {
          extra = normalize(describe?.(result));
        } catch {}
        emit({ type: "stage", id, label, tech, status: "done", ms: Date.now() - t0, ...extra });
        return result;
      } catch (err) {
        emit({
          type: "stage",
          id,
          label,
          tech,
          status: "error",
          ms: Date.now() - t0,
          detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
        throw err;
      }
    },
    note(label, tech, status, detail) {
      emit({ type: "stage", id: `s${++n}`, label, tech, status, detail });
    },
  };
}

export function wantsStages(req: Request): boolean {
  return req.headers.get("x-stage-stream") === "1";
}

/**
 * Run a staged job. Streams stages + result as SSE when asked; otherwise
 * returns the JSON result (or `{ error }` with `errorStatus`).
 */
export function stagedResponse(
  req: Request,
  run: (report: Reporter) => Promise<unknown>,
  toError: (err: unknown) => { message: string; status?: number } = (err) => ({
    message: err instanceof Error ? err.message : String(err),
  })
): Response | Promise<Response> {
  if (!wantsStages(req)) {
    return run(silentReporter)
      .then((data) => Response.json(data))
      .catch((err) => {
        const { message, status = 500 } = toError(err);
        return Response.json({ error: message }, { status });
      });
  }
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        const data = await run(makeReporter(send));
        send({ type: "result", data });
      } catch (err) {
        const { message, status = 500 } = toError(err);
        send({ type: "error", message, status });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
