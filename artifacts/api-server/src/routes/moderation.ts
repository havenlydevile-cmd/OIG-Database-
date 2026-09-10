import { Router, type IRouter, type Request, type Response } from "express";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import {
  appealRecordsTable,
  banRecordsTable,
  db,
  moderationSettingsTable,
  punishmentRecordsTable,
  ticketRecordsTable,
} from "@workspace/db";
import {
  CreateAppealBody,
  CreatePunishmentBody,
  DecideAppealBody,
  DecideAppealParams,
  ExecutePunishmentBody,
  ExecutePunishmentParams,
  GetPunishmentsByUserParams,
  ListPunishmentsQueryParams,
  UpdateSettingsBody,
} from "@workspace/api-zod";
import {
  addRole,
  banUserEverywhere,
  banUserInGuild,
  closeTicketChannel,
  createTicketChannel,
  defaultSettings,
  dmUser,
  fetchTicketTranscript,
  isModerator,
  removeRole,
  sendMessage,
  sendTicketPanel,
  setInteractionHandler,
} from "../services/discord";
import { logger } from "../lib/logger";
import { EmbedBuilder, type Interaction } from "discord.js";

const router: IRouter = Router();

type Settings = typeof defaultSettings;
type PunishmentType = (typeof defaultSettings.punishments)[number]["type"];

async function loadSettings(): Promise<Settings> {
  const [row] = await db.select().from(moderationSettingsTable).limit(1);
  if (!row) {
    const [created] = await db
      .insert(moderationSettingsTable)
      .values({ config: defaultSettings })
      .returning();
    return created.config as Settings;
  }
  return { ...defaultSettings, ...(row.config as Partial<Settings>) } as Settings;
}

async function saveSettings(input: Partial<Settings>) {
  const current = await loadSettings();
  const next = {
    ...current,
    ...input,
    punishments: input.punishments ?? current.punishments,
    ticketTypes: input.ticketTypes ?? current.ticketTypes,
    channels: input.channels ?? current.channels,
    rolePings: input.rolePings ?? current.rolePings,
  };
  const [row] = await db
    .select()
    .from(moderationSettingsTable)
    .limit(1);
  if (row) {
    await db
      .update(moderationSettingsTable)
      .set({ config: next })
      .where(eq(moderationSettingsTable.id, row.id));
  } else {
    await db.insert(moderationSettingsTable).values({ config: next });
  }
  return next;
}

