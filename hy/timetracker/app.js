const app = document.getElementById("app");
if (!app) {
  throw new Error("Time tracker: missing #app container.");
}

/**
 * Single-file SPA: entries in `localStorage`, optional PNG export via vendor/html2canvas.
 * Flow: small config → model/helpers → DOM shell → dialog → list/render → `bindUi()` boot.
 */

const TIME_ENTRIES_STORAGE_KEY = "time_entries";
const LEGACY_TIME_ENTRIES_STORAGE_KEY = "timetracker_entries";
const NEW_LABEL_BASE = "New Label";

const DIALOG_TITLE_ADD = "Add time entry";
const DIALOG_TITLE_EDIT = "Edit time entry";

const STORAGE_HINT_TEXT =
  "All data is stored only in this browser's local storage. It stays after you refresh and is not synced across browsers or other devices.";

/** Clicks inside these nodes do not clear the selected entry. */
const SELECTION_PRESERVE_SELECTORS = [
  ".time-entry",
  "dialog[open]",
  ".time-entry-footer",
  ".app-header",
];

/** html2canvas options shared by export (mobile/desktop). */
const HTML2CANVAS_SNAPSHOT = {
  scale: 2,
  backgroundColor: "#ffffff",
  logging: false,
  useCORS: true,
};

const CLASS_ROW_ACTIONS = "time-entry-row-actions";

/** Shown for the first entry when nothing is selected (same for line + tooltip). */
const RELATION_FIRST_LINE = Object.freeze({
  line: "This is the start",
  title: "This is the start",
});

/**
 * @param {Element} el
 */
function clickPreservesEntrySelection(el) {
  return SELECTION_PRESERVE_SELECTORS.some((sel) => el.closest(sel));
}

/**
 * @param {unknown} e
 */
function isAbortError(e) {
  return Boolean(e && typeof e === "object" && "name" in e && e.name === "AbortError");
}

/** @typedef {{ timestamp: number; label: string }} TimeEntry */

/**
 * @param {unknown} value
 * @returns {value is TimeEntry}
 */
function isValidTimeEntry(value) {
  if (typeof value !== "object" || value === null) return false;
  const o = /** @type {{ timestamp?: unknown; label?: unknown }} */ (value);
  return (
    typeof o.timestamp === "number" &&
    Number.isFinite(o.timestamp) &&
    typeof o.label === "string"
  );
}

function loadTimeEntries() {
  try {
    const fromNew = localStorage.getItem(TIME_ENTRIES_STORAGE_KEY);
    if (fromNew) {
      const data = JSON.parse(fromNew);
      if (!Array.isArray(data) || !data.every(isValidTimeEntry)) return null;
      return data;
    }
    const fromLegacy = localStorage.getItem(LEGACY_TIME_ENTRIES_STORAGE_KEY);
    if (!fromLegacy) return null;
    const data = JSON.parse(fromLegacy);
    if (!Array.isArray(data) || !data.every(isValidTimeEntry)) return null;
    saveTimeEntries(data);
    localStorage.removeItem(LEGACY_TIME_ENTRIES_STORAGE_KEY);
    return data;
  } catch {
    return null;
  }
}

/**
 * @param {TimeEntry[]} entries
 */
