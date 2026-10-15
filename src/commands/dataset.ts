import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  SlashCommandBuilder,
} from "discord.js";
import { isPublic, loadCsv, DATASETS_CSV } from "../common.js";

const PER_PAGE = 10;

export const data = new SlashCommandBuilder()
  .setName("dataset")
  .setDescription("List and search LJSpeech datasets")
  .addSubcommand((s) =>
    s.setName("list").setDescription("List available datasets")
      .addStringOption((o) => o.setName("source").setDescription("Filter by source (e.g. TF2, Portal 2)").setAutocomplete(true))
      .addStringOption((o) => o.setName("language").setDescription("Filter by language code (e.g. en, fr, de)").setAutocomplete(true)))
  .addSubcommand((s) => s.setName("sources").setDescription("List available dataset sources"));

function buildPages(rows: Record<string, string>[]): string[] {
  const pages: string[] = [];
  for (let i = 0; i < rows.length; i += PER_PAGE) {
    pages.push(rows.slice(i, i + PER_PAGE).map((d) => {
      const mention = d.thread_id ? ` <#${d.thread_id}>` : "";
      return `${d.thread_name ?? "?"} (\`${d.language ?? "?"}\` — ${d.source ?? "?"})${mention}`;
    }).join("\n"));
  }
  return pages;
}

export async function autocompleteSource(current: string): Promise<{ name: string; value: string }[]> {
  const sources = [...new Set(loadCsv(DATASETS_CSV).map((r) => r.source).filter(Boolean))].sort();
  return sources.filter((s) => s.toLowerCase().includes(current.toLowerCase()))
    .slice(0, 25).map((s) => ({ name: s, value: s }));
}

export async function autocompleteDsLanguage(current: string): Promise<{ name: string; value: string }[]> {
  const langs = [...new Set(loadCsv(DATASETS_CSV).map((r) => r.language).filter(Boolean))].sort();
  return langs.filter((l) => l.toLowerCase().includes(current.toLowerCase()))
    .slice(0, 25).map((l) => ({ name: l, value: l }));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const ephemeral = !isPublic(interaction.channelId);
  await interaction.deferReply({ ephemeral });
  if (interaction.options.getSubcommand() === "sources") {
    const sources = [...new Set(loadCsv(DATASETS_CSV).map((r) => r.source).filter(Boolean))].sort();
    await interaction.editReply(sources.length === 0 ? "No sources found." : "**Available sources:**\n" + sources.map((s) => `• ${s}`).join("\n"));
    return;
  }
  const source = interaction.options.getString("source") ?? "";
  const language = interaction.options.getString("language") ?? "";
  const rows = loadCsv(DATASETS_CSV).filter((r) => {
    if (source && (r.source ?? "").toLowerCase() !== source.toLowerCase()) return false;
    if (language && (r.language ?? "").toLowerCase() !== language.toLowerCase()) return false;
    return true;
  });
  if (rows.length === 0) {
    await interaction.editReply("No datasets found matching your filters.");
    return;
  }
  const pages = buildPages(rows);
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