function toPunishmentResponse(row: typeof punishmentRecordsTable.$inferSelect) {
  return {
    id: row.id,
    suspectUsername: row.suspectUsername,
    suspectUserId: row.suspectUserId,
    offense: row.offense,
    verdict: row.verdict,
    approver: row.approver,
    attendees: row.attendees,
    punishments: row.punishments,
    proof: row.proof,
    transcriptUrl: row.transcriptUrl,
    punishmentMessageUrl: row.punishmentMessageUrl,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function toAppealResponse(row: typeof appealRecordsTable.$inferSelect) {
  return {
    id: row.id,
    appellantUsername: row.appellantUsername,
    appellantUserId: row.appellantUserId,
    punishment: row.punishment,
    reason: row.reason,
    status: row.status,
    approver: row.approver,
    transcriptUrl: row.transcriptUrl,
    createdAt: row.createdAt,
  };
}

function toTicketResponse(row: typeof ticketRecordsTable.$inferSelect) {
  return {
    id: row.id,
    channelId: row.channelId,
    type: row.type,
    openedBy: row.openedBy,
    openedByUserId: row.openedByUserId,
    status: row.status,
    transcriptUrl: row.transcriptUrl,
    createdAt: row.createdAt,
  };
}

router.get("/dashboard", async (_req, res) => {
  const [openTickets] = await db
    .select({ value: count() })
    .from(ticketRecordsTable)
    .where(eq(ticketRecordsTable.status, "open"));
  const [pendingAppeals] = await db
    .select({ value: count() })
    .from(appealRecordsTable)
    .where(eq(appealRecordsTable.status, "pending"));
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [punishmentsThisMonth] = await db
    .select({ value: count() })
    .from(punishmentRecordsTable)
    .where(gte(punishmentRecordsTable.createdAt, monthStart));
  const [activeSuspensions] = await db
    .select({ value: count() })
    .from(punishmentRecordsTable)
    .where(
      and(
        eq(punishmentRecordsTable.status, "executed"),
        sql`${punishmentRecordsTable.punishments} && ARRAY['suspension_3', 'suspension_7', 'suspension_14']::text[]`,
      ),
    );
  const recent = await db
    .select()
    .from(punishmentRecordsTable)
    .orderBy(desc(punishmentRecordsTable.createdAt))
    .limit(5);
  res.json({
    openTickets: Number(openTickets?.value ?? 0),
    pendingAppeals: Number(pendingAppeals?.value ?? 0),
    punishmentsThisMonth: Number(punishmentsThisMonth?.value ?? 0),
    activeSuspensions: Number(activeSuspensions?.value ?? 0),
    recentCases: recent.map(toPunishmentResponse),
  });
});

router.get("/settings", async (_req, res) => {
  res.json(await loadSettings());
});

router.patch("/settings", async (req, res) => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(await saveSettings(parsed.data as Partial<Settings>));
});

router.get("/punishments", async (req, res) => {
  const parsed = ListPunishmentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { search, limit } = parsed.data;
  const query = db
    .select()
    .from(punishmentRecordsTable)
    .orderBy(desc(punishmentRecordsTable.createdAt))
    .limit(limit);
  const rows = search
    ? await query.where(
        or(
          ilike(punishmentRecordsTable.suspectUsername, `%${search}%`),
          ilike(punishmentRecordsTable.suspectUserId, `%${search}%`),
          ilike(punishmentRecordsTable.offense, `%${search}%`),
        ),
      )
    : await query;
  res.json(rows.map(toPunishmentResponse));
});

router.post("/punishments", async (req, res) => {
  const parsed = CreatePunishmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const [row] = await db
    .insert(punishmentRecordsTable)
    .values({
      ...parsed.data,
      attendees: parsed.data.attendees ?? [],
      punishments: parsed.data.punishments,
      proof: parsed.data.proof ?? [],
    })
    .returning();
  res.status(201).json(toPunishmentResponse(row));
});

router.get("/punishments/by-user/:userId", async (req, res) => {
  const parsed = GetPunishmentsByUserParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const rows = await db
    .select()
    .from(punishmentRecordsTable)
    .where(eq(punishmentRecordsTable.suspectUserId, parsed.data.userId))
    .orderBy(desc(punishmentRecordsTable.createdAt));
  res.json(rows.map(toPunishmentResponse));
});

router.post("/punishments/:id/execute", async (req, res) => {
  const params = ExecutePunishmentParams.safeParse(req.params);
  const body = ExecutePunishmentBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid execution request" });
    return;
  }
  const [record] = await db
    .select()
    .from(punishmentRecordsTable)
    .where(eq(punishmentRecordsTable.id, params.data.id))
    .limit(1);
  if (!record) {
    res.status(404).json({ error: "Punishment record not found" });
    return;
  }
  const settings = await loadSettings();
  const transcript = await fetchTicketTranscript(body.data.ticketChannelId);
  const labels = record.punishments.map(
    (type) => settings.punishments.find((item) => item.type === type)?.label ?? type,
  );
  const pingIds = body.data.additionalPingRoleIds ?? [];
  const pingText = pingIds.length ? `${pingIds.map((id) => `<@&${id}>`).join(" ")}\n` : "";
  const message = [
    pingText,
    `Username: ${record.suspectUsername} (<@${record.suspectUserId}>)`,
    `Punishment: ${labels.join(" + ")}`,
    `Reason: ${record.offense}`,
    `Proof: ${record.proof.length ? record.proof.join("\n") : "Attached in the case ticket."}`,
  ].join("\n");
  const channelKey = record.punishments.includes("blacklist")
    ? settings.channels.blacklist
    : record.punishments.includes("exile")
      ? settings.channels.exile
      : settings.channels.punishment;
  const published = channelKey ? await sendMessage(channelKey, message) : null;

  if (settings.guildId) {
    for (const punishment of record.punishments) {
      const definition = settings.punishments.find((item) => item.type === punishment);
      if (definition?.requiresRole && definition.roleId) {
        await addRole(settings.guildId, record.suspectUserId, definition.roleId);
      }
    }
  }

  const suspension = record.punishments.find((value) => value.startsWith("suspension_"));
  if (suspension) {
    const days = suspension.replace("suspension_", "");
    await dmUser(
      record.suspectUserId,
      [
        `Hello, I am ${body.data.loggedBy ?? record.approver}, representing the Office of the Inspector General as a Case Agent.`,
        `This notice is to inform you that you have been suspended for ${days} days due to your actions.`,
        "",
        "During this suspension, you are prohibited from joining or participating in any Army-related teams or events within the USAF. Failure to comply with these terms will result in immediate exile.",
        "",
        `Punishments log: ${published?.url ?? "The punishment record has been filed in the moderation log."}`,
      ].join("\n"),
    );
  }

  if (settings.logGuildId && settings.channels.caseLog) {
    const attendeeText = record.attendees.length
      ? record.attendees.map((attendee) => `<@${attendee}>`).join(" ")
      : "No attendees recorded";
    await sendMessage(
      settings.channels.caseLog,
      [
        attendeeText,
        `Suspect: ${record.suspectUsername} (<@${record.suspectUserId}>)`,
        `Offense: ${record.offense}`,
        `Verdict: ${record.verdict}`,
        `Approver: ${record.approver}`,
        `Ticket Transcript: ${body.data.ticketChannelId}`,
        body.data.caseLogRoleId ? `<@&${body.data.caseLogRoleId}>` : "",
      ].filter(Boolean).join("\n"),
    );
  }

  const [updated] = await db
    .update(punishmentRecordsTable)
    .set({
      status: "executed",
      transcriptText: transcript,
      transcriptUrl: published?.url ?? null,
      punishmentMessageUrl: published?.url ?? null,
    })
    .where(eq(punishmentRecordsTable.id, record.id))
    .returning();
  res.json(toPunishmentResponse(updated));
});

