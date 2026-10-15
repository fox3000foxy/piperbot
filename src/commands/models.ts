import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  SlashCommandBuilder,
} from "discord.js";
import { demoTextFor, isPublic, loadCsv, MODELS_CSV } from "../common.js";

const PER_PAGE = 10;
const QUALITY_ICONS: Record<string, string> = { high: "🟢", medium: "🟡", low: "🔴" };

export const data = new SlashCommandBuilder()
  .setName("models")
  .setDescription("List available Piper TTS models")
  .addStringOption((o) => o.setName("language").setDescription("Filter by language code (e.g. en, fr, de)").setAutocomplete(true))
  .addStringOption((o) => o.setName("query").setDescription("Search by name"))
  .addStringOption((o) => o.setName("quality").setDescription("Filter by quality (high, medium, low)").setAutocomplete(true));

function filtered(language: string, query: string, quality: string): Record<string, string>[] {
  return loadCsv(MODELS_CSV).filter((r) => {
    if (language && (r.language ?? "").toLowerCase() !== language.toLowerCase()) return false;
    if (quality && (r.quality ?? "").toLowerCase() !== quality.toLowerCase()) return false;
    if (query && !`${r.thread_name} ${r.name}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
}

function buildPages(models: Record<string, string>[]): string[] {
  const pages: string[] = [];
  for (let i = 0; i < models.length; i += PER_PAGE) {
    pages.push(models.slice(i, i + PER_PAGE).map((m) => {
      const name = m.thread_name || m.name || "?";
      const icon = QUALITY_ICONS[(m.quality ?? "").trim().toLowerCase()] ?? "";
      const mention = m.thread_id ? ` <#${m.thread_id}>` : "";
      return icon ? `${icon} ${name} (\`${m.language}\`)${mention}` : `${name} (\`${m.language}\`)${mention}`;
    }).join("\n"));
  }
  return pages;
}

export async function autocompleteLanguage(current: string): Promise<{ name: string; value: string }[]> {
  const langs = [...new Set(loadCsv(MODELS_CSV).map((r) => r.language).filter(Boolean))].sort();
  return langs.filter((l) => l.toLowerCase().includes(current.toLowerCase()))
    .slice(0, 25).map((l) => ({ name: l, value: l }));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const ephemeral = !isPublic(interaction.channelId);
  await interaction.deferReply({ ephemeral });
  const language = interaction.options.getString("language") ?? "";
  const query = interaction.options.getString("query") ?? "";
  const quality = interaction.options.getString("quality") ?? "";
  const models = filtered(language, query, quality);
  if (models.length === 0) {
    await interaction.editReply("No models found matching your filters.");
    return;
  }
  const pages = buildPages(models);
  if (pages.length === 1) {
    await interaction.editReply(pages[0]);
    return;
  }
  let current = 0;
  const row = () =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("prev").setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
      new ButtonBuilder().setCustomId("count").setLabel(`Page ${current + 1}/${pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("next").setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(current === pages.length - 1),
    );
  const reply = await interaction.editReply({ content: pages[0], components: [row()] });
  const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });
  collector.on("collect", async (btn) => {
    if (btn.customId === "prev") current--;
    else if (btn.customId === "next") current++;
    await btn.update({ content: pages[current], components: [row()] });
  });
  collector.on("end", async () => {
    try { await interaction.editReply({ components: [] }); } catch { /* expired */ }
  });
}

export { demoTextFor };
