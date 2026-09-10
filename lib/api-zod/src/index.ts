import { z } from 'zod';

// ============================================================================
// PUNISHMENT TYPES & ENUMS
// ============================================================================
export enum PunishmentType {
  vw = 'vw',
  strike_1 = 'strike_1',
  strike_2 = 'strike_2',
  disciplinary_1 = 'disciplinary_1',
  disciplinary_2 = 'disciplinary_2',
  blacklist = 'blacklist',
  exile = 'exile',
  suspension_3 = 'suspension_3',
  suspension_7 = 'suspension_7',
  suspension_14 = 'suspension_14',
}

// ============================================================================
// SHARED TYPES
// ============================================================================

export const ChannelSettingsSchema = z.object({
  punishment: z.string(),
  blacklist: z.string(),
  exile: z.string(),
  appealedPunishment: z.string(),
  caseLog: z.string(),
});
export type ChannelSettings = z.infer<typeof ChannelSettingsSchema>;

export const PunishmentDefinitionSchema = z.object({
  type: z.string(),
  label: z.string(),
  requiresRole: z.boolean(),
  roleId: z.string().nullable(),
  requiresDM: z.boolean(),
  active: z.boolean(),
});
export type PunishmentDefinition = z.infer<typeof PunishmentDefinitionSchema>;

export const TicketTypeDefinitionSchema = z.object({
  type: z.string(),
  label: z.string(),
  categoryChannelId: z.string(),
  pingRoleId: z.string(),
});
export type TicketTypeDefinition = z.infer<typeof TicketTypeDefinitionSchema>;

export const RolePingDefinitionSchema = z.object({
  key: z.string(),
  label: z.string(),
  roleId: z.string(),
});
export type RolePingDefinition = z.infer<typeof RolePingDefinitionSchema>;

// ============================================================================
// PUNISHMENT RECORD / CASE
// ============================================================================

export const PunishmentRecordSchema = z.object({
  id: z.string().uuid(),
  suspectUserId: z.string(),
  suspectUsername: z.string(),
  offense: z.string(),
  verdict: z.string(),
  approver: z.string(),
  transcriptUrl: z.string().nullable().optional(),
  punishments: z.array(z.string()).default([]),
  executed: z.boolean().default(false),
  executedAt: z.string().datetime().nullable().optional(),
  executedBy: z.string().nullable().optional(),
  executionTicketChannelId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PunishmentRecord = z.infer<typeof PunishmentRecordSchema>;

export const PunishmentInputSchema = z.object({
  suspectUserId: z.string(),
  suspectUsername: z.string(),
  offense: z.string(),
  verdict: z.string(),
  approver: z.string(),
  transcriptUrl: z.string().optional(),
  punishments: z.array(z.string()),
});
export type PunishmentInput = z.infer<typeof PunishmentInputSchema>;

// ============================================================================
// APPEAL RECORD
// ============================================================================

export enum AppealDecisionInputStatus {
  approved = 'approved',
  denied = 'denied',
}

export const AppealRecordSchema = z.object({
  id: z.string().uuid(),
  appellantUserId: z.string(),
  appellantUsername: z.string(),
  punishmentId: z.string().uuid().nullable().optional(),
  punishmentType: z.string(),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'denied']).default('pending'),
  approver: z.string().nullable().optional(),
  ticketChannelId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AppealRecord = z.infer<typeof AppealRecordSchema>;

export const AppealInputSchema = z.object({
  appellantUserId: z.string(),
  appellantUsername: z.string(),
  punishmentId: z.string().uuid().optional(),
  punishmentType: z.string(),
  reason: z.string(),
});
export type AppealInput = z.infer<typeof AppealInputSchema>;

export const AppealDecisionInputSchema = z.object({
  status: z.enum(['approved', 'denied']),
  approver: z.string(),
  ticketChannelId: z.string().optional(),
});
export type AppealDecisionInput = z.infer<typeof AppealDecisionInputSchema>;

// ============================================================================
// TICKET RECORD
// ============================================================================

export const TicketRecordSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string(),
  guildId: z.string(),
  openedByUserId: z.string(),
  openedByUsername: z.string(),
  ticketType: z.string(),
  status: z.enum(['open', 'closed', 'archived']).default('open'),
  transcript: z.string().nullable().optional(),
  closedAt: z.string().datetime().nullable().optional(),
  closedBy: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TicketRecord = z.infer<typeof TicketRecordSchema>;

// ============================================================================
// SETTINGS
// ============================================================================

export const SettingsSchema = z.object({
  id: z.string().uuid(),
  guildId: z.string().nullable().optional(),
  logGuildId: z.string().nullable().optional(),
  moderatorRoleId: z.string().nullable().optional(),
  channels: ChannelSettingsSchema,
  punishments: z.array(PunishmentDefinitionSchema),
  ticketTypes: z.array(TicketTypeDefinitionSchema),
  rolePings: z.array(RolePingDefinitionSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsUpdateInputSchema = z.object({
  guildId: z.string().optional(),
  logGuildId: z.string().optional(),
  moderatorRoleId: z.string().optional(),
  channels: ChannelSettingsSchema.optional(),
  punishments: z.array(PunishmentDefinitionSchema).optional(),
  ticketTypes: z.array(TicketTypeDefinitionSchema).optional(),
  rolePings: z.array(RolePingDefinitionSchema).optional(),
});
export type SettingsUpdateInput = z.infer<typeof SettingsUpdateInputSchema>;

// ============================================================================
// DASHBOARD
// ============================================================================

export const DashboardSummarySchema = z.object({
  totalCases: z.number(),
  pendingAppeals: z.number(),
  openTickets: z.number(),
  recentCases: z.array(PunishmentRecordSchema),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

// ============================================================================
// EXECUTION
// ============================================================================

export const ExecutePunishmentInputSchema = z.object({
  id: z.string().uuid(),
  data: z.object({
    ticketChannelId: z.string(),
    loggedBy: z.string().optional(),
  }),
});
export type ExecutePunishmentInput = z.infer<typeof ExecutePunishmentInputSchema>;