router.get("/appeals", async (_req, res) => {
  const rows = await db.select().from(appealRecordsTable).orderBy(desc(appealRecordsTable.createdAt));
  res.json(rows.map(toAppealResponse));
});

router.post("/appeals", async (req, res) => {
  const parsed = CreateAppealBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const [row] = await db.insert(appealRecordsTable).values(parsed.data).returning();
  res.status(201).json(toAppealResponse(row));
});

router.post("/appeals/:id/decide", async (req, res) => {
  const params = DecideAppealParams.safeParse(req.params);
  const body = DecideAppealBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid appeal decision" });
    return;
  }
  const [appeal] = await db
    .select()
    .from(appealRecordsTable)
    .where(eq(appealRecordsTable.id, params.data.id))
    .limit(1);
  if (!appeal) {
    res.status(404).json({ error: "Appeal not found" });
    return;
  }

  const settings = await loadSettings();
  let matchingPunishment: typeof punishmentRecordsTable.$inferSelect | undefined;
  [matchingPunishment] = await db
    .select()
    .from(punishmentRecordsTable)
    .where(eq(punishmentRecordsTable.suspectUserId, appeal.appellantUserId))
    .orderBy(desc(punishmentRecordsTable.createdAt))
    .limit(1);
  if (body.data.status === "accepted" && settings.guildId && matchingPunishment) {
    const definition = settings.punishments.find((item) => item.type === appeal.punishment);
    if (definition?.roleId) {
      await removeRole(settings.guildId, appeal.appellantUserId, definition.roleId);
    }
  }

  const appealMessage = [
    `<@${appeal.appellantUserId}>`,
    `Appeal status: ${body.data.status === "accepted" ? "Accepted" : "Denied"}`,
    `Username: ${appeal.appellantUsername}`,
    `Punishment appealed: ${settings.punishments.find((item) => item.type === appeal.punishment)?.label ?? appeal.punishment}`,
    body.data.pingRoleId ? `<@&${body.data.pingRoleId}>` : "",
  ].filter(Boolean).join("\n");
  if (settings.channels.appealedPunishment) {
    await sendMessage(settings.channels.appealedPunishment, appealMessage);
  }
  if (settings.logGuildId && settings.channels.caseLog) {
    await sendMessage(
      settings.channels.caseLog,
      [
        `<@${appeal.appellantUserId}>`,
        `Appealent: ${appeal.appellantUsername}`,
        `Appealing: ${appeal.punishment}`,
        `Appeal accepted/denied: ${body.data.status}`,
        `Approver: ${body.data.approver}`,
        `Ticket Transcript: ${body.data.ticketChannelId}`,
        body.data.pingRoleId ? `<@&${body.data.pingRoleId}>` : "",
      ].filter(Boolean).join("\n"),
    );
  }
  const transcript = await fetchTicketTranscript(body.data.ticketChannelId);
  const [updated] = await db
    .update(appealRecordsTable)
    .set({ status: body.data.status, approver: body.data.approver, transcriptText: transcript })
    .where(eq(appealRecordsTable.id, appeal.id))
    .returning();
  res.json(toAppealResponse(updated));
});

