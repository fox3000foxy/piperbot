import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { PiperNativeTTS, resolveModelFiles } from "pipertts";
import { loadCsv, MODELS_CSV } from "./common.js";

/**
 * Voice cache: pipertts hub downloads into tmpfs (RAM, never disk),
 * entries expire after 5 min idle, then files are deleted.
 */

const RAM_DIR = existsSync("/dev/shm") ? "/dev/shm/piperbot" : join(tmpdir(), "piperbot");
const DATA_DIR = (existsSync("/dev/shm") ? "/dev/shm/piperbot-data" : join(tmpdir(), "piperbot-data"));
mkdirSync(RAM_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  voice: PiperNativeTTS;
  expiresAt: number;
  dir: string;
}

const cache = new Map<string, CacheEntry>();

export interface ModelRow {
  name: string;
  repo: string;
  onnx: string;
  json: string;
  language: string;
}

function rows(): Record<string, string>[] {
  return loadCsv(MODELS_CSV).filter((r) => (r.status ?? "").trim() === "✅ files");
}

export function modelNames(): string[] {
  return rows().map((r) => r.thread_name).filter(Boolean);
}

export function findModel(name: string): ModelRow | null {
  const needle = name.toLowerCase().trim();
  const r = rows().find((row) => (row.thread_name ?? "").toLowerCase().trim() === needle);
  if (!r || !r.onnx_file) return null;
  return {
    name: r.thread_name,
    repo: r.hf_repo,
    onnx: r.onnx_file,
    json: r.json_file,
    language: r.language ?? "en",
  };
}

function hfUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file.split("/").map(encodeURIComponent).join("/")}`;
}

/** Patch the downloaded config the same way the old bot did (multilingual phonemes). */
function patchConfig(configPath: string): void {
  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    if (cfg.phoneme_type === "multilingual") {
      cfg.phoneme_type = "text";
      writeFileSync(configPath, JSON.stringify(cfg, null, 2));
      console.log(`[cache] patched phoneme_type multilingual -> text`);
    }
  } catch (e) {
    console.log(`[cache] config patch skipped: ${e}`);
  }
}

/** Get (or download + load) a native voice with persistent ONNX session. Refreshes the 5-min TTL. */
export async function getVoice(m: ModelRow): Promise<PiperNativeTTS> {
  const hit = cache.get(m.repo);
  if (hit) {
    hit.expiresAt = Date.now() + CACHE_TTL_MS;
    return hit.voice;
  }
  const dir = join(RAM_DIR, m.repo.replace("/", "--"));
  mkdirSync(dir, { recursive: true });
  // pipertts hub download (modelUrl path), cached in RAM dir
  const resolved = await resolveModelFiles({
    modelUrl: hfUrl(m.repo, m.onnx),
    configUrl: m.json ? hfUrl(m.repo, m.json) : undefined,
    modelsDir: dir,
  });
  patchConfig(resolved.configPath);
  // Session ONNX persistante en memoire : ~10x plus rapide que le CLI par appel
  const voice = await PiperNativeTTS.load({
    modelPath: resolved.modelPath,
    configPath: resolved.configPath,
    nativeDataDir: DATA_DIR,
  });
  cache.set(m.repo, { voice, expiresAt: Date.now() + CACHE_TTL_MS, dir });
  return voice;
}

/** Speaker list from the model's config JSON on HF (tiny file, no model download). 1h cache. */
const speakerCache = new Map<string, { expires: number; speakers: { name: string; id: number }[] }>();
const SPEAKER_TTL_MS = 3600_000;

function hfToken(): string {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
  try {
    const env = readFileSync(join(homedir(), "huggingface-crawler/.env"), "utf8");
    for (const line of env.split("\n")) {
      if (line.startsWith("HF_TOKEN=") && !line.trimStart().startsWith("#")) {
        return line.slice("HF_TOKEN=".length).trim();
      }
    }
  } catch { /* no .env */ }
  return "";
}

export async function getSpeakers(m: ModelRow): Promise<{ name: string; id: number }[]> {
  const hit = speakerCache.get(m.repo);
  if (hit && Date.now() < hit.expires) return hit.speakers;
  const headers: Record<string, string> = { "User-Agent": "PiperBot/1.0" };
  const token = hfToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(hfUrl(m.repo, m.json), { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    const map = cfg.speaker_id_map ?? {};
    const speakers: { name: string; id: number }[] = [];
    for (const [name, sid] of Object.entries(map)) {
      speakers.push({ name, id: Array.isArray(sid) ? (sid[0] ?? 0) : Number(sid as number) });
    }
    if (speakers.length === 0 && Number(cfg.num_speakers ?? 0) > 1) {
      for (let i = 0; i < Number(cfg.num_speakers); i++) speakers.push({ name: `Speaker ${i}`, id: i });
    }
    speakers.sort((a, b) => a.id - b.id);
    speakerCache.set(m.repo, { expires: Date.now() + SPEAKER_TTL_MS, speakers });
    return speakers;
  } finally {
    clearTimeout(timer);
  }
}

// Evict expired entries every 30 s, deleting RAM files.
setInterval(() => {
  const now = Date.now();
  for (const [repo, entry] of cache) {
    if (now >= entry.expiresAt) {
      cache.delete(repo);
      rmSync(entry.dir, { recursive: true, force: true });
      console.log(`[cache] evicted ${repo}`);
    }
  }
}, 30_000).unref();
