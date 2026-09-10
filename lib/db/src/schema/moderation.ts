import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const moderationSettingsTable = pgTable("moderation_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const punishmentRecordsTable = pgTable("punishment_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  suspectUsername: text("suspect_username").notNull(),
  suspectUserId: text("suspect_user_id").notNull(),
  offense: text("offense").notNull(),
  verdict: text("verdict").notNull(),
  approver: text("approver").notNull(),
  attendees: text("attendees").array().notNull().default([]),
  punishments: text("punishments").array().notNull(),
  proof: text("proof").array().notNull().default([]),
  transcriptUrl: text("transcript_url"),
  transcriptText: text("transcript_text"),
  punishmentMessageUrl: text("punishment_message_url"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const appealRecordsTable = pgTable("appeal_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  appellantUsername: text("appellant_username").notNull(),
  appellantUserId: text("appellant_user_id").notNull(),
  punishment: text("punishment").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  approver: text("approver"),
  transcriptUrl: text("transcript_url"),
  transcriptText: text("transcript_text"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ticketRecordsTable = pgTable("ticket_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  channelId: text("channel_id").notNull().unique(),
  type: text("type").notNull(),
  openedBy: text("opened_by").notNull(),
  openedByUserId: text("opened_by_user_id").notNull(),
  status: text("status").notNull().default("open"),
  transcriptUrl: text("transcript_url"),
  transcriptText: text("transcript_text"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const banRecordsTable = pgTable("ban_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  reason: text("reason").notNull(),
  evidence: text("evidence").array().notNull().default([]),
  scope: text("scope").notNull(),
  guildIds: text("guild_ids").array().notNull().default([]),
  executedBy: text("executed_by").notNull(),
  caseLogMessageUrl: text("case_log_message_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const personnelTable = pgTable("personnel", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  discordUserId: text("discord_user_id").notNull().unique(),
  discordUsername: text("discord_username").notNull(),
  guildId: text("guild_id").notNull(),
  roleId: text("role_id").notNull(),
  commandPasswordHash: text("command_password_hash").notNull(),
  status: text("status").notNull().default("active"),
  lastPasswordFailureAt: timestamp("last_password_failure_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const personnelAuditLogsTable = pgTable("personnel_audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkUserId: text("clerk_user_id"),
  discordUserId: text("discord_user_id"),
  action: text("action").notNull(),
  success: text("success").notNull(),
  details: text("details").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPunishmentSchema = createInsertSchema(
  punishmentRecordsTable,
).omit({
  id: true,
  createdAt: true,
});
export const insertAppealSchema = createInsertSchema(appealRecordsTable).omit({
  id: true,
  createdAt: true,
});
export const insertTicketSchema = createInsertSchema(ticketRecordsTable).omit({
  id: true,
  createdAt: true,
});
export const insertBanSchema = createInsertSchema(banRecordsTable).omit({
  id: true,
  createdAt: true,
});
export const insertPersonnelSchema = createInsertSchema(personnelTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ModerationSettingsRow = typeof moderationSettingsTable.$inferSelect;
export type PunishmentRecord = typeof punishmentRecordsTable.$inferSelect;
export type AppealRecord = typeof appealRecordsTable.$inferSelect;
export type TicketRecord = typeof ticketRecordsTable.$inferSelect;
export type BanRecord = typeof banRecordsTable.$inferSelect;
export type Personnel = typeof personnelTable.$inferSelect;
export type PersonnelAuditLog = typeof personnelAuditLogsTable.$inferSelect;
export type InsertPunishment = z.infer<typeof insertPunishmentSchema>;
export type InsertAppeal = z.infer<typeof insertAppealSchema>;
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type InsertBan = z.infer<typeof insertBanSchema>;
export type InsertPersonnel = z.infer<typeof insertPersonnelSchema>;