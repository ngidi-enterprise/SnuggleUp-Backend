export const normalizeClientOccurredAt = (value, nowMs = Date.now()) => {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) return null;
  const maximumClockDifference = 24 * 60 * 60 * 1000;
  if (Math.abs(parsed.getTime() - nowMs) > maximumClockDifference) return null;
  return parsed.toISOString();
};

export const normalizeEventSequence = (value) => {
  const sequence = Number.parseInt(value, 10);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
};

