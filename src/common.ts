import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const GUILD_ID = "1523276835712929946";
export const PUBLIC_CHANNEL_ID = "1524309447864746095";
export const MODELS_CSV = join(homedir(), "huggingface-crawler/models_mapping.csv");
export const DATASETS_CSV = join(homedir(), "huggingface-crawler/datasets_mapping.csv");

export function loadToken(): string {
  if (process.env.DISCORD_TOKEN) return process.env.DISCORD_TOKEN;
  try {
    const env = readFileSync(join(homedir(), "huggingface-crawler/.env"), "utf8");
    for (const line of env.split("\n")) {
      if (line.startsWith("DISCORD_TOKEN=") && !line.trimStart().startsWith("#")) {
        return line.slice("DISCORD_TOKEN=".length).trim();
      }
    }
  } catch { /* no .env */ }
  console.error("DISCORD_TOKEN not found in .env or environment");
  process.exit(1);
}

export function loadCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const [headerLine, ...lines] = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const headers = parseLine(headerLine);
  return lines.map((line) => {
    const cells = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export const DEMO_TEXTS: Record<string, string> = {
  en: "The quick brown fox jumps over the lazy dog.",
  fr: "Bonjour, ceci est un test de synthèse vocale.",
  de: "Hallo, dies ist ein Test der Sprachsynthese.",
  es: "Hola, esto es una prueba de síntesis de voz.",
  ru: "Привет, это тест синтеза речи.",
  ja: "こんにちは、これは音声合成のテストです。",
  zh: "你好，这是一个语音合成测试。",
  pt: "Olá, isto é um teste de síntese de fala.",
  it: "Ciao, questo è un test di sintesi vocale.",
  pl: "Witaj, to jest test syntezy mowy.",
  nl: "Hallo, dit is een test van spraaksynthese.",
  tr: "Merhaba, bu bir konuşma sentezi testidir.",
  ar: "مرحبا، هذا اختبار لتركيب الكلام.",
  ko: "안녕하세요, 음성 합성 테스트입니다.",
  vi: "Xin chào, đây là bài kiểm tra tổng hợp giọng nói.",
};

export function demoTextFor(lang: string): string {
  return DEMO_TEXTS[lang.slice(0, 2)] ?? "Hello, this is a test of speech synthesis.";
}

/** Public channel => visible reply, else ephemeral. */
export function isPublic(channelId: string): boolean {
  return channelId === PUBLIC_CHANNEL_ID;
}
