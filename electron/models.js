import sodium from "libsodium-wrappers";
import { GitHubError, githubRequest } from "./github.js";

// Mirrors the template's provider_config.py. Keys are saved under the template README's secret names,
// so app setup and manual setup are interchangeable, and two stages on one provider share one key.
// Subscription login is consumed only by the official CLI; Codex subscriptions can't run on
// GitHub-hosted runners, so Codex is offered with an API key only.
export const PROVIDERS = [
  // Picking only: the engine's fix-drafting agent loop is rejected by Groq (HTTP 400 on the first turn).
  { id: "groq", label: "Groq", stages: ["picker"], credentials: { "api-key": "GROQ_API_KEY" }, model: "optional", model_hint: "openai/gpt-oss-120b" },
  { id: "openai", label: "OpenAI", credentials: { "api-key": "OPENAI_API_KEY" }, model: "required", model_hint: "" },
  { id: "anthropic", label: "Anthropic", credentials: { "api-key": "ANTHROPIC_API_KEY" }, model: "required", model_hint: "" },
  { id: "openai-compatible", label: "OpenAI-compatible endpoint", credentials: { "api-key": "SCOUT_API_KEY" }, api_key_fallback: "OPENAI_API_KEY", model: "required", model_hint: "", base_url: true },
  { id: "claude-code", label: "Claude Code", credentials: { subscription: "CLAUDE_CODE_OAUTH_TOKEN", "api-key": "ANTHROPIC_API_KEY" }, model: "optional", model_hint: "CLI default" },
  { id: "codex", label: "Codex", credentials: { "api-key": "CODEX_API_KEY" }, api_key_fallback: "OPENAI_API_KEY", model: "optional", model_hint: "CLI default" },
];
const BY_ID = Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider]));
const ROLES = { picker: "groq", solver: "claude-code" }; // the engine's defaults
const FIELDS = ["PROVIDER", "AUTH", "MODEL", "BASE_URL"];
const roleKey = (role) => `SCOUT_${role.toUpperCase()}_API_KEY`;
const SECRET_NAMES = new Set([...PROVIDERS.flatMap((provider) => Object.values(provider.credentials)), ...Object.keys(ROLES).map(roleKey)]);
const plain = (value) => typeof value === "string" && !/[\x00-\x1f\x7f]/.test(value);

// Match the engine's precedence: stage override, provider key, then a saved OpenAI fallback.
export function credentialName(role, provider, auth, secrets) {
  if (auth === "api-key" && secrets.has(roleKey(role))) return roleKey(role);
  const config = BY_ID[provider];
  const primary = config.credentials[auth];
  return auth === "api-key" && !secrets.has(primary) && secrets.has(config.api_key_fallback)
    ? config.api_key_fallback : primary;
}

function httpsEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function stageView(role, variables, secrets) {
  const read = (field) => (variables.get(`SCOUT_${role.toUpperCase()}_${field}`) ?? "").trim();
  const provider = BY_ID[read("PROVIDER").toLowerCase()] ? read("PROVIDER").toLowerCase() : ROLES[role];
  const auths = Object.keys(BY_ID[provider].credentials);
  // "auto" (or nothing) behaves like the engine: the first sign-in method that has a saved secret.
  let auth = read("AUTH").toLowerCase();
  if (!auths.includes(auth)) auth = auths.find((option) => secrets.has(credentialName(role, provider, option, secrets))) ?? auths[0];
  return { provider, auth, model: read("MODEL"), base_url: BY_ID[provider].base_url ? read("BASE_URL") : "" };
}

const view = (variables, secrets, setupRequired) => ({
  providers: PROVIDERS,
  // Only names of the secrets this screen manages; secret values are never readable.
  secrets: [...secrets].filter((name) => SECRET_NAMES.has(name)).sort(),
  ...Object.fromEntries(Object.keys(ROLES).map((role) => [role, stageView(role, variables, secrets)])),
  ready: isReady(variables, secrets, setupRequired),
});

function validateStage(role, input, secrets, fields) {
  const at = (field) => `${role}.${field}`;
  const provider = BY_ID[input?.provider];
  if (!provider) {
    fields[at("provider")] = "Choose a provider.";
    return undefined;
  }
  if (provider.stages && !provider.stages.includes(role)) {
    fields[at("provider")] = `${provider.label} can pick issues but can’t draft fixes. Choose another provider for fix drafting.`;
    return undefined;
  }
  if (!provider.credentials[input.auth]) {
    fields[at("auth")] = "Choose how this provider signs in.";
    return undefined;
  }
  const model = plain(input.model ?? "") ? (input.model ?? "").trim() : undefined;
  if (model === undefined || model.length > 200) fields[at("model")] = "Use a model name of up to 200 characters.";
  else if (!model && provider.model === "required") fields[at("model")] = `Enter the ${provider.label} model to use.`;
  const base_url = provider.base_url && plain(input.base_url) ? input.base_url.trim().replace(/\/+$/, "") : "";
  if (provider.base_url && !httpsEndpoint(base_url)) fields[at("base_url")] = "Use an https:// endpoint without a username, password, query or fragment.";
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (key && (key.length > 10000 || /\s/.test(key) || !plain(key))) fields[at("key")] = "Paste the key on one line, without spaces.";
  const credential = credentialName(role, provider.id, input.auth, secrets);
  return { provider: provider.id, auth: input.auth, model: model ?? "", base_url, key, credential };
}

