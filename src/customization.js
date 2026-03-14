const AGENT_CUSTOMIZATION_KEY = 'cyberTrinityAgentCustomization';

export const ARMOR_COLOR_VARIANTS = [
  { id: 'mk01', label: 'MK-01 // BASE', shadow: 0.00, highlight: 0.00 },
  { id: 'mk02', label: 'MK-02 // SHADE', shadow: 0.14, highlight: 0.00 },
  { id: 'mk03', label: 'MK-03 // STEEL', shadow: 0.08, highlight: 0.05 },
  { id: 'mk04', label: 'MK-04 // BRIGHT', shadow: 0.00, highlight: 0.12 },
  { id: 'mk05', label: 'MK-05 // SHADOW', shadow: 0.20, highlight: 0.04 },
  { id: 'mk06', label: 'MK-06 // GLOW', shadow: 0.02, highlight: 0.18 },
  { id: 'mk07', label: 'MK-07 // TITAN', shadow: 0.12, highlight: 0.10 },
  { id: 'mk08', label: 'MK-08 // NIGHT', shadow: 0.24, highlight: 0.02 },
  { id: 'mk09', label: 'MK-09 // ION', shadow: 0.05, highlight: 0.22 },
  { id: 'mk10', label: 'MK-10 // PRIME', shadow: 0.10, highlight: 0.16 },
];

export const EFFECT_COLOR_VARIANTS = [
  { id: 'neon', label: 'NEON', color: '#7df2ff' },
  { id: 'ice', label: 'ICE', color: '#bfe8ff' },
  { id: 'gold', label: 'GOLD', color: '#ffd36b' },
  { id: 'plasma', label: 'PLASMA', color: '#ff7af6' },
];

export const TRAIL_EFFECT_VARIANTS = [
  { id: 'sparks', label: 'SPARKS' },
  { id: 'data', label: 'DATA' },
  { id: 'hologram', label: 'HOLOGRAM' },
];

export const DEATH_EFFECT_VARIANTS = [
  { id: 'burst', label: 'BURST' },
  { id: 'nova', label: 'NOVA' },
  { id: 'shatter', label: 'SHATTER' },
  { id: 'pulse', label: 'PULSE' },
];

export const DEFAULT_AGENT_CUSTOMIZATION = {
  armorColor: ARMOR_COLOR_VARIANTS[0].id,
  effectColor: EFFECT_COLOR_VARIANTS[0].id,
  trailEffect: TRAIL_EFFECT_VARIANTS[0].id,
  deathEffect: DEATH_EFFECT_VARIANTS[0].id,
};

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const channelToHex = value => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

function mixHex(a, b, amount) {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  return rgbToHex({
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  });
}

function isValidOption(options, value) {
  return options.some(option => option.id === value);
}

export function sanitizeAgentCustomization(value = {}) {
  return {
    armorColor: isValidOption(ARMOR_COLOR_VARIANTS, value.armorColor)
      ? value.armorColor
      : DEFAULT_AGENT_CUSTOMIZATION.armorColor,
    effectColor: isValidOption(EFFECT_COLOR_VARIANTS, value.effectColor)
      ? value.effectColor
      : DEFAULT_AGENT_CUSTOMIZATION.effectColor,
    trailEffect: isValidOption(TRAIL_EFFECT_VARIANTS, value.trailEffect)
      ? value.trailEffect
      : DEFAULT_AGENT_CUSTOMIZATION.trailEffect,
    deathEffect: isValidOption(DEATH_EFFECT_VARIANTS, value.deathEffect)
      ? value.deathEffect
      : DEFAULT_AGENT_CUSTOMIZATION.deathEffect,
  };
}

export function loadAgentCustomization() {
  try {
    const raw = localStorage.getItem(AGENT_CUSTOMIZATION_KEY);
    return sanitizeAgentCustomization(raw ? JSON.parse(raw) : DEFAULT_AGENT_CUSTOMIZATION);
  } catch {
    return { ...DEFAULT_AGENT_CUSTOMIZATION };
  }
}

export function saveAgentCustomization(customization) {
  const sanitized = sanitizeAgentCustomization(customization);
  try {
    localStorage.setItem(AGENT_CUSTOMIZATION_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage failures and keep the current session usable.
  }
  return sanitized;
}

export function resolveArmorColor(baseColor, variantId) {
  const variant = ARMOR_COLOR_VARIANTS.find(option => option.id === variantId) ?? ARMOR_COLOR_VARIANTS[0];
  const shaded = mixHex(baseColor, '#050812', variant.shadow);
  return mixHex(shaded, '#f6fbff', variant.highlight);
}

export function resolveEffectColor(variantId) {
  return (
    EFFECT_COLOR_VARIANTS.find(option => option.id === variantId)?.color
    ?? EFFECT_COLOR_VARIANTS[0].color
  );
}

export function fillSelectOptions(select, options) {
  if (!select) return;
  select.innerHTML = options.map(option => `<option value="${option.id}">${option.label}</option>`).join('');
}
