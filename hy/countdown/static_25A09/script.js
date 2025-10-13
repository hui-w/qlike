/**
 * Example URL formats supported:
 * ---------------------------------------
 * ISO 8601 style:
 *   ?t=2025-12-21T17:20:00Z
 *   ?t=2025-12-21T17:20:00+09:00   ← works fine (no %2B needed)
 *   ?t=2025-12-21T17:20:00-0500
 *
 * Legacy compact style:
 *   ?t=20251221172000Z
 *   ?t=20251221172000+0900
 *   ?t=20251221172000
 */

function getQueryParam(name) {
  // Manual extraction — preserves "+" literally
  const query = window.location.search.substring(1);
  const regex = new RegExp("(^|&)" + name + "=([^&]*)(&|$)");
  const match = query.match(regex);
  return match ? decodeURIComponent(match[2].replace(/\+/g, "+")) : null;
}

/**
 * Parse target time from query string.
 * Supports ISO 8601 and legacy compact formats.
 */
function parseTargetTime(targetStr) {
  if (!targetStr) return Math.floor(Date.now() / 1000);

  // Clean up whitespace and ensure "+" not lost
  targetStr = targetStr.trim();

  // Normalize timezone: "+09:00" → "+0900"
  const isoNormalized = targetStr.replace(/([+-]\d{2}):(\d{2})$/, "$1$2");

  // ---------- ISO 8601 format ----------
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{4}|Z)?$/.test(isoNormalized)
  ) {
    const date = new Date(isoNormalized);
    if (!isNaN(date)) {
      return Math.floor(date.getTime() / 1000);
    }
  }

  // ---------- Legacy compact format ----------
  const tzMatch = targetStr.match(/([+-]\d{4}|Z)$/);
  let tzOffsetMinutes = 0;
  let coreStr = targetStr;

  if (tzMatch) {
    const tz = tzMatch[1];
    coreStr = targetStr.replace(tz, "");

    if (tz === "Z") {
      tzOffsetMinutes = 0;
    } else {
      const sign = tz.startsWith("-") ? -1 : 1;
      const hours = parseInt(tz.slice(1, 3), 10);
      const minutes = parseInt(tz.slice(3, 5), 10);
      tzOffsetMinutes = sign * (hours * 60 + minutes);
    }
  }

  const padded = coreStr.padEnd(14, "0");
  const year = Number(padded.slice(0, 4));
  const month = Number(padded.slice(4, 6)) - 1;
  const day = Number(padded.slice(6, 8));
  const hour = Number(padded.slice(8, 10));
  const minute = Number(padded.slice(10, 12));
  const second = Number(padded.slice(12, 14));

  const utcTimestamp = Date.UTC(year, month, day, hour, minute, second);
  const correctedTimestamp = utcTimestamp - tzOffsetMinutes * 60 * 1000;

  return Math.floor(correctedTimestamp / 1000);
}

function formatDateFriendly(date) {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function switchTheme() {
  const body = document.body;
  body.classList.toggle("light-theme");
  body.querySelector("#flipdown").classList.toggle("flipdown__theme-dark");
  body.querySelector("#flipdown").classList.toggle("flipdown__theme-light");
}

document.addEventListener("DOMContentLoaded", () => {
  const targetParam = getQueryParam("t");

  let targetInSeconds;
  if (targetParam) {
    targetInSeconds = parseTargetTime(targetParam);
  } else {
    targetInSeconds = Math.floor(Date.now() / 1000) + 10;
  }

  const flipdown = new FlipDown(targetInSeconds).start().ifEnded(() => {
    console.log("The countdown has ended!");
    document.getElementById("targetDateTime").textContent =
      "Elapsed time since " + formatDateFriendly(targetDate);
  });

  const targetDate = new Date(targetInSeconds * 1000);

  if (targetInSeconds - flipdown._getTime() > 0) {
    document.getElementById("targetDateTime").textContent =
      "Counting down to " + formatDateFriendly(targetDate);
  } else {
    document.getElementById("targetDateTime").textContent =
      "Elapsed time since " + formatDateFriendly(targetDate);
  }
});
