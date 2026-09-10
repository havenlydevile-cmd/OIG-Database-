import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type Interaction,
  type TextChannel,
} from "discord.js";
import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db, personnelAuditLogsTable, personnelTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const token = process.env.DISCORD_BOT_TOKEN;
const scrypt = promisify(scryptCallback);
let client: Client | null = null;
let interactionHandler: ((interaction: Interaction) => Promise<void>) | null = null;

export const defaultSettings = {
  guildId: null,
  logGuildId: null,
  moderatorRoleId: null,
  punishments: [
    { type: "vw", label: "Vw", requiresRole: true, roleId: null, requiresDM: false, active: true },
    { type: "strike_1", label: "[1] Strike", requiresRole: true, roleId: null, requiresDM: false, active: true },
    { type: "strike_2", label: "[2] Strike", requiresRole: true, roleId: null, requiresDM: false, active: true },
    { type: "disciplinary_1", label: "[1] Disciplinary Penalty", requiresRole: true, roleId: null, requiresDM: false, active: true },
    { type: "disciplinary_2", label: "[2] Disciplinary Penalty", requiresRole: true, roleId: null, requiresDM: false, active: true },
    { type: "blacklist", label: "Blacklist", requiresRole: false, roleId: null, requiresDM: true, active: true },
    { type: "exile", label: "Exile", requiresRole: false, roleId: null, requiresDM: true, active: true },
    { type: "suspension_3", label: "3 days suspension", requiresRole: false, roleId: null, requiresDM: true, active: true },
    { type: "suspension_7", label: "7 days suspension", requiresRole: false, roleId: null, requiresDM: true, active: true },
    { type: "suspension_14", label: "14 days suspension", requiresRole: false, roleId: null, requiresDM: true, active: true },
  ],
  ticketTypes: [
    { type: "e1_05_report", label: "E1–05 Report", categoryChannelId: "", pingRoleId: "" },
    { type: "e6_plus_report", label: "06+ Report", categoryChannelId: "", pingRoleId: "" },
    { type: "appeal", label: "Appeal", categoryChannelId: "", pingRoleId: "" },
  ],
  channels: { punishment: "", blacklist: "", exile: "", appealedPunishment: "", caseLog: "" },
  rolePings: [
    { key: "case_attendees", label: "Case attendees", roleId: "" },
    { key: "case_approver", label: "Case approver", roleId: "" },
    { key: "appeals", label: "Appeals team", roleId: "" },
  ],
};

export function getDiscordClient() {
  return client;
}

export async function startDiscordBot() {
  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN is not configured; Discord worker is disabled");
    return;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.once("clientReady", async (readyClient) => {
    logger.info({ user: readyClient.user.tag }, "Discord moderation bot is online");
    await registerCommands(readyClient.user.id);
  });
  client.on("error", (error) => logger.error({ err: error }, "Discord client error"));
  client.on("interactionCreate", async (interaction) => {
    if (!interactionHandler) return;
    try {
      await interactionHandler(interaction);
    } catch (error) {
      logger.error({ err: error }, "Discord interaction failed");
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "This action could not be completed.", ephemeral: true });
      }
    }
  });
  await client.login(token);
}

export function setInteractionHandler(handler: (interaction: Interaction) => Promise<void>) {
  interactionHandler = handler;
}