router.get("/tickets", async (_req, res) => {
  const rows = await db.select().from(ticketRecordsTable).orderBy(desc(ticketRecordsTable.createdAt)).limit(50);
  res.json(rows.map(toTicketResponse));
});

async function handleDiscordInteraction(interaction: Interaction) {
  const replyEmbed = async (title: string, description: string, ephemeral = true) => {
    if (interaction.isRepliable()) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(0x6d28d9)
            .setTimestamp()
            .setFooter({ text: "Office of the Inspector General" }),
        ],
        ephemeral,
      });
    }
  };

  const createTicketFromType = async (type: string, openedByUserId: string, openedByUsername: string, guildId: string) => {
    const settings = await loadSettings();
    const definition = settings.ticketTypes.find((item) => item.type === type);
    if (!definition) {
      throw new Error("This ticket type is not configured yet.");
    }
    const channel = await createTicketChannel(guildId, definition.categoryChannelId, openedByUserId, definition.label, definition.pingRoleId);
    await db.insert(ticketRecordsTable).values({
      channelId: channel.id,
      type,
      openedBy: openedByUsername,
      openedByUserId,
    });
    return { channel, definition };
  };

  if (interaction.isButton() && interaction.customId.startsWith("ticket:")) {
    if (!interaction.guildId) {
      await replyEmbed("Ticket unavailable", "Tickets can only be opened inside a configured Discord server.");
      return;
    }
    try {
      const { channel, definition } = await createTicketFromType(
        interaction.customId.slice("ticket:".length),
        interaction.user.id,
        interaction.user.username,
        interaction.guildId,
      );
      await replyEmbed(
        `${definition.label} ticket created`,
        `Your private ticket has been opened: ${channel}. Please complete the formal intake embed.`,
      );
    } catch (error) {
      await replyEmbed("Ticket could not be opened", error instanceof Error ? error.message : "The ticket configuration is incomplete.");
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ticket-panel") {
    const member = interaction.member && "permissions" in interaction.member ? interaction.member : null;
    if (!await isModerator(member) || !interaction.channelId) {
      await replyEmbed("Permission denied", "Only authorized moderators can post a ticket panel.");
      return;
    }
    const settings = await loadSettings();
    await sendTicketPanel(interaction.channelId, settings.ticketTypes);
    await replyEmbed("Ticket panel posted", "Members can now open E1–05 reports, 06+ reports, and appeals from the panel.");
    return;
  }

  if (interaction.commandName === "history") {
    const member = interaction.member && "permissions" in interaction.member ? interaction.member : null;
    if (!await isModerator(member)) {
      await replyEmbed("Permission denied", "Only authorized moderators can view formal moderation history.");
      return;
    }
    const user = interaction.options.getUser("member", true);
    const [punishments, appeals] = await Promise.all([
      db.select().from(punishmentRecordsTable).where(eq(punishmentRecordsTable.suspectUserId, user.id)).orderBy(desc(punishmentRecordsTable.createdAt)),
      db.select().from(appealRecordsTable).where(eq(appealRecordsTable.appellantUserId, user.id)).orderBy(desc(appealRecordsTable.createdAt)),
    ]);
    const punishmentLines = punishments.length
      ? punishments.map((row) => `**${row.createdAt.toISOString().slice(0, 10)}**\nCase: \`${row.id}\`\nPunishment: ${row.punishments.join(" + ")}\nVerdict: ${row.verdict}\nStatus: ${row.status}\nApprover: ${row.approver}`).join("\n\n")
      : "No punishment records found.";
    const appealLines = appeals.length
      ? appeals.map((row) => `**${row.createdAt.toISOString().slice(0, 10)}**\nAppeal: ${row.punishment}\nReason: ${row.reason}\nDecision: ${row.status}\nApprover: ${row.approver ?? "Pending"}`).join("\n\n")
      : "No appeal records found.";
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Formal moderation history — ${user.username}`)
          .setDescription(`**Member**\n${user.tag} • ${user.id}\n\n**Punishment history**\n${punishmentLines}\n\n**Appeal history**\n${appealLines}`)
          .setColor(0x6d28d9)
          .setTimestamp()
          .setFooter({ text: "Confidential moderation record • Office of the Inspector General" }),
      ],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "add-punishment") {
    const member = interaction.member && "permissions" in interaction.member ? interaction.member : null;
    if (!await isModerator(member)) {
      await replyEmbed("Permission denied", "Only authorized moderators may add punishment records.");
      return;
    }
    const user = interaction.options.getUser("member", true);
    const punishment = interaction.options.getString("punishment", true) as PunishmentType;
    const offense = interaction.options.getString("offense", true);
    const verdict = interaction.options.getString("verdict", true);
    const [row] = await db.insert(punishmentRecordsTable).values({
      suspectUsername: user.username,
      suspectUserId: user.id,
      offense,
      verdict,
      approver: interaction.user.username,
      attendees: [interaction.user.id],
      punishments: [punishment],
      proof: [],
    }).returning();
    await replyEmbed("Punishment record created", `Case record \`${row.id}\` was added for ${user.username}.`);
    return;
  }

  if (interaction.commandName === "approve" || interaction.commandName === "transcript") {
    const member = interaction.member && "permissions" in interaction.member ? interaction.member : null;
    if (!await isModerator(member)) {
      await replyEmbed("Permission denied", "Only authorized moderators can edit case verdicts.");
      return;
    }
    const caseId = interaction.options.getString("case_id", true);
    const verdict = interaction.options.getString("verdict", true);
    const [updated] = await db
      .update(punishmentRecordsTable)
      .set({ verdict, approver: interaction.user.username })
      .where(eq(punishmentRecordsTable.id, caseId))
      .returning();
    if (!updated) {
      await replyEmbed("Case not found", "No punishment case matched that case ID.");
      return;
    }
    await replyEmbed(
      interaction.commandName === "approve" ? "Verdict approved" : "Verdict transcript updated",
      `Case \`${updated.id}\` now records the following formal verdict:\n\n${updated.verdict}\n\nApprover: ${interaction.user.username}`,
    );
    if (interaction.channelId) {
      await sendMessage(
        interaction.channelId,
        `**Case verdict update**\nCase: \`${updated.id}\`\nUpdated verdict: ${updated.verdict}\nApprover: ${interaction.user.tag}`,
      );
    }
    return;
  }

  if (interaction.commandName === "close") {
    const member = interaction.member && "permissions" in interaction.member ? interaction.member : null;
    if (!await isModerator(member) || !interaction.channelId) {
      await replyEmbed("Permission denied", "Only authorized moderators can close a ticket.");
      return;
    }
    const transcript = await fetchTicketTranscript(interaction.channelId);
    await closeTicketChannel(interaction.channelId);
    await db.update(ticketRecordsTable)
      .set({ status: "closed", transcriptText: transcript })
      .where(eq(ticketRecordsTable.channelId, interaction.channelId));
    await replyEmbed("Ticket closed", "The ticket has been archived and its transcript has been preserved.");
    return;
  }

  if (interaction.commandName === "ban" || (interaction.commandName === "global" && interaction.options.getSubcommand() === "ban")) {
    const member = interaction.member && "permissions" in interaction.member ? interaction.member : null;
    if (!await isModerator(member)) {
      await replyEmbed("Permission denied", "Only authorized moderators may issue bans.");
      return;
    }
    const user = interaction.options.getUser("member", true);
    const reason = interaction.options.getString("reason", true);
    const evidence = interaction.options.getString("evidence", true);
    const global = interaction.commandName === "global";
    const guildIds: string[] = [];
    let results: Array<{ guildId: string; guildName: string; success: boolean; error?: string }> = [];
    if (global) {
      results = await banUserEverywhere(user.id, reason);
      guildIds.push(...results.map((result) => result.guildId));
    } else if (interaction.guildId) {
      await banUserInGuild(interaction.guildId, user.id, reason);
      guildIds.push(interaction.guildId);
      results = [{ guildId: interaction.guildId, guildName: interaction.guild?.name ?? interaction.guildId, success: true }];
    } else {
      await replyEmbed("Ban unavailable", "A local ban must be issued from inside a Discord server.");
      return;
    }
    const successCount = results.filter((result) => result.success).length;
    const failureSummary = results.filter((result) => !result.success).map((result) => `${result.guildName}: ${result.error}`).join("\n");
    const settings = await loadSettings();
    const logContent = [
      `**Ban type:** ${global ? "Global ban" : "Server ban"}`,
      `**Subject:** ${user.tag} (${user.id})`,
      `**Reason:** ${reason}`,
      `**Evidence:** ${evidence}`,
      `**Executed by:** ${interaction.user.tag}`,
      `**Servers affected:** ${successCount}/${results.length}`,
      failureSummary ? `**Server failures:**\n${failureSummary}` : "",
    ].filter(Boolean).join("\n");
    const caseLogMessage = settings.channels.caseLog ? await sendMessage(settings.channels.caseLog, logContent) : null;
    await db.insert(banRecordsTable).values({
      userId: user.id,
      username: user.tag,
      reason,
      evidence: [evidence],
      scope: global ? "global" : "server",
      guildIds,
      executedBy: interaction.user.tag,
      caseLogMessageUrl: caseLogMessage?.url ?? null,
    });
    await replyEmbed(
      global ? "Global ban completed" : "Server ban completed",
      `${user.tag} was banned in ${successCount} of ${results.length} server(s).${failureSummary ? `\n\nFailures:\n${failureSummary}` : ""}\n\nThe formal ban case was saved${caseLogMessage ? ` and logged at ${caseLogMessage.url}` : ""}.`,
    );
  }
}

setInteractionHandler(handleDiscordInteraction);

export default router;