// Runs can start only once profile.json drops `setup_required` and each stage, as saved, would pass a save.
function isReady(variables, secrets, setupRequired) {
  const fields = {};
  const stages = Object.keys(ROLES).map((role) => validateStage(role, { ...stageView(role, variables, secrets), key: "" }, secrets, fields));
  return !setupRequired && !Object.keys(fields).length && stages.every((stage) => stage && secrets.has(stage.credential));
}

export function createModelRoutes({ repositoryContext, finishSetup, readProfile, fetchImpl }) {
  const request = (context, route, options = {}) => githubRequest(context.token, `/repos/${context.repo.full_name}${route}`, { ...options, fetchImpl });

  async function list(context, route, key) {
    const items = [];
    for (let page = 1; page <= 10; page++) {
      const data = await request(context, `${route}?per_page=${key === "secrets" ? 100 : 30}&page=${page}`);
      const batch = Array.isArray(data?.[key]) ? data[key] : [];
      items.push(...batch);
      if (!batch.length || items.length >= (data.total_count ?? 0)) break;
    }
    return items;
  }

  async function load(context) {
    const [variables, secrets] = await Promise.all([
      list(context, "/actions/variables", "variables"),
      list(context, "/actions/secrets", "secrets"),
    ]);
    context.assertCurrent();
    return {
      variables: new Map(variables.filter((item) => typeof item?.name === "string" && typeof item.value === "string").map((item) => [item.name, item.value])),
      secrets: new Set(secrets.filter((item) => typeof item?.name === "string").map((item) => item.name)),
    };
  }

  // GitHub only accepts secrets encrypted to the repository's public key (libsodium sealed box).
  async function saveSecrets(context, keys) {
    const publicKey = await request(context, "/actions/secrets/public-key");
    if (typeof publicKey?.key !== "string" || typeof publicKey?.key_id !== "string") throw new GitHubError(502, "GitHub returned an incomplete repository key. Please try again.");
    await sodium.ready;
    const recipient = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
    for (const [name, value] of keys) {
      const encrypted_value = sodium.to_base64(sodium.crypto_box_seal(sodium.from_string(value), recipient), sodium.base64_variants.ORIGINAL);
      context.assertCurrent();
      await request(context, `/actions/secrets/${name}`, { method: "PUT", body: { encrypted_value, key_id: publicKey.key_id } });
    }
  }

  return {
    "GET /api/models": async () => {
      const context = await repositoryContext();
      // An unreadable profile.json can't prove setup is done, but must not hide the model editor.
      const [{ variables, secrets }, setupRequired] = await Promise.all([
        load(context),
        readProfile(context).then((raw) => Boolean(raw.setup_required), () => true),
      ]);
      return [200, view(variables, secrets, setupRequired)];
    },
    "PUT /api/models": async (body) => {
      const context = await repositoryContext();
      const { variables, secrets } = await load(context);
      const fields = {};
      const stages = Object.fromEntries(Object.keys(ROLES).map((role) => [role, validateStage(role, body?.[role], secrets, fields)]));
      const { picker, solver } = stages;
      if (picker?.key && solver?.key && picker.credential === solver.credential && picker.key !== solver.key)
        fields["solver.key"] = `Both stages use ${solver.credential}. Enter the key once, or the same key in both.`;
      const keys = new Map(Object.values(stages).filter((stage) => stage?.key).map((stage) => [stage.credential, stage.key]));
      // A key submitted for either stage can satisfy both; check after collecting all submitted keys.
      const available = new Set([...secrets, ...keys.keys()]);
      for (const [role, stage] of Object.entries(stages)) {
        if (!stage || stage.key) continue;
        stage.credential = credentialName(role, stage.provider, stage.auth, available);
        if (!available.has(stage.credential))
          fields[`${role}.key`] = stage.auth === "subscription"
            ? "Paste your Claude Code OAuth token (run `claude setup-token` to create one)."
            : `Enter your ${BY_ID[stage.provider].label} API key.`;
      }
      if (Object.keys(fields).length) throw new GitHubError(422, "Check the highlighted model settings.", fields);

      // Keys first, so a stage never switches to a provider whose key failed to save.
      if (keys.size) await saveSecrets(context, keys);
      for (const name of keys.keys()) secrets.add(name);

      for (const [role, stage] of Object.entries(stages)) {
        const wanted = { PROVIDER: stage.provider, AUTH: stage.auth, MODEL: stage.model, BASE_URL: stage.base_url };
        for (const field of FIELDS) {
          const name = `SCOUT_${role.toUpperCase()}_${field}`;
          const value = wanted[field];
          if ((variables.get(name) ?? "") === value) continue;
          context.assertCurrent();
          // An empty value removes the variable, so the engine's default applies.
          if (!value) await request(context, `/actions/variables/${name}`, { method: "DELETE" });
          else if (variables.has(name)) await request(context, `/actions/variables/${name}`, { method: "PATCH", body: { name, value } });
          else await request(context, "/actions/variables", { method: "POST", body: { name, value } });
          if (value) variables.set(name, value);
          else variables.delete(name);
        }
      }
      // Both stages now have a model and a saved credential, so the scout is ready to run.
      await finishSetup(context);
      return [200, view(variables, secrets, false)];
    },
  };
}