async function registerCommands(applicationId: string) {
  if (!token) return;
  const moderatorPermissions = PermissionFlagsBits.ManageGuild;
  const commands = [
    new SlashCommandBuilder()
      .setName("ticket-panel")
      .setDescription("Post the formal moderation ticket panel in this channel")
      .setDefaultMemberPermissions(moderatorPermissions),
    new SlashCommandBuilder()
      .setName("history")
      .setDescription("View a member's recorded moderation history")
      .addUserOption((option) =>
        option.setName("member").setDescription("The member to review").setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("add-punishment")
      .setDescription("Add a punishment record to the case database")
      .addUserOption((option) =>
        option.setName("member").setDescription("The punished member").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("punishment").setDescription("Punishment type").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("offense").setDescription("Offense summary").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("verdict").setDescription("Formal verdict").setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("approve")
      .setDescription("Approve a moderation case action")
      .setDefaultMemberPermissions(moderatorPermissions)
      .addSubcommand((subcommand) =>
        subcommand
          .setName("verdict")
          .setDescription("Edit the formal verdict on a case")
          .addStringOption((option) =>
            option.setName("case_id").setDescription("The case record UUID").setRequired(true),
          )
          .addStringOption((option) =>
            option.setName("verdict").setDescription("The approved formal verdict").setRequired(true),
          ),
      ),
    new SlashCommandBuilder()
      .setName("close")
      .setDescription("Close and archive the current moderation ticket")
      .setDefaultMemberPermissions(moderatorPermissions),
    new SlashCommandBuilder()
      .setName("transcript")
      .setDescription("Manage the current case transcript")
      .setDefaultMemberPermissions(moderatorPermissions)
      .addSubcommand((subcommand) =>
        subcommand
          .setName("edit")
          .setDescription("Edit the verdict saved on a case")
          .addStringOption((option) =>
            option.setName("case_id").setDescription("The case record UUID").setRequired(true),
          )
          .addStringOption((option) =>
            option.setName("verdict").setDescription("The corrected formal verdict").setRequired(true),
          ),
      ),
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban a member from this server and log the ban")
      .setDefaultMemberPermissions(moderatorPermissions)
      .addUserOption((option) =>
        option.setName("member").setDescription("The member to ban").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("reason").setDescription("Formal reason for the ban").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("evidence").setDescription("Evidence link or evidence summary").setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("global")
      .setDescription("Apply a network-wide moderation action")
      .setDefaultMemberPermissions(moderatorPermissions)
      .addSubcommand((subcommand) =>
        subcommand
          .setName("ban")
          .setDescription("Ban a user from every server where this bot is installed")
          .addUserOption((option) =>
            option.setName("member").setDescription("The member to ban globally").setRequired(true),
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Formal reason for the global ban").setRequired(true),
          )
          .addStringOption((option) =>
            option.setName("evidence").setDescription("Evidence link or evidence summary").setRequired(true),
          ),
      ),
  ].map((command) => command.toJSON());
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(applicationId), { body: commands });
}

export async function fetchTicketTranscript(channelId: string) {
  const channel = await client?.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return "";
  const messages = await (channel as TextChannel).messages.fetch({ limit: 100 });
  return [...messages.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(
      (message) =>
        `[${new Date(message.createdTimestamp).toISOString()}] ${message.author.tag}: ${message.content}${message.attachments.size ? ` Attachments: ${[...message.attachments.values()].map((attachment) => attachment.url).join(", ")}` : ""}`,
    )
    .join("\n");
}

export async function createTicketChannel(
  guildId: string,
  categoryId: string,
  openedByUserId: string,
  label: string,
  pingRoleId: string,
) {
  const guild = await client?.guilds.fetch(guildId);
  if (!guild) throw new Error("Configured Discord guild could not be found");
  const channel = await guild.channels.create({
    name: `case-${openedByUserId.slice(-5)}`,
    type: ChannelType.GuildText,
    parent: categoryId || undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
      { id: openedByUserId, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
      ...(pingRoleId
        ? [{ id: pingRoleId, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] as const }]
        : []),
    ],
  });
  await channel.send({
    content: `<@${openedByUserId}>${pingRoleId ? ` <@&${pingRoleId}>` : ""}`,
    embeds: [
      new EmbedBuilder()
        .setTitle(`${label} — Formal Intake`)
        .setDescription(
          "Please complete every field below. Keep all evidence attached to this ticket and do not delete or edit submitted information.",
        )
        .addFields(
          { name: "Your Discord username and ID", value: "—" },
          { name: "Subject / suspect", value: "—" },
          { name: "Incident date and time", value: "—" },
          { name: "Detailed statement", value: "—" },
          { name: "Evidence and proof links", value: "—" },
          { name: "Requested resolution", value: "—" },
        )
        .setColor(0x6d28d9)
        .setFooter({ text: "Office of the Inspector General • Preserve the complete record" }),
    ],
  });
  return channel;
}

export async function sendMessage(channelId: string, content: string) {
  const channel = await client?.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error("Discord channel not found");
  return (channel as TextChannel).send({
    embeds: [
      new EmbedBuilder()
        .setDescription(content)
        .setColor(0x6d28d9)
        .setTimestamp(),
    ],
  });
}

export async function sendTicketPanel(
  channelId: string,
  ticketTypes: Array<{ type: string; label: string }>,
) {
  const channel = await client?.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error("Discord channel not found");
  const buttons = ticketTypes.slice(0, 5).map((ticket) =>
    new ButtonBuilder()
      .setCustomId(`ticket:${ticket.type}`)
      .setLabel(ticket.label)
      .setStyle(ButtonStyle.Primary),
  );
  return (channel as TextChannel).send({
    embeds: [
      new EmbedBuilder()
        .setTitle("Office of the Inspector General — Case Intake")
        .setDescription(
          "Select the appropriate case type below. A private ticket will be created for you and the assigned moderation team will be notified.",
        )
        .addFields(
          { name: "E1–05 Report", value: "Report a matter involving E1–05 personnel." },
          { name: "06+ Report", value: "Report a matter involving 06+ personnel." },
          { name: "Appeal", value: "Request a formal review of an existing punishment." },
        )
        .setColor(0x6d28d9)
        .setFooter({ text: "Please submit complete and truthful information." }),
    ],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
  });
}

export async function closeTicketChannel(channelId: string) {
  const channel = await client?.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error("Discord ticket channel not found");
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: false });
  if (!channel.name.startsWith("closed-")) {
    await channel.setName(`closed-${channel.name}`);
  }
  return channel;
}

