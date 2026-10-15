import { AutocompleteInteraction, Client, Events, GatewayIntentBits, Interaction, REST, Routes } from "discord.js";
import { GUILD_ID, loadToken } from "./common.js";
import * as dataset from "./commands/dataset.js";
import * as infer from "./commands/infer.js";
import * as models from "./commands/models.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const HELP_TEXT = `**PiperBot commands:**
• \`/infer run\` — Synthesize speech with a Piper model
• \`/infer help\` — Parameter explanations for /infer run
• \`/models\` — List and filter TTS models
• \`/dataset list\` — List and filter LJSpeech datasets
• \`/dataset sources\` — List dataset sources`;

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag} (${c.user.id})`);
  const rest = new REST({ version: "10" }).setToken(loadToken());
  const body = [
    infer.data.toJSON(),
    models.data.toJSON(),
    dataset.data.toJSON(),
    { name: "help", description: "Show PiperBot help" },
  ];
  await rest.put(Routes.applicationGuildCommands(c.user.id, GUILD_ID), { body });
  console.log(`Synced ${body.length} commands`);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "infer") await infer.execute(interaction);
      else if (interaction.commandName === "models") await models.execute(interaction);
      else if (interaction.commandName === "dataset") await dataset.execute(interaction);
      else if (interaction.commandName === "help") {
        const ephemeral = interaction.channelId !== "1524309447864746095";
        await interaction.reply({ content: HELP_TEXT, ephemeral });
      }
    } else if (interaction.isAutocomplete()) {
      await onAutocomplete(interaction);
    }
  } catch (e) {
    console.error("[interaction] error:", e);
  }
});

async function onAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const cmd = interaction.commandName;
  if (cmd === "infer" && focused.name === "model") {
    await interaction.respond(await infer.autocompleteModel(focused.value));
  } else if (cmd === "infer" && focused.name === "speaker") {
    const modelName = interaction.options.getString("model") ?? "";
    await interaction.respond(await infer.autocompleteSpeaker(modelName, focused.value));
  } else if (cmd === "models" && focused.name === "language") {
    await interaction.respond(await models.autocompleteLanguage(focused.value));
  } else if (cmd === "models" && focused.name === "quality") {
    const opts = ["high", "medium", "low"];
    await interaction.respond(
      opts.filter((q) => q.includes(focused.value.toLowerCase())).map((q) => ({ name: q, value: q })),
    );
  } else if (cmd === "dataset" && focused.name === "source") {
    await interaction.respond(await dataset.autocompleteSource(focused.value));
  } else if (cmd === "dataset" && focused.name === "language") {
    await interaction.respond(await dataset.autocompleteDsLanguage(focused.value));
  } else {
    await interaction.respond([]);
  }
}

client.login(loadToken());
