import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, ComponentType, SlashCommandBuilder } from "discord.js";
import { demoTextFor, isPublic } from "../common.js";
import { findModel, getSpeakers, getVoice, modelNames } from "../voices.js";

const QUEUE_TIMEOUT_MS = 60_000;

export const data = new SlashCommandBuilder()
  .setName("infer")
  .setDescription("Piper TTS inference commands")
  .addSubcommand((s) =>
    s.setName("run").setDescription("Run Piper inference on a model")
      .addStringOption((o) => o.setName("model").setDescription("Model name").setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName("text").setDescription("Text to synthesize (empty = demo text)"))
      .addNumberOption((o) => o.setName("length_scale").setDescription("Phoneme length (default: model config)"))
      .addNumberOption((o) => o.setName("noise_scale").setDescription("Generator noise (default: model config)"))
      .addNumberOption((o) => o.setName("noise_w").setDescription("Phoneme width noise (default: model config)"))
      .addIntegerOption((o) => o.setName("speaker").setDescription("Speaker ID for multi-speaker models (default: 0)").setAutocomplete(true))
      .addNumberOption((o) => o.setName("sentence_silence").setDescription("Seconds of silence after each sentence"))
      .addNumberOption((o) => o.setName("volume").setDescription("Volume multiplier (default: 1.0)")))
  .addSubcommand((s) => s.setName("help").setDescription("Show parameter explanations for /infer run"));

export const HELP_TEXT = `**Parametres de \`/infer run\` :**
• **model** (obligatoire) - Nom du modele TTS (autocompletion disponible)
• **text** (optionnel) - Texte a synthetiser. Laissez vide pour un texte de demo dans la langue du modele
• **length_scale** (float) - Echelle de longueur des phonemes. > 1 = plus lent, < 1 = plus rapide. Defaut: config du modele
• **noise_scale** (float) - Bruit du generateur (0.0-1.0+). Plus haut = plus de variation. Defaut: config du modele
• **noise_w** (float) - Bruit de largeur des phonemes (0.0-1.0+). Affecte la variabilite. Defaut: config du modele
• **speaker** (int) - ID du speaker (0 par defaut). Utile pour les modeles multi-voix
• **sentence_silence** (float) - Secondes de silence ajoutees apres chaque phrase
• **volume** (float) - Multiplicateur de volume (1.0 = normal, 2.0 = 2x plus fort)
**Exemple :**
\`/infer run model:Jett text:hello length_scale:1.2 noise_scale:0.5\``;

// Simple FIFO queue: one synthesis at a time.
let queue: Promise<void> = Promise.resolve();

export async function autocompleteModel(current: string): Promise<{ name: string; value: string }[]> {
  const needle = current.toLowerCase();
  return modelNames().filter((n) => n.toLowerCase().includes(needle))
    .slice(0, 25).map((n) => ({ name: n, value: n }));
}

export async function autocompleteSpeaker(modelName: string, current: string): Promise<{ name: string; value: number }[]> {
  try {
    if (!modelName) return [];
    const m = findModel(modelName);
    if (!m) return [];
    const speakers = await getSpeakers(m);
    const cur = current.toLowerCase();
    return speakers
      .filter((s) => !cur || s.name.toLowerCase().includes(cur) || String(s.id).includes(cur))
      .slice(0, 25)
      .map((s) => ({ name: `${s.name} (${s.id})`, value: s.id }));
  } catch {
    return [];
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const ephemeral = !isPublic(interaction.channelId);
  if (interaction.options.getSubcommand() === "help") {
    await interaction.reply({ content: HELP_TEXT, ephemeral });
    return;
  }
  await interaction.deferReply({ ephemeral });

  const modelName = interaction.options.getString("model", true);
  const m = findModel(modelName);
  if (!m) {
    await interaction.editReply(`Model **${modelName}** not found or has no ONNX files. Use \`/models\` to see available models.`);
    return;
  }
  const text = interaction.options.getString("text") || demoTextFor(m.language);
  const lengthScale = interaction.options.getNumber("length_scale") ?? undefined;
  const noiseScale = interaction.options.getNumber("noise_scale") ?? undefined;
  const noiseWScale = interaction.options.getNumber("noise_w") ?? undefined;
  const speakerId = interaction.options.getInteger("speaker") ?? undefined;
  const sentenceSilence = interaction.options.getNumber("sentence_silence") ?? undefined;
  const volume = interaction.options.getNumber("volume") ?? undefined;

  await interaction.editReply("⏳ In queue...");
  const enqueuedAt = Date.now();

  const run = async () => {
    if (Date.now() - enqueuedAt > QUEUE_TIMEOUT_MS) {
      await interaction.editReply(`⏳ Queue timeout (60s). Inference cancelled.`);
      return;
    }
    try {
      await interaction.editReply("⏳ Downloading model...");
      const downloadStart = Date.now();
      const voice = await getVoice(m);
      const downloadMs = Date.now() - downloadStart;
      await interaction.editReply("⏳ Running inference...");
      const inferenceStart = Date.now();
      const result = await voice.synthesize(text, {
        outputFormat: "wav",
        lengthScale,
        noiseScale,
        noiseWScale,
        speakerId,
        sentenceSilence,
        volume,
      });
      if (result.audio.length < 1024) {
        await interaction.editReply("No audio was generated.");
        return;
      }
      const file = new AttachmentBuilder(result.audio, { name: `${m.name.replace(/\s+/g, "_")}.wav` });
      const ms = Date.now() - inferenceStart;
      const fmt = (v: number) => (v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(1)}s`);
      const stats = `Download: ${downloadMs < 1000 ? "*Cached*" : fmt(downloadMs)} | Inference: ${fmt(ms)} | Audio: ${(result.audio.length / 1024).toFixed(0)}KB`;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("stats").setLabel("Stats").setEmoji("📊").setStyle(ButtonStyle.Secondary),
      );
      const reply = await interaction.editReply({ content: "✅ Result:", files: [file], components: [row] });
      const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300_000 });
      collector.on("collect", async (btn) => {
        if (btn.customId === "stats") await btn.reply({ content: stats, ephemeral: true });
      });
      collector.on("end", async () => {
        try { await interaction.editReply({ components: [] }); } catch { /* expired */ }
      });
    } catch (e) {
      try {
        await interaction.editReply(`❌ Error: ${e instanceof Error ? e.message.slice(0, 1500) : String(e).slice(0, 1500)}`);
      } catch { /* interaction expired */ }
    }
  };
  queue = queue.then(run, run);
}
