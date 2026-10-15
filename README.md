# PiperBot

Discord TTS bot backed by the [PiperHub](https://piperhub.org) voice catalog (~500 community Piper voices). TypeScript + discord.js, synthesis via the [`pipertts`](https://www.npmjs.com/package/pipertts) native module (persistent in-process ONNX session).

## Commands

- `/infer run` — Synthesize speech: `model` (autocomplete), `text` (empty = demo text in the model's language), `length_scale`, `noise_scale`, `noise_w`, `speaker` (autocomplete for multi-voice models), `sentence_silence`, `volume`. A 📊 Stats button on the result reveals download/inference timings (ephemeral).
- `/infer help` — Parameter reference.
- `/models` — List and filter voices by language, name, quality.
- `/dataset list|sources` — Browse companion LJSpeech datasets.
- `/help` — Command overview.

Inference requests run through a FIFO queue (one synthesis at a time).

## How it works

- Model metadata comes from `models_mapping.csv` / `datasets_mapping.csv` in the parent crawler repo (expected at `~/huggingface-crawler/`).
- Model files (`.onnx` + `.onnx.json`) are downloaded from Hugging Face via pipertts hub resolution into tmpfs (`/dev/shm/piperbot`, RAM only, never disk).
- Voices stay cached for 5 minutes idle, then files are evicted. Warm inference is ~10x faster than spawning the Piper CLI per call (~260 ms vs ~2.5 s).
- Gated Hugging Face repos are not supported (pipertts downloads without auth).

## Run

```bash
npm install
npm run build
# DISCORD_TOKEN in ~/huggingface-crawler/.env or environment
node dist/index.js
```

pm2 example: `pm2 start ecosystem.config.cjs`

## License

MIT
