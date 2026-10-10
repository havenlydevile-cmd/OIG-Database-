import type { RequestHandler } from "express";
import { db, banRecordsTable } from "@workspace/db";
import { getDiscordClient, banUserEverywhere, sendMessage } from "../services/discord";
import { logger } from "../lib/logger";
import { EmbedBuilder } from "discord.js";

interface RaidPattern {
  name: string;
  regex: RegExp;
  severity: "high" | "critical";
}

const RAID_PATTERNS: RaidPattern[] = [
  { name: "SQL_DROP", regex: /DROP\s+TABLE/i, severity: "critical" },
  { name: "SQL_UNION", regex: /UNION\s+SELECT/i, severity: "critical" },
  { name: "SQL_SLEEP", regex: /sleep\s*\(/i, severity: "critical" },
  { name: "SQL_BENCHMARK", regex: /benchmark/i, severity: "critical" },
  { name: "WRITE_FLOOD", regex: /POST|PUT|DELETE/i, severity: "high" },
];

const REQUEST_TRACKING = new Map<string, { count: number; timestamp: number }>();
const SLASH_COMMAND_TRACKING = new Map<string, number[]>();
const FLOOD_THRESHOLD = 18; // requests
const FLOOD_WINDOW = 5000; // 5 seconds in ms
const SLASH_COMMAND_THRESHOLD = 2; // slash commands
const SLASH_COMMAND_WINDOW = 10000; // 10 seconds in ms

async function detectRaidActivity(req: any): Promise<{ triggered: boolean; reason?: string }> {
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  const bodyStr = JSON.stringify(req.body || {});
  const userId = req.user?.id || req.body?.userId || clientIp;

  // Check for SQL injection patterns
  for (const pattern of RAID_PATTERNS) {
    if (pattern.regex.test(bodyStr) || pattern.regex.test(req.path || "")) {
      logger.warn({ pattern: pattern.name, ip: clientIp, userId }, "Raid pattern detected");
      return { triggered: true, reason: pattern.name };
    }
  }

  // Check for write flood (>18 requests in 5 seconds)
  const now = Date.now();
  const tracking = REQUEST_TRACKING.get(clientIp) || { count: 0, timestamp: now };

  if (now - tracking.timestamp < FLOOD_WINDOW) {
    tracking.count++;
    if (tracking.count >= FLOOD_THRESHOLD) {
      logger.warn({ ip: clientIp, userId, count: tracking.count }, "Write flood detected");
      REQUEST_TRACKING.delete(clientIp);
      return { triggered: true, reason: "WRITE_FLOOD" };
    }
  } else {
    tracking.count = 1;
    tracking.timestamp = now;
  }
  REQUEST_TRACKING.set(clientIp, tracking);

  // Check for slash command spam (2+ commands in 10 seconds)
  const isSlashCommand = req.body?.type === 4 || req.path?.includes("/interactions");
  if (isSlashCommand) {
    const timestamps = SLASH_COMMAND_TRACKING.get(userId) || [];
    timestamps.push(now);

    // Remove old timestamps outside the window
    const recentTimestamps = timestamps.filter((t) => now - t < SLASH_COMMAND_WINDOW);

    if (recentTimestamps.length >= SLASH_COMMAND_THRESHOLD) {
      logger.warn({ userId, ip: clientIp, commandCount: recentTimestamps.length }, "Slash command spam detected");
      SLASH_COMMAND_TRACKING.delete(userId);
      return { triggered: true, reason: "SLASH_COMMAND_SPAM" };
    }

    SLASH_COMMAND_TRACKING.set(userId, recentTimestamps);
  }

  return { triggered: false };
}

async function executeGlobalBan(userId: string, ipAddress: string, reason: string, developerChannelId?: string, developerRoleId?: string) {
  try {
    logger.info({ userId, ip: ipAddress, reason }, "Executing global anti-raid ban");

    const discordClient = getDiscordClient();
    if (!discordClient) {
      logger.error("Discord client not available for ban execution");
      return;
    }

    // Global ban across all Discord servers
    const banResults = await banUserEverywhere(userId, `[ANTI-RAID] ${reason}`);
    const successCount = banResults.filter((r) => r.success).length;

    // Log ban to ban_records table
    await db.insert(banRecordsTable).values({
      userId,
      username: `antiraid-${userId}`,
      reason: `[ANTI-RAID SYSTEM] ${reason}`,
      evidence: [ipAddress],
      scope: "global",
      guildIds: banResults.map((r) => r.guildId),
      executedBy: "ANTI_RAID_SYSTEM",
      caseLogMessageUrl: null,
    });

    // Send developer review notification
    if (developerChannelId) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle("🚨 Anti-Raid System Triggered")
        .setDescription(`A user has been automatically banned due to suspected database raid activity.`)
        .addFields(
          { name: "User ID", value: userId, inline: true },
          { name: "IP Address", value: ipAddress, inline: true },
          { name: "Trigger Reason", value: reason, inline: false },
          { name: "Servers Banned", value: `${successCount} server(s)`, inline: true },
          { name: "Status", value: "✅ Automatically Executed", inline: true },
          { name: "Timestamp", value: new Date().toISOString(), inline: false }
        )
        .setTimestamp();

      const mention = developerRoleId ? `<@&${developerRoleId}> ` : "";
      await sendMessage(developerChannelId, `${mention}**Anti-Raid Alert**`, embed);
    }

    logger.info({ userId, bannedServers: successCount }, "Global ban executed and developers notified");
  } catch (error) {
    logger.error({ err: error }, "Failed to execute global ban or send notification");
  }
}

export function antiRaidGuard(): RequestHandler {
  return async (req, res, next) => {
    try {
      const detection = await detectRaidActivity(req);

      if (!detection.triggered) {
        return next();
      }

      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
      const userId = req.user?.id || req.body?.userId || clientIp;

      logger.warn({ userId, ip: clientIp, path: req.path, reason: detection.reason }, "RAID DETECTED - Initiating global ban");

      // Load settings to get developer channel and role
      let developerChannelId: string | undefined;
      let developerRoleId: string | undefined;

      try {
        const { moderationSettingsTable } = await import("@workspace/db");
        const { db } = await import("@workspace/db");
        const [settings] = await db.select().from(moderationSettingsTable).limit(1);
        developerChannelId = settings?.config?.channels?.antiRaidReview;
        developerRoleId = settings?.config?.rolePings?.find((r: any) => r.key === "developer")?.roleId;
      } catch (error) {
        logger.warn("Could not load moderation settings for anti-raid notification");
      }

      // Execute global ban with developer notification
      await executeGlobalBan(userId, clientIp, detection.reason || "Detected as potential database raid attack", developerChannelId, developerRoleId);

      // Return 403 Forbidden
      return res.status(403).json({
        error: "Access Denied",
        message: "Suspicious activity detected. You have been globally banned and reported to administrators.",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ err: error }, "Error in anti-raid guard");
      return next();
    }
  };
}
