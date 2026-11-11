// Public OAuth app ID bundled with every copy. Device Flow needs no client secret.
// OAuth App "Issue Scout Electron", owned by atty57.
export const GITHUB_CLIENT_ID = "Ov23likNEuXbSg4uZwIX";

// Base HTTPS URL of the deployed email relay (the template's email_relay.py, Fly app atty57-issue-scout-relay).
// It must equal the relay's SCOUT_EMAIL_RELAY_URL, the audience of the workflows' GitHub identity tokens.
// Public: it holds no credential. Empty keeps email reports hidden. ISSUE_SCOUT_EMAIL_RELAY_URL overrides it.
export const EMAIL_RELAY_URL = "https://relay.scouts.email";
