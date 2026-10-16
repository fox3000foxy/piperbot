import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { findModel, getSpeakers, getVoice, modelNames } from "../src/voices.js";
import { loadCsv, MODELS_CSV } from "../src/common.js";

const PORT = Number(process.env.API_PORT ?? 7845);
const API_TOKEN = process.env.API_TOKEN ?? "";

// Sequential queue: one synthesis at a time (same policy as the Discord bot).
let queue: Promise<void> = Promise.resolve();

function send(res: ServerResponse, status: number, body: unknown, contentType = "application/json"): void {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(data),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(data);
}

function sendWav(res: ServerResponse, audio: Buffer): void {
  res.writeHead(200, {
    "Content-Type": "audio/wav",
    "Content-Length": audio.length,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(audio);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/models") {
    const lang = url.searchParams.get("language") ?? "";
    const q = (url.searchParams.get("query") ?? "").toLowerCase();
    const rows = loadCsv(MODELS_CSV).filter((r) => {
      if (lang && (r.language ?? "").toLowerCase() !== lang.toLowerCase()) return false;
      if (q && !`${r.thread_name} ${r.name}`.toLowerCase().includes(q)) return false;
      return true;
    });
    send(res, 200, rows.map((r) => ({
      name: r.thread_name,
      language: r.language,
      quality: r.quality,
      repo: r.hf_repo,
    })));
    return;
  }

  if (req.method === "POST" && url.pathname === "/synthesize") {
    if (API_TOKEN) {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${API_TOKEN}`) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      send(res, 400, { error: "invalid JSON" });
      return;
    }
    const name = String(body.model ?? "");
    const m = findModel(name);
    if (!m) {
      send(res, 404, { error: `model not found: ${name}`, hint: "GET /models" });
      return;
    }
    const text = String(body.text ?? "");
    if (!text) {
      send(res, 400, { error: "text is required" });
      return;
    }
    const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
    const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
    await new Promise<void>((done) => {
      queue = queue.then(async () => {
        try {
          const voice = await getVoice(m);
          const t0 = Date.now();
          const result = await voice.synthesize(text, {
            outputFormat: "wav",
            lengthScale: num(body.length_scale),
            noiseScale: num(body.noise_scale),
            noiseWScale: num(body.noise_w),
            speakerId: int(body.speaker),
            sentenceSilence: num(body.sentence_silence),
            volume: num(body.volume),
          });
          res.setHeader("X-Inference-Ms", String(Date.now() - t0));
          sendWav(res, result.audio);
        } catch (e) {
          send(res, 500, { error: e instanceof Error ? e.message : String(e) });
        } finally {
          done();
        }
      }, () => done());
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/speakers") {
    const name = url.searchParams.get("model") ?? "";
    const m = findModel(name);
    if (!m) {
      send(res, 404, { error: `model not found: ${name}` });
      return;
    }
    try {
      send(res, 200, await getSpeakers(m));
    } catch (e) {
      send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/model-names") {
    send(res, 200, modelNames());
    return;
  }

  send(res, 404, { error: "not found", routes: ["GET /health", "GET /models", "GET /model-names", "GET /speakers?model=", "POST /synthesize"] });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[api] listening on 127.0.0.1:${PORT}`));
