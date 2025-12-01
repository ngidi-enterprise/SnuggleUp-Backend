// Simple in-memory runtime configuration for feature flags
// Note: This resets on server restart. Persist to DB later if needed.

const runtimeConfig = {
  shippingFallbackEnabled: false,
};

export function isShippingFallbackEnabled() {
  return !!runtimeConfig.shippingFallbackEnabled;
}

export function setShippingFallbackEnabled(enabled) {
  runtimeConfig.shippingFallbackEnabled = !!enabled;
  return runtimeConfig.shippingFallbackEnabled;
}

export function getRuntimeConfig() {
  return { ...runtimeConfig };
}

export default {
  isShippingFallbackEnabled,
  setShippingFallbackEnabled,
  getRuntimeConfig,
};
