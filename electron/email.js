import { randomBytes } from "node:crypto";
import { domainToASCII } from "node:url";
import { GitHubError, githubRequest } from "./github.js";

// Email reports, the desktop half. Reports are sent by Issue Scout's relay through the operator's Resend
// account; the user's runs ask for delivery with GitHub's workflow identity, so no mail credential exists here.
//   profile.json            `email` and `email_enabled`, the engine's switch: an address alone never sends
//   SCOUT_EMAIL_RELAY_URL   repository variable, set for email and removed when it's turned off
//   email.yml               the user's workflow that emails a confirmation code or a saved report again
// The relay only emails an address confirmed with a code; this app sends it the code, never the GitHub token.
const VARIABLE = "SCOUT_EMAIL_RELAY_URL";
const UPDATE_NEEDED = "Your Scout repository was created before email reports existed. Create a new Scout repository from the latest template to use email.";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Same rules as validate_email in the template's email_delivery.py, so the engine accepts what the app saves.
export function validEmail(value) {
  if (typeof value !== "string" || value.length > 254 || value !== value.trim() || value.split("@").length !== 2) return "";
  const [local, host] = value.split("@");
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return "";
  const domain = domainToASCII(host).toLowerCase();
  const labels = domain.split(".");
  if (!domain || local.length + domain.length + 1 > 254 || labels.length < 2
      || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return "";
  return `${local}@${domain}`;
}

// The relay's base URL from the build's configuration; anything but plain HTTPS leaves email unavailable.
export function relayBase(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? url.href.replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

export function createEmailRoutes({ repositoryContext, profile, relayUrl, store, fetchImpl, newHandle = () => randomBytes(32).toString("hex") }) {
  const relay = relayBase(relayUrl ?? "");
  const request = (context, route, options = {}) => githubRequest(context.token, `/repos/${context.repo.full_name}${route}`, { ...options, fetchImpl });
  const unavailable = () => new GitHubError(404, "Email reports aren't available in this build of Issue Scout.");

  // Repositories created before email existed have no email.yml, and their engine rejects `email_enabled`.
  async function ready(context) {
    try {
      await request(context, `/contents/.github/workflows/email.yml?ref=${encodeURIComponent(context.repo.default_branch)}`);
      return true;
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  }
  async function setVariable(context) {
    context.assertCurrent();
    try {
      await request(context, `/actions/variables/${VARIABLE}`, { method: "PATCH", body: { name: VARIABLE, value: relay } });
    } catch (error) {
      if (error.status !== 404) throw error;
      await request(context, "/actions/variables", { method: "POST", body: { name: VARIABLE, value: relay } });
    }
  }
  async function removeVariable(context) {
    context.assertCurrent();
    try {
      await request(context, `/actions/variables/${VARIABLE}`, { method: "DELETE" });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  function view(context, { raw, revision }, isReady) {
    const email = typeof raw.email === "string" ? raw.email : "";
    const saved = store.get(context.repo.id);
    const current = Boolean(email) && saved?.email === email;
    return {
      available: true, ready: isReady, revision, email, enabled: raw.email_enabled === true,
      confirmed: current && saved.confirmed, code_sent: current && !saved.confirmed && Boolean(saved.handle),
    };
  }

  return {
    "GET /api/email": async () => {
      if (!relay) return [200, { available: false }];
      const context = await repositoryContext();
      const [fields, isReady] = await Promise.all([profile.readFields(context), ready(context)]);
      return [200, view(context, fields, isReady)];
    },

    "PUT /api/email": async (body) => {
      if (!relay) throw unavailable();
      if (!object(body) || typeof body.revision !== "string" || typeof body.enabled !== "boolean" || typeof body.email !== "string")
        throw new GitHubError(422, "Reload your email settings and try again.");
      const email = body.email.trim() ? validEmail(body.email.trim()) : "";
      if (body.email.trim() && !email) throw new GitHubError(422, "Check the highlighted field.", { email: "Enter one email address, such as you@example.com." });
      if (body.enabled && !email) throw new GitHubError(422, "Check the highlighted field.", { email: "Enter the address to email your reports to." });
      const context = await repositoryContext();
      if (!(await ready(context))) throw new GitHubError(409, UPDATE_NEEDED);
      const saved = store.get(context.repo.id);
      if (body.enabled && !(saved?.confirmed && saved.email === email))
        throw new GitHubError(409, "Confirm this address with the code Issue Scout emails you before turning email reports on.");
      // On: the relay address first, so the switch never points at nothing. Off: the switch first, so nothing
      // sends, then the address, so even an engine that ignores the switch has nowhere to send.
      if (body.enabled) await setVariable(context);
      const fields = await profile.updateFields(context, body.revision, { email, email_enabled: body.enabled },
        (previous) => body.enabled ? "Issue Scout: turn on email reports"
          : previous.email_enabled ? "Issue Scout: turn off email reports" : "Issue Scout: save email address");
      if (!body.enabled) await removeVariable(context);
      if (saved?.email !== email) store.set(context.repo.id, { email, confirmed: false });
      return [200, view(context, fields, true)];
    },

    // Starts the user's email workflow, which asks the relay to email a code to the saved address.
    "POST /api/email/verify": async () => {
      if (!relay) throw unavailable();
      const context = await repositoryContext();
      const fields = await profile.readFields(context);
      const email = validEmail(fields.raw.email ?? "");
      if (!email) throw new GitHubError(409, "Save your email address first.");
      if (!(await ready(context))) throw new GitHubError(409, UPDATE_NEEDED);
      await setVariable(context); // the email workflow needs it; with email off, the engine still sends nothing
      const handle = newHandle();
      const saved = store.get(context.repo.id);
      store.set(context.repo.id, { email, confirmed: saved?.email === email && saved.confirmed, handle });
      context.assertCurrent();
      await request(context, "/actions/workflows/email.yml/dispatches", {
        method: "POST", body: { ref: context.repo.default_branch, inputs: { task: "verify", handle } },
      });
      return [202, view(context, fields, true)];
    },

    "POST /api/email/confirm": async (body) => {
      if (!relay) throw unavailable();
      const code = typeof body?.code === "string" ? body.code.replace(/\s+/g, "") : "";
      if (!/^\d{6}$/.test(code)) throw new GitHubError(422, "Check the highlighted field.", { code: "Enter the 6-digit code from the email." });
      const context = await repositoryContext();
      const saved = store.get(context.repo.id);
      if (!saved?.handle) throw new GitHubError(409, "Ask for a confirmation code first.");
      let response, data;
      try {
        // Only the request ID and the code go to the relay.
        response = await fetchImpl(`${relay}/confirm`, {
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: saved.handle, code }),
        });
        data = await response.json().catch(() => ({}));
      } catch {
        throw new GitHubError(503, "Issue Scout's email service didn't answer. Try again in a minute.");
      }
      context.assertCurrent();
      if (response.status === 200 && data?.status === "confirmed") {
        if (data.email !== saved.email) throw new GitHubError(409, "That code confirmed a different address. Ask for a new code.");
        store.set(context.repo.id, { email: saved.email, confirmed: true });
        return [200, view(context, await profile.readFields(context), true)];
      }
      const reason = data?.reason;
      if (reason === "wrong_code") {
        const left = Number.isSafeInteger(data.attempts_left) ? data.attempts_left : 0;
        throw new GitHubError(422, "That code isn't right.", { code: left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Ask for a new one." });
      }
      throw new GitHubError(409, {
        not_found: "No code has been sent for this request yet. Wait a minute for the email, or ask for a new code.",
        expired: "That code has expired. Ask for a new one.",
        too_many_attempts: "Too many wrong codes. Ask for a new one.",
      }[reason] ?? "Issue Scout's email service couldn't check the code. Try again in a minute.");
    },
  };
}
