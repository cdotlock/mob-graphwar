export const LOCAL_PROVIDER_KEY = "mob-graphwar-local-provider-v2";

const DEFAULT_CONFIG = {
  provider: "openrouter",
  model: "openrouter/free",
  apiKey: "",
  standingOrder: "",
  autoRounds: 1
};

export function loadLocalProviderConfig(storage = window.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(LOCAL_PROVIDER_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };
    return {
      ...DEFAULT_CONFIG,
      provider: String(parsed.provider || DEFAULT_CONFIG.provider),
      model: String(parsed.model || DEFAULT_CONFIG.model),
      apiKey: String(parsed.apiKey || ""),
      standingOrder: String(parsed.standingOrder || ""),
      autoRounds: Math.max(1, Math.min(25, Number(parsed.autoRounds) || 1))
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveLocalProviderConfig(storage = window.localStorage, config) {
  const next = {
    provider: String(config?.provider || DEFAULT_CONFIG.provider),
    model: String(config?.model || DEFAULT_CONFIG.model),
    apiKey: String(config?.apiKey || ""),
    standingOrder: String(config?.standingOrder || ""),
    autoRounds: Math.max(1, Math.min(25, Number(config?.autoRounds) || 1))
  };
  storage.setItem(LOCAL_PROVIDER_KEY, JSON.stringify(next));
  return next;
}

export function clearLocalProviderKey(storage = window.localStorage) {
  const current = loadLocalProviderConfig(storage);
  return saveLocalProviderConfig(storage, { ...current, apiKey: "" });
}

export function providerMetadataPayload(config) {
  const provider = String(config?.provider || DEFAULT_CONFIG.provider);
  return {
    providers: {
      [provider]: { model: String(config?.model || DEFAULT_CONFIG.model) }
    }
  };
}

export function ephemeralProviderConfig(config) {
  return {
    provider: String(config?.provider || DEFAULT_CONFIG.provider),
    model: String(config?.model || DEFAULT_CONFIG.model),
    apiKey: String(config?.apiKey || "")
  };
}
