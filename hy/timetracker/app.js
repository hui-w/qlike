const app = document.getElementById("app");
if (!app) {
  throw new Error("Time tracker: missing #app container.");
}

function isAppleTouchWebKit() {
  if (typeof navigator === "undefined") return false;
  if (/iP(hone|ad|od)/i.test(navigator.userAgent)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}
if (isAppleTouchWebKit()) {
  document.documentElement.classList.add("apple-touch-webkit");
}

/**
 * Single-file SPA: entries in `localStorage`, optional PNG export via vendor/html2canvas.
 * Flow: config → storage → time/relations → DOM shell → dialog → list → bindUi().
 */

// --- Config ---

const TIME_ENTRIES_STORAGE_KEY = "time_entries";
const LEGACY_TIME_ENTRIES_STORAGE_KEY = "timetracker_entries";

const DIALOG_TITLE_ADD = "Add time entry";
const DIALOG_TITLE_EDIT = "Edit time entry";

const PRESET_LABEL_RAW = [
  "Home In",
  "Home Out",
  "Office In",
  "Office Out",
  "Bus On",
  "Bus Off",
  "Train On",
  "Train Off",
];

const PRESET_LABELS = Object.freeze(
  [...PRESET_LABEL_RAW].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
);

const STORAGE_HINT_TEXT =
  "All data is stored only in this browser's local storage. It stays after you refresh and is not synced across browsers or other devices.";

const SELECTION_PRESERVE_SELECTORS = [
  ".time-entry",
  "dialog[open]",
  ".time-entry-footer",
  ".app-header",
];

const HTML2CANVAS_SNAPSHOT = {
  scale: 2,
  backgroundColor: "#ffffff",
  logging: false,
  useCORS: true,
};

const CLASS_ROW_ACTIONS = "time-entry-row-actions";

const RELATION_FIRST_LINE = Object.freeze({
  lines: ["This is the start"],
  title: "This is the start",
});

/** @typedef {{ timestamp: number; label: string }} TimeEntry */
/** @typedef {{ lines: string[]; title: string }} RelationDisplay */
/** @typedef {"selection" | "previous" | "start"} RelationMode */

// --- State ---

const timeEntries = loadTimeEntries() ?? [];
sortTimeEntriesChronologically(timeEntries);

/** @type {TimeEntry | null} */
let selectedTimeEntry = null;

/** @type {TimeEntry | null} */
let editingTimeEntry = null;

// --- Utilities ---

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

function pad2(n) {
  return String(n).padStart(2, "0");
}

// --- Storage ---

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

// --- Local date/time ---

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
 * @param {number} ms
 */
function setDialogInputsFromTimestamp(ms) {
  const d = new Date(ms);
  entryDateInput.value = formatLocalDateInputValue(d);
  entryTimeInput.value = formatLocalTimeInputValue(d);
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

// --- Relation text ---

/**
 * @param {number} n
 * @param {string} one
 * @param {string} many
 */
function pluralUnit(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * @param {number} absSec
 * @returns {{ short: string; full: string }}
 */
function formatDuration(absSec) {
  let abs = absSec;
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

  return {
    short: shortParts.join(" "),
    full: fullParts.join(" "),
  };
}

/** @param {RelationMode} mode */
function relationZeroLine(mode) {
  if (mode === "selection") return "Same time as selection";
  if (mode === "start") return "Same time as start";
  return "Same time";
}

/**
 * @param {RelationMode} mode
 * @param {boolean} after
 */
function relationSuffix(mode, after) {
  if (mode === "selection") return after ? "after selection" : "before selection";
  if (mode === "start") return "since start";
  return after ? "later" : "earlier";
}

/**
 * @param {number} entryMs
 * @param {number} anchorMs
 * @param {RelationMode} mode
 * @returns {RelationDisplay}
 */
function versusAnchorDeltaDisplay(entryMs, anchorMs, mode) {
  const diffSec = Math.round((entryMs - anchorMs) / 1000);
  if (diffSec === 0) {
    const line = relationZeroLine(mode);
    return { lines: [line], title: line };
  }
  const after = diffSec > 0;
  const duration = formatDuration(Math.abs(diffSec));
  const suffix = relationSuffix(mode, after);
  return {
    lines: [`${duration.short} ${suffix}`],
    title: `${duration.full} ${suffix}`,
  };
}

/**
 * @param {TimeEntry} entry
 * @param {TimeEntry | null} selected
 * @param {TimeEntry | null} previousEntry
 * @param {TimeEntry} firstEntry
 * @returns {RelationDisplay}
 */
function relationDisplayForEntry(entry, selected, previousEntry, firstEntry) {
  if (selected !== null && entry !== selected) {
    return versusAnchorDeltaDisplay(entry.timestamp, selected.timestamp, "selection");
  }
  if (selected === null) {
    if (previousEntry === null) return RELATION_FIRST_LINE;
    return versusAnchorDeltaDisplay(entry.timestamp, firstEntry.timestamp, "start");
  }
  return { lines: [], title: "" };
}

// --- Export image ---

/**
 * @param {number} timestamp
 * @param {string} label
 * @returns {string}
 */
function formatEntrySummary(timestamp, label) {
  return `${formatLocalYmdHms(new Date(timestamp))} — ${label}`;
}

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

// --- DOM: shell ---

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

// --- DOM: dialog ---

const addTimeEntryDialog = document.createElement("dialog");
addTimeEntryDialog.className = "add-time-entry-dialog";
addTimeEntryDialog.tabIndex = -1;
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
    <fieldset class="field label-preset-field">
      <legend class="field-label">Label</legend>
      <div class="label-preset-grid" role="group" aria-label="Preset labels"></div>
      <label class="field field-custom-label">
        <span class="field-label">Custom</span>
        <input class="field-input" name="label" type="text" autocomplete="off" placeholder="Or type a custom label" />
      </label>
    </fieldset>
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
const labelPresetGrid = addTimeEntryDialog.querySelector(".label-preset-grid");

if (
  !(addTimeEntryForm instanceof HTMLFormElement) ||
  !(entryDateInput instanceof HTMLInputElement) ||
  !(entryTimeInput instanceof HTMLInputElement) ||
  !(labelInput instanceof HTMLInputElement) ||
  !(cancelBtn instanceof HTMLButtonElement) ||
  !(dialogTitleEl instanceof HTMLElement) ||
  !(labelPresetGrid instanceof HTMLElement)
) {
  throw new Error("Time tracker: dialog markup is missing required nodes.");
}

function initLabelPresetButtons() {
  for (const preset of PRESET_LABELS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "label-preset-option";
    btn.textContent = preset;
    btn.addEventListener("click", () => {
      labelInput.value = preset;
      labelInput.setCustomValidity("");
    });
    labelPresetGrid.append(btn);
  }
  labelInput.addEventListener("input", () => labelInput.setCustomValidity(""));
}

initLabelPresetButtons();

// --- Dialog ---

function closeDialogIfOpen() {
  if (addTimeEntryDialog.open) addTimeEntryDialog.close();
}

function clearDialogValidity() {
  entryDateInput.setCustomValidity("");
  entryTimeInput.setCustomValidity("");
  labelInput.setCustomValidity("");
}

function blurFocusedFormControl() {
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLSelectElement ||
    active instanceof HTMLTextAreaElement
  ) {
    active.blur();
  }
}

function showTimeEntryDialog() {
  addTimeEntryDialog.showModal();
  blurFocusedFormControl();
  requestAnimationFrame(() => {
    blurFocusedFormControl();
    addTimeEntryDialog.focus({ preventScroll: true });
  });
}

function resetAddTimeEntryForm() {
  setDialogInputsFromTimestamp(Date.now());
  labelInput.value = "";
  clearDialogValidity();
}

function openAddTimeEntryDialog() {
  editingTimeEntry = null;
  dialogTitleEl.textContent = DIALOG_TITLE_ADD;
  resetAddTimeEntryForm();
  showTimeEntryDialog();
}

/**
 * @param {TimeEntry} timeEntry
 */
function openEditTimeEntryDialog(timeEntry) {
  if (!timeEntries.includes(timeEntry)) return;
  editingTimeEntry = timeEntry;
  dialogTitleEl.textContent = DIALOG_TITLE_EDIT;
  setDialogInputsFromTimestamp(timeEntry.timestamp);
  labelInput.value = timeEntry.label;
  clearDialogValidity();
  showTimeEntryDialog();
}

function submitTimeEntryForm() {
  clearDialogValidity();

  const ts = parseDateAndTimeInputs(entryDateInput.value, entryTimeInput.value);
  if (ts === null) {
    entryDateInput.setCustomValidity("Choose a valid date and time");
    entryDateInput.reportValidity();
    return;
  }

  const label = labelInput.value.trim();
  if (label.length === 0) {
    labelInput.setCustomValidity("Choose a preset label or enter a custom label");
    labelInput.reportValidity();
    return;
  }

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

// --- List ---

function clearTimeEntrySelection() {
  if (selectedTimeEntry === null) return;
  selectedTimeEntry = null;
  renderTimeEntries();
}

/**
 * @param {HTMLElement} parent
 * @param {RelationDisplay} rel
 */
function appendRelationLines(parent, rel) {
  if (rel.lines.length === 0) return;
  const relationEl = document.createElement("div");
  relationEl.className = "time-entry-relation";
  relationEl.title = rel.title;
  for (const line of rel.lines) {
    const lineEl = document.createElement("span");
    lineEl.className = "time-entry-relation-line";
    lineEl.textContent = line;
    relationEl.append(lineEl);
  }
  parent.append(relationEl);
}

/**
 * @param {TimeEntry} previousEntry
 * @param {TimeEntry} currentEntry
 * @returns {HTMLLIElement}
 */
function createTimeEntryGapElement(previousEntry, currentEntry) {
  const rel = versusAnchorDeltaDisplay(
    currentEntry.timestamp,
    previousEntry.timestamp,
    "previous",
  );

  const li = document.createElement("li");
  li.className = "time-entry-gap";
  li.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "time-entry-gap-label";
  label.textContent = rel.lines[0];
  label.title = rel.title;
  li.append(label);
  return li;
}

/**
 * @param {TimeEntry} timeEntry
 * @param {TimeEntry | null} previousEntry
 * @param {TimeEntry} firstEntry
 * @returns {HTMLLIElement}
 */
function createTimeEntryElement(timeEntry, previousEntry, firstEntry) {
  const { timestamp, label } = timeEntry;
  const summary = formatEntrySummary(timestamp, label);

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

  const labelEl = document.createElement("span");
  labelEl.className = "time-entry-text-label";
  labelEl.textContent = label;

  const rowLabel = document.createElement("div");
  rowLabel.className = "time-entry-row time-entry-row-label";
  rowLabel.append(labelEl);

  const timeEl = document.createElement("time");
  timeEl.className = "time-entry-datetime";
  timeEl.dateTime = new Date(timestamp).toISOString();
  timeEl.textContent = formatLocalYmdHms(new Date(timestamp));

  const metaLeft = document.createElement("div");
  metaLeft.className = "time-entry-meta-left";
  metaLeft.append(timeEl);
  appendRelationLines(
    metaLeft,
    relationDisplayForEntry(timeEntry, selectedTimeEntry, previousEntry, firstEntry),
  );

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn-edit-time-entry";
  editBtn.textContent = "Edit";
  editBtn.setAttribute("aria-label", `Edit time entry ${summary}`);
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEditTimeEntryDialog(timeEntry);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn-delete-time-entry";
  deleteBtn.textContent = "Delete";
  deleteBtn.setAttribute("aria-label", `Delete time entry ${summary}`);
  deleteBtn.addEventListener("click", (e) => {
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

  const rowActions = document.createElement("div");
  rowActions.className = CLASS_ROW_ACTIONS;
  rowActions.append(editBtn, deleteBtn);

  const rowMeta = document.createElement("div");
  rowMeta.className = "time-entry-row time-entry-row-meta";
  rowMeta.append(metaLeft, rowActions);

  const content = document.createElement("div");
  content.className = "time-entry-content";
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

  const firstEntry = timeEntries[0];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < timeEntries.length; i++) {
    if (i > 0) {
      frag.append(createTimeEntryGapElement(timeEntries[i - 1], timeEntries[i]));
    }
    frag.append(
      createTimeEntryElement(
        timeEntries[i],
        i > 0 ? timeEntries[i - 1] : null,
        firstEntry,
      ),
    );
  }
  timeEntryListEl.append(frag);
}

// --- UI bindings ---

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

  addTimeEntryBtn.addEventListener("click", openAddTimeEntryDialog);
  exportImageBtn.addEventListener("click", () => void exportShellToPng());
  cancelBtn.addEventListener("click", closeDialogIfOpen);

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

  addTimeEntryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    submitTimeEntryForm();
  });
}

bindUi();
renderTimeEntries();
