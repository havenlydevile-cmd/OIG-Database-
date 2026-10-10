import type { RequestHandler } from "express";
import { db, banRecordsTable } from "@workspace/db";
import { getDiscordClient, banUserEverywhere, sendMessage } from "../services/discord";
import { logger } from "../lib/logger";

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
const FLOOD_THRESHOLD = 18; // requests
const FLOOD_WINDOW = 5000; // 5 seconds in ms

async function detectRaidActivity(req: any): Promise<boolean> {
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  const bodyStr = JSON.stringify(req.body || {});

  // Check for SQL injection patterns
  for (const pattern of RAID_PATTERNS) {
    if (pattern.regex.test(bodyStr) || pattern.regex.test(req.path || "")) {
      logger.warn({ pattern: pattern.name, ip: clientIp }, "Raid pattern detected");
      return true;
    }
  }

  // Check for write flood (>18 requests in 5 seconds)
  const now = Date.now();
  const tracking = REQUEST_TRACKING.get(clientIp) || { count: 0, timestamp: now };

  if (now - tracking.timestamp < FLOOD_WINDOW) {
    tracking.count++;
    if (tracking.count >= FLOOD_THRESHOLD) {
      logger.warn({ ip: clientIp, count: tracking.count }, "Write flood detected");
      REQUEST_TRACKING.delete(clientIp);
      return true;
    }
  } else {
    tracking.count = 1;
    tracking.timestamp = now;
  }

  REQUEST_TRACKING.set(clientIp, tracking);
  return false;
}

async function executeGlobalBan(userId: string, ipAddress: string, reason: string) {
  try {
    logger.info({ userId, ip: ipAddress }, "Executing global anti-raid ban");

    // Get Discord client and ban user everywhere
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

    logger.info({ userId, bannedServers: successCount }, "Global ban executed");
  } catch (error) {
    logger.error({ err: error }, "Failed to execute global ban");
  }
}

export function antiRaidGuard(): RequestHandler {
  return async (req, res, next) => {
    try {
      const isRaidActivity = await detectRaidActivity(req);

      if (!isRaidActivity) {
        return next();
      }

      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
      const userId = req.user?.id || req.body?.userId || clientIp;

      logger.warn({ userId, ip: clientIp, path: req.path }, "RAID DETECTED - Initiating global ban");

      // Execute global ban immediately
      await executeGlobalBan(userId, clientIp, "Detected as potential database raid attack");

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