function sortTimeEntriesChronologically(entries) {
  entries.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

/**
 * @param {TimeEntry[]} entries
 */
function saveTimeEntries(entries) {
  sortTimeEntriesChronologically(entries);
  try {
    localStorage.setItem(TIME_ENTRIES_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota or private mode */
  }
}

const timeEntries = loadTimeEntries() ?? [];
sortTimeEntriesChronologically(timeEntries);

/**
 * @param {string} base
 * @returns {string}
 */
function nextNonCollidingLabel(base) {
  const used = new Set(timeEntries.map((e) => e.label));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base} (${i})`)) i += 1;
  return `${base} (${i})`;
}

/** @type {TimeEntry | null} */
let selectedTimeEntry = null;

/** @type {TimeEntry | null} */
let editingTimeEntry = null;

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatLocalYmdHms(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatLocalDateInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatLocalTimeInputValue(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/**
 * @param {string} dateStr YYYY-MM-DD from input[type=date]
 * @param {string} timeStr HH:mm or HH:mm:ss from input[type=time]
 * @returns {number | null}
 */
function parseDateAndTimeInputs(dateStr, timeStr) {
  const d = dateStr.trim();
  let t = timeStr.trim();
  if (!d || !t) return null;
  if (/^\d{2}:\d{2}$/.test(t)) t = `${t}:00`;
  return parseLocalYmdHms(`${d} ${t}`);
}

/**
 * @param {string} str
 * @returns {number | null} epoch ms in local time, or null if invalid
 */
function parseLocalYmdHms(str) {
  const m = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  if (![y, mo, d, h, mi, s].every((n) => Number.isFinite(n))) return null;
  const date = new Date(y, mo - 1, d, h, mi, s);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi ||
    date.getSeconds() !== s
  ) {
    return null;
  }
  return date.getTime();
}

/**
 * @param {number} n
 * @param {string} one
 * @param {string} many
 */
function pluralUnit(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * @param {number} entryMs
 * @param {number} anchorMs
 * @param {"selection" | "previous"} mode
 * @returns {{ line: string; title: string }}
 */
function versusAnchorDeltaDisplay(entryMs, anchorMs, mode) {
  const diffSec = Math.round((entryMs - anchorMs) / 1000);
  if (diffSec === 0) {
    const line =
      mode === "selection" ? "Same time as selection" : "Same time as previous";
    return { line, title: line };
  }
  const after = diffSec > 0;
  let abs = Math.abs(diffSec);
  const days = Math.floor(abs / 86400);
  abs %= 86400;
  const hours = Math.floor(abs / 3600);
  abs %= 3600;
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;

  const fullParts = [];
  if (days) fullParts.push(pluralUnit(days, "day", "days"));
  if (hours) fullParts.push(pluralUnit(hours, "hour", "hours"));
  if (minutes) fullParts.push(pluralUnit(minutes, "minute", "minutes"));
  if (seconds || fullParts.length === 0) {
    fullParts.push(pluralUnit(seconds, "second", "seconds"));
  }

  const shortParts = [];
  if (days) shortParts.push(`${days}d`);
  if (hours) shortParts.push(`${hours}h`);
  if (minutes) shortParts.push(`${minutes}m`);
  if (seconds || shortParts.length === 0) shortParts.push(`${seconds}s`);

  const suffix =
    mode === "selection"
      ? after
        ? "after selection"
        : "before selection"
      : after
        ? "after previous"
        : "before previous";

  return {
    line: `${shortParts.join(" ")} ${suffix}`,
    title: `${fullParts.join(" ")} ${suffix}`,
  };
}

/**
 * @param {TimeEntry} entry
 * @param {TimeEntry | null} selected
 * @param {TimeEntry | null} previousEntry chronologically earlier neighbor, or null if `entry` is first
 * @returns {{ line: string; title: string }}
 */
function relationDisplayForEntry(entry, selected, previousEntry) {
  if (selected !== null && entry !== selected) {
    return versusAnchorDeltaDisplay(entry.timestamp, selected.timestamp, "selection");
  }
  if (selected === null) {
    if (previousEntry === null) {
      return RELATION_FIRST_LINE;
    }
    return versusAnchorDeltaDisplay(
      entry.timestamp,
      previousEntry.timestamp,
      "previous",
    );
  }
  return { line: "", title: "" };
}

/**
 * @param {number} timestamp
 * @param {string} label
 * @returns {string}
 */
function formatEntrySummary(timestamp, label) {
  return `${formatLocalYmdHms(new Date(timestamp))} — ${label}`;
}

/**
 * @returns {string}
 */
function exportSnapshotFilename() {
  const d = new Date();
  return `time-tracker-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}.png`;
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
async function savePngBlob(blob, filename) {
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (isAbortError(e)) return;
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// --- DOM: list & shell ---

const timeEntryListEl = document.createElement("ul");
timeEntryListEl.className = "time-entry-list";
timeEntryListEl.setAttribute("role", "listbox");
timeEntryListEl.setAttribute("aria-multiselectable", "false");
timeEntryListEl.setAttribute("aria-label", "Time entries");

const emptyStateEl = document.createElement("div");
emptyStateEl.className = "time-entry-empty-state";
emptyStateEl.setAttribute("role", "status");
const emptyStateTitle = document.createElement("p");
emptyStateTitle.className = "time-entry-empty-title";
emptyStateTitle.textContent = "No time entries yet";
const emptyStateHint = document.createElement("p");
emptyStateHint.className = "time-entry-empty-hint";
emptyStateHint.textContent = "Use Add entry below to create your first one.";
emptyStateEl.append(emptyStateTitle, emptyStateHint);

const listRegion = document.createElement("div");
listRegion.className = "time-entry-list-region";
listRegion.append(emptyStateEl, timeEntryListEl);

const footer = document.createElement("div");
footer.className = "time-entry-footer";
const footerActions = document.createElement("div");
footerActions.className = "time-entry-footer-actions";
const addTimeEntryBtn = document.createElement("button");
addTimeEntryBtn.type = "button";
addTimeEntryBtn.className = "btn-add-time-entry";
addTimeEntryBtn.textContent = "Add entry";
const exportImageBtn = document.createElement("button");
exportImageBtn.type = "button";
exportImageBtn.className = "btn-export-image";
exportImageBtn.textContent = "Save image";
exportImageBtn.setAttribute(
  "aria-label",
  "Save a long image of this time tracker to your device",
);
const clearAllTimeEntriesBtn = document.createElement("button");
clearAllTimeEntriesBtn.type = "button";
clearAllTimeEntriesBtn.className = "btn-clear-all-time-entries";
clearAllTimeEntriesBtn.textContent = "Clear all";
footerActions.append(addTimeEntryBtn, exportImageBtn, clearAllTimeEntriesBtn);
const storageHintEl = document.createElement("p");
storageHintEl.className = "app-storage-disclaimer";
storageHintEl.setAttribute("role", "note");
storageHintEl.textContent = STORAGE_HINT_TEXT;
footer.append(footerActions, storageHintEl);

const appHeader = document.createElement("header");
appHeader.className = "app-header";
const appTitle = document.createElement("p");
appTitle.className = "app-title";
appTitle.textContent = "Time tracker";
appHeader.append(appTitle);

const shell = document.createElement("div");
shell.className = "app-shell";
shell.append(appHeader, listRegion, footer);
app.append(shell);

const addTimeEntryDialog = document.createElement("dialog");
addTimeEntryDialog.className = "add-time-entry-dialog";
addTimeEntryDialog.innerHTML = `
  <form class="add-time-entry-form">
    <h2 class="add-time-entry-title">${DIALOG_TITLE_ADD}</h2>
    <div class="field-row">
      <label class="field">
        <span class="field-label">Date</span>
        <input class="field-input" name="entry-date" type="date" required />
      </label>
      <label class="field">
        <span class="field-label">Time</span>
        <input class="field-input" name="entry-time" type="time" step="1" required />
      </label>
    </div>
    <label class="field">
      <span class="field-label">Label</span>
      <input class="field-input" name="label" type="text" autocomplete="off" />
    </label>
    <div class="time-entry-dialog-actions">
      <button type="button" class="btn btn-cancel">Cancel</button>
      <button type="submit" class="btn btn-save">Save</button>
    </div>
  </form>
`;
app.append(addTimeEntryDialog);

const addTimeEntryForm = addTimeEntryDialog.querySelector(".add-time-entry-form");
const entryDateInput = addTimeEntryDialog.querySelector('input[name="entry-date"]');
const entryTimeInput = addTimeEntryDialog.querySelector('input[name="entry-time"]');
const labelInput = addTimeEntryDialog.querySelector('input[name="label"]');
const cancelBtn = addTimeEntryDialog.querySelector(".btn-cancel");
const dialogTitleEl = addTimeEntryDialog.querySelector(".add-time-entry-title");

if (
  !(addTimeEntryForm instanceof HTMLFormElement) ||
  !(entryDateInput instanceof HTMLInputElement) ||
  !(entryTimeInput instanceof HTMLInputElement) ||
  !(labelInput instanceof HTMLInputElement) ||
  !(cancelBtn instanceof HTMLButtonElement) ||
  !(dialogTitleEl instanceof HTMLElement)
) {
  throw new Error("Time tracker: dialog markup is missing required nodes.");
}

function closeDialogIfOpen() {
  if (addTimeEntryDialog.open) addTimeEntryDialog.close();
}

function clearDialogDateTimeValidity() {
  entryDateInput.setCustomValidity("");
  entryTimeInput.setCustomValidity("");
}

function clearTimeEntrySelection() {
  if (selectedTimeEntry === null) return;
  selectedTimeEntry = null;
  renderTimeEntries();
}

function resetAddTimeEntryForm() {
  const now = new Date();
  entryDateInput.value = formatLocalDateInputValue(now);
  entryTimeInput.value = formatLocalTimeInputValue(now);
  labelInput.value = nextNonCollidingLabel(NEW_LABEL_BASE);
  clearDialogDateTimeValidity();
}

function focusLabelInputInDialog() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      labelInput.focus({ preventScroll: true });
      labelInput.select();
    });
  });
}

/**
 * @param {TimeEntry} timeEntry
 */
function openEditTimeEntryDialog(timeEntry) {
  if (!timeEntries.includes(timeEntry)) return;
  editingTimeEntry = timeEntry;
  dialogTitleEl.textContent = DIALOG_TITLE_EDIT;
  const d = new Date(timeEntry.timestamp);
  entryDateInput.value = formatLocalDateInputValue(d);
  entryTimeInput.value = formatLocalTimeInputValue(d);
  labelInput.value = timeEntry.label;
  clearDialogDateTimeValidity();
  addTimeEntryDialog.showModal();
  focusLabelInputInDialog();
}

function openAddTimeEntryDialog() {
  editingTimeEntry = null;
  dialogTitleEl.textContent = DIALOG_TITLE_ADD;
  resetAddTimeEntryForm();
  addTimeEntryDialog.showModal();
  focusLabelInputInDialog();
}

function submitTimeEntryForm() {
  clearDialogDateTimeValidity();

  const ts = parseDateAndTimeInputs(entryDateInput.value, entryTimeInput.value);
  if (ts === null) {
    entryDateInput.setCustomValidity("Choose a valid date and time");
    entryDateInput.reportValidity();
    return;
  }

  const labelRaw = labelInput.value.trim();
  const label = labelRaw.length > 0 ? labelRaw : nextNonCollidingLabel(NEW_LABEL_BASE);

  if (editingTimeEntry !== null) {
    const target = editingTimeEntry;
    if (!timeEntries.includes(target)) {
      closeDialogIfOpen();
      return;
    }
    target.timestamp = ts;
    target.label = label;
    editingTimeEntry = null;
  } else {
    timeEntries.push({ timestamp: ts, label });
  }

  saveTimeEntries(timeEntries);
  renderTimeEntries();
  closeDialogIfOpen();
}

/**
 * @param {TimeEntry} timeEntry
 * @param {TimeEntry | null} previousEntry
 * @returns {HTMLLIElement}
 */
function createTimeEntryElement(timeEntry, previousEntry) {
  const { timestamp, label } = timeEntry;

  const li = document.createElement("li");
  li.className = "time-entry";
  if (selectedTimeEntry === timeEntry) li.classList.add("time-entry-selected");
  li.setAttribute("role", "option");
  li.setAttribute("aria-selected", selectedTimeEntry === timeEntry ? "true" : "false");
  li.tabIndex = -1;

  li.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest("button")) return;
    if (selectedTimeEntry === timeEntry) {
      clearTimeEntrySelection();
      return;
    }
    selectedTimeEntry = timeEntry;
    renderTimeEntries();
  });

  const content = document.createElement("div");
  content.className = "time-entry-content";

  const rowLabel = document.createElement("div");
  rowLabel.className = "time-entry-row time-entry-row-label";
  const labelEl = document.createElement("span");
  labelEl.className = "time-entry-text-label";
  labelEl.textContent = label;
  rowLabel.append(labelEl);

  const rowMeta = document.createElement("div");
  rowMeta.className = "time-entry-row time-entry-row-meta";

  const metaLeft = document.createElement("div");
  metaLeft.className = "time-entry-meta-left";

  const rowActions = document.createElement("div");
  rowActions.className = CLASS_ROW_ACTIONS;

  const summary = formatEntrySummary(timestamp, label);

  const editTimeEntryBtn = document.createElement("button");
  editTimeEntryBtn.type = "button";
  editTimeEntryBtn.className = "btn-edit-time-entry";
  editTimeEntryBtn.textContent = "Edit";
  editTimeEntryBtn.setAttribute("aria-label", `Edit time entry ${summary}`);
  editTimeEntryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEditTimeEntryDialog(timeEntry);
  });

  const deleteTimeEntryBtn = document.createElement("button");
  deleteTimeEntryBtn.type = "button";
  deleteTimeEntryBtn.className = "btn-delete-time-entry";
  deleteTimeEntryBtn.textContent = "Delete";
  deleteTimeEntryBtn.setAttribute("aria-label", `Delete time entry ${summary}`);
  deleteTimeEntryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!confirm(`Delete this time entry?\n\n${summary}`)) return;
    const idx = timeEntries.indexOf(timeEntry);
    if (idx === -1) return;
    if (selectedTimeEntry === timeEntry) selectedTimeEntry = null;
    if (editingTimeEntry === timeEntry) {
      editingTimeEntry = null;
      closeDialogIfOpen();
    }
    timeEntries.splice(idx, 1);
    saveTimeEntries(timeEntries);
    renderTimeEntries();
  });

  rowActions.append(editTimeEntryBtn, deleteTimeEntryBtn);

  const date = new Date(timestamp);
  const timeEl = document.createElement("time");
  timeEl.className = "time-entry-datetime";
  timeEl.dateTime = date.toISOString();
  timeEl.textContent = formatLocalYmdHms(date);

  const relationEl = document.createElement("span");
  relationEl.className = "time-entry-relation";
  const rel = relationDisplayForEntry(timeEntry, selectedTimeEntry, previousEntry);
  relationEl.textContent = rel.line;
  relationEl.title = rel.title;

  metaLeft.append(timeEl, relationEl);
  rowMeta.append(metaLeft, rowActions);
  content.append(rowLabel, rowMeta);
  li.append(content);
  return li;
}

function renderTimeEntries() {
  sortTimeEntriesChronologically(timeEntries);
  const isEmpty = timeEntries.length === 0;
  emptyStateEl.hidden = !isEmpty;
  timeEntryListEl.hidden = isEmpty;

  timeEntryListEl.replaceChildren();

  if (isEmpty) {
    selectedTimeEntry = null;
    editingTimeEntry = null;
    closeDialogIfOpen();
    return;
  }

  if (selectedTimeEntry !== null && !timeEntries.includes(selectedTimeEntry)) {
    selectedTimeEntry = null;
  }

  const frag = document.createDocumentFragment();
  for (let i = 0; i < timeEntries.length; i++) {
    const previousEntry = i > 0 ? timeEntries[i - 1] : null;
    frag.append(createTimeEntryElement(timeEntries[i], previousEntry));
  }
  timeEntryListEl.append(frag);
}

/**
 * @returns {(el: HTMLElement, opts?: object) => Promise<HTMLCanvasElement> | undefined}
 */
function getHtml2canvas() {
  const w = /** @type {Window & { html2canvas?: (el: HTMLElement, opts?: object) => Promise<HTMLCanvasElement> }} */ (
    window
  );
  const f = w.html2canvas;
  return typeof f === "function" ? f : undefined;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

/**
 * Renders `.app-shell` to a tall PNG; uses Web Share when available (e.g. Save to Photos on iOS).
 */
async function exportShellToPng() {
  const html2canvas = getHtml2canvas();
  if (!html2canvas) {
    alert(
      "Saving as image needs vendor/html2canvas.min.js. If the file is missing, restore it from the project or reinstall the dependency.",
    );
    return;
  }
  exportImageBtn.disabled = true;
  try {
    const canvas = await html2canvas(shell, {
      ...HTML2CANVAS_SNAPSHOT,
      ignoreElements: (el) => el === footer || el.classList.contains(CLASS_ROW_ACTIONS),
    });
    const blob = await canvasToPngBlob(canvas);
    await savePngBlob(blob, exportSnapshotFilename());
  } catch (err) {
    console.error(err);
    alert(
      "Could not save the image. The list may be too long for your browser — try again with fewer entries.",
    );
  } finally {
    exportImageBtn.disabled = false;
  }
}

function bindUi() {
  addTimeEntryDialog.addEventListener("close", () => {
    editingTimeEntry = null;
    dialogTitleEl.textContent = DIALOG_TITLE_ADD;
  });

  app.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (clickPreservesEntrySelection(t)) return;
    clearTimeEntrySelection();
  });

  addTimeEntryBtn.addEventListener("click", () => {
    openAddTimeEntryDialog();
  });

  exportImageBtn.addEventListener("click", () => {
    void exportShellToPng();
  });

  clearAllTimeEntriesBtn.addEventListener("click", () => {
    if (timeEntries.length === 0) return;
    const n = timeEntries.length;
    const noun = n === 1 ? "entry" : "entries";
    if (!confirm(`Clear all ${n} time ${noun}? This cannot be undone.`)) return;
    timeEntries.length = 0;
    selectedTimeEntry = null;
    editingTimeEntry = null;
    closeDialogIfOpen();
    saveTimeEntries(timeEntries);
    renderTimeEntries();
  });

  cancelBtn.addEventListener("click", () => {
    closeDialogIfOpen();
  });

  addTimeEntryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    submitTimeEntryForm();
  });
}

bindUi();
renderTimeEntries();
