---
name: Discord moderation access
description: Why the moderation bot uses a project secret in addition to the connected Discord account.
---

Privileged Discord work must use the bot application token stored as a project secret. The connected Discord OAuth connection is useful for account-level identity and guild discovery, but it does not grant the bot permissions needed to read ticket messages, post case logs, manage roles, or send moderation DMs.

**Why:** Discord separates user OAuth scopes from bot authentication; attempting channel or role operations through the user connection returns an authorization failure even when the connection is healthy.

**How to apply:** Keep the bot token in Replit Secrets and route privileged actions through the Discord bot worker. Never place the token in source code or chat.