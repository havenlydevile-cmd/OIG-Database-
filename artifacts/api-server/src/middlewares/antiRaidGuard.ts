import type { RequestHandler } from "express";

/**
 * Temporary hard-disable for any anti-raid enforcement. The application does not
 * currently contain an implemented anti-raid gate, but the AI-generated security
 * specification described blacklist/403 behavior. To prevent accidental account
 * lockouts during rollout, this middleware is intentionally a no-op.
 *
 * If a real anti-raid guard is later implemented, it should be placed behind an
 * explicit enable flag instead of hardcoded into the app startup path.
 */
export function antiRaidGuard(): RequestHandler {
  return (_req, _res, next) => {
    next();
  };
}
