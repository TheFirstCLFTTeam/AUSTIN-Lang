// Shared time format preference helpers.
// Stored in localStorage so both the profile page (where it's configured) and
// the files page (where it's consumed) can read the same value.

export const TIME_FORMAT_KEY = "timeFormatPref";
export const TIME_FORMAT_EVENT = "timeFormatPref:change";
export const TIME_FORMAT_OPTIONS = ["12h", "24h"];
export const DEFAULT_TIME_FORMAT = "12h";

export function getTimeFormat() {
  if (typeof window === "undefined") return DEFAULT_TIME_FORMAT;
  const stored = window.localStorage.getItem(TIME_FORMAT_KEY);
  return TIME_FORMAT_OPTIONS.includes(stored) ? stored : DEFAULT_TIME_FORMAT;
}

export function setTimeFormat(value) {
  if (typeof window === "undefined") return;
  if (!TIME_FORMAT_OPTIONS.includes(value)) return;
  window.localStorage.setItem(TIME_FORMAT_KEY, value);
  // Notify same-tab listeners (the native 'storage' event only fires cross-tab).
  window.dispatchEvent(new CustomEvent(TIME_FORMAT_EVENT, { detail: value }));
}

export function formatDateTime(dateStr, timeFormat = DEFAULT_TIME_FORMAT) {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "\u2014";

  const datePart = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const timePart = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  });

  return `${datePart}, ${timePart}`;
}