export async function banUserInGuild(guildId: string, userId: string, reason: string) {
  const guild = await client?.guilds.fetch(guildId);
  if (!guild) throw new Error("Discord guild could not be found");
  await guild.bans.create(userId, { reason, deleteMessageSeconds: 0 });
}

export async function banUserEverywhere(userId: string, reason: string) {
  if (!client) throw new Error("Discord bot is not connected");
  const results: Array<{ guildId: string; guildName: string; success: boolean; error?: string }> = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.bans.create(userId, { reason, deleteMessageSeconds: 0 });
      results.push({ guildId: guild.id, guildName: guild.name, success: true });
    } catch (error) {
      results.push({
        guildId: guild.id,
        guildName: guild.name,
        success: false,
        error: error instanceof Error ? error.message : "Unknown Discord error",
      });
    }
  }
  return results;
}

export async function addRole(guildId: string, userId: string, roleId: string) {
  const guild = await client?.guilds.fetch(guildId);
  if (!guild) throw new Error("Configured Discord guild could not be found");
  const member = await guild.members.fetch(userId);
  await member.roles.add(roleId);
}

export async function removeRole(guildId: string, userId: string, roleId: string) {
  const guild = await client?.guilds.fetch(guildId);
  if (!guild) throw new Error("Configured Discord guild could not be found");
  const member = await guild.members.fetch(userId);
  await member.roles.remove(roleId);
}

export async function dmUser(userId: string, content: string) {
  const user = await client?.users.fetch(userId);
  if (!user) throw new Error("Discord user could not be found");
  return user.send(content);
}

export async function isModerator(member: unknown) {
  const permissions = (member as { permissions?: { has(permission: string): boolean } } | null)?.permissions;
  return Boolean(permissions?.has("ManageGuild") || permissions?.has("Administrator"));
}