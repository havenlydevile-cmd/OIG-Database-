import { pgTable, text, timestamp, uuid, boolean, json, varchar, integer } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// SETTINGS TABLE
// ============================================================================
export const settingsTable = pgTable("settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 255 }),
  logGuildId: varchar("log_guild_id", { length: 255 }),
  moderatorRoleId: varchar("moderator_role_id", { length: 255 }),
  // Channel configuration
  punishmentChannelId: varchar("punishment_channel_id", { length: 255 }),
  blacklistChannelId: varchar("blacklist_channel_id", { length: 255 }),
  exileChannelId: varchar("exile_channel_id", { length: 255 }),
  appealedPunishmentChannelId: varchar("appealed_punishment_channel_id", { length: 255 }),
  caseLogChannelId: varchar("case_log_channel_id", { length: 255 }),
  // Serialized JSON for punishments, ticket types, and role pings
  punishments: json("punishments").$type<Array<{
    type: string;
    label: string;
    requiresRole: boolean;
    roleId: string | null;
    requiresDM: boolean;
    active: boolean;
  }>().default([]),
  ticketTypes: json("ticket_types").$type<Array<{
    type: string;
    label: string;
    categoryChannelId: string;
    pingRoleId: string;
  }>().default([]),
  rolePings: json("role_pings").$type<Array<{
    key: string;
    label: string;
    roleId: string;
  }>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// PUNISHMENTS TABLE (Case Records)
// ============================================================================
export const punishmentsTable = pgTable("punishments", {
  id: uuid("id").primaryKey().defaultRandom(),
  suspectUserId: varchar("suspect_user_id", { length: 255 }).notNull(),
  suspectUsername: varchar("suspect_username", { length: 255 }).notNull(),
  offense: text("offense").notNull(),
  verdict: text("verdict").notNull(),
  approver: varchar("approver", { length: 255 }).notNull(),
  transcriptUrl: text("transcript_url"),
  // Punishment types (comma-separated or JSON array)
  punishments: json("punishments").$type<string[]>().default([]),
  // Execution status
  executed: boolean("executed").default(false),
  executedAt: timestamp("executed_at"),
  executedBy: varchar("executed_by", { length: 255 }),
  executionTicketChannelId: varchar("execution_ticket_channel_id", { length: 255 }),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// APPEALS TABLE
// ============================================================================
export const appealsTable = pgTable("appeals", {
  id: uuid("id").primaryKey().defaultRandom(),
  appellantUserId: varchar("appellant_user_id", { length: 255 }).notNull(),
  appellantUsername: varchar("appellant_username", { length: 255 }).notNull(),
  punishmentId: uuid("punishment_id").references(() => punishmentsTable.id),
  punishmentType: varchar("punishment_type", { length: 255 }).notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 50 }).default("pending").notNull(), // pending | approved | denied
  approver: varchar("approver", { length: 255 }),
  ticketChannelId: varchar("ticket_channel_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// TICKETS TABLE (Case Intake)
// ============================================================================
export const ticketsTable = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: varchar("channel_id", { length: 255 }).notNull().unique(),
  guildId: varchar("guild_id", { length: 255 }).notNull(),
  openedByUserId: varchar("opened_by_user_id", { length: 255 }).notNull(),
  openedByUsername: varchar("opened_by_username", { length: 255 }).notNull(),
  ticketType: varchar("ticket_type", { length: 255 }).notNull(), // e1_05_report | e6_plus_report | appeal
  status: varchar("status", { length: 50 }).default("open").notNull(), // open | closed | archived
  transcript: text("transcript"),
  closedAt: timestamp("closed_at"),
  closedBy: varchar("closed_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// PERSONNEL TABLE (Operator/Moderator Info)
// ============================================================================
export const personnelTable = pgTable("personnel", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  role: varchar("role", { length: 100 }), // admin | moderator | operator
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// PERSONNEL AUDIT LOGS TABLE
// ============================================================================
export const personnelAuditLogsTable = pgTable("personnel_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  personnelId: uuid("personnel_id").references(() => personnelTable.id),
  userId: varchar("user_id", { length: 255 }).notNull(),
  action: varchar("action", { length: 255 }).notNull(), // login | logout | create_case | execute_punishment | etc
  targetId: varchar("target_id", { length: 255 }), // The ID of what was acted upon (case ID, user ID, etc)
  targetType: varchar("target_type", { length: 100 }), // punishment | appeal | ticket | user | etc
  details: json("details").$type<Record<string, unknown>>().default({}),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// ZODI SCHEMAS
// ============================================================================

// Settings schemas
export const settingsInsertSchema = createInsertSchema(settingsTable);
export const settingsSelectSchema = createSelectSchema(settingsTable);
export type SettingsInsert = z.infer<typeof settingsInsertSchema>;
export type Settings = z.infer<typeof settingsSelectSchema>;

// Punishment schemas
export const punishmentsInsertSchema = createInsertSchema(punishmentsTable);
export const punishmentsSelectSchema = createSelectSchema(punishmentsTable);
export type PunishmentInsert = z.infer<typeof punishmentsInsertSchema>;
export type Punishment = z.infer<typeof punishmentsSelectSchema>;

// Appeal schemas
export const appealsInsertSchema = createInsertSchema(appealsTable);
export const appealsSelectSchema = createSelectSchema(appealsTable);
export type AppealInsert = z.infer<typeof appealsInsertSchema>;
export type Appeal = z.infer<typeof appealsSelectSchema>;

// Ticket schemas
export const ticketsInsertSchema = createInsertSchema(ticketsTable);
export const ticketsSelectSchema = createSelectSchema(ticketsTable);
export type TicketInsert = z.infer<typeof ticketsInsertSchema>;
export type Ticket = z.infer<typeof ticketsSelectSchema>;

// Personnel schemas
export const personnelInsertSchema = createInsertSchema(personnelTable);
export const personnelSelectSchema = createSelectSchema(personnelTable);
export type PersonnelInsert = z.infer<typeof personnelInsertSchema>;
export type Personnel = z.infer<typeof personnelSelectSchema>;

// Audit log schemas
export const auditLogInsertSchema = createInsertSchema(personnelAuditLogsTable);
export const auditLogSelectSchema = createSelectSchema(personnelAuditLogsTable);
export type AuditLogInsert = z.infer<typeof auditLogInsertSchema>;
export type AuditLog = z.infer<typeof auditLogSelectSchema>;
