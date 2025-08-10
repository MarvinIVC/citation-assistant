// Citation Assistant front-end
// Handles: UI, state, fetch from URL/DOI/ISBN, formatting MLA/APA/Chicago, export, localStorage

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  style: localStorage.getItem("style") || "mla",
  items: loadItems()
};

function loadItems() {
  try {
    return JSON.parse(localStorage.getItem("citations") || "[]");
  } catch {
    return [];
  }
}
function saveItems() {
  localStorage.setItem("citations", JSON.stringify(state.items));
}
function setStyle(style) {
  state.style = style;
  localStorage.setItem("style", style);
  renderList();
}

// UI init
window.addEventListener("DOMContentLoaded", () => {
  $("#styleSelect").value = state.style;
  bindTabs();
  bindControls();
  renderList();
});

function bindTabs() {
  const tabs = $$(".tab");
  const contents = $$(".tab-content");
  tabs.forEach((t) =>
    t.addEventListener("click", () => {
      tabs.forEach((x) => x.classList.remove("active"));
      contents.forEach((c) => c.classList.remove("active"));
      t.classList.add("active");
      $(`#tab-${t.dataset.tab}`).classList.add("active");
    })
  );
}

function bindControls() {
  $("#styleSelect").addEventListener("change", (e) => setStyle(e.target.value));

  $("#fetchURL").addEventListener("click", onFetchURL);
  $("#fetchDOI").addEventListener("click", onFetchDOI);
  $("#fetchISBN").addEventListener("click", onFetchISBN);
  $("#addManual").addEventListener("click", onAddManual);

  $("#exportAll").addEventListener("click", onExportAll);
  $("#clearAll").addEventListener("click", onClearAll);
  $("#sortAZ").addEventListener("click", () => {
    state.items.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    saveItems();
    renderList();
  });
  $("#sortTime").addEventListener("click", () => {
    state.items.sort((a, b) => (a._t || 0) - (b._t || 0));
    saveItems();
    renderList();
  });
}

async function onFetchURL() {
  const url = $("#urlInput").value.trim();
  if (!url) return toast("Please enter a URL.");
  const endpoint = "/.netlify/functions/urlMeta?url=" + encodeURIComponent(url);
  try {
    startBusy("#fetchURL");
    const res = await fetch(endpoint);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to fetch metadata");
    addCitation(sanitizeItem(data.result));
    toast("Citation added from URL.");
    $("#urlInput").value = "";
  } catch (e) {
    toast("Error: " + e.message);
  } finally {
    endBusy("#fetchURL");
  }
}

async function onFetchDOI() {
  const raw = $("#doiInput").value.trim();
  if (!raw) return toast("Please enter a DOI.");
  const doi = normalizeDOI(raw);
  try {
    startBusy("#fetchDOI");
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: {
        "User-Agent": "CitationAssistant/1.0 (mailto:you@example.com)"
      }
    });
    if (!res.ok) throw new Error("Crossref lookup failed");
    const { message } = await res.json();
    const item = crossrefToItem(message);
    addCitation(item);
    toast("Citation added from DOI.");
    $("#doiInput").value = "";
  } catch (e) {
    toast("Error: " + e.message);
  } finally {
    endBusy("#fetchDOI");
  }
}

async function onFetchISBN() {
  const raw = $("#isbnInput").value.replace(/[^0-9Xx]/g, "");
  if (!raw) return toast("Please enter an ISBN.");
  try {
    startBusy("#fetchISBN");
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${raw}&format=json&jscmd=data`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Open Library lookup failed");
    const data = await res.json();
    const key = `ISBN:${raw}`;
    if (!data[key]) throw new Error("No data found for this ISBN");
    const item = openLibraryToItem(data[key], raw);
    addCitation(item);
    toast("Citation added from ISBN.");
    $("#isbnInput").value = "";
  } catch (e) {
    toast("Error: " + e.message);
  } finally {
    endBusy("#fetchISBN");
  }
}

function onAddManual() {
  const item = {
    type: "generic",
    title: $("#m-title").value.trim() || null,
    authors: parseAuthorsText($("#m-authors").value),
    container: $("#m-container").value.trim() || null,
    publisher: $("#m-publisher").value.trim() || null,
    year: parseInt($("#m-year").value.trim(), 10) || null,
    volume: $("#m-volume").value.trim() || null,
    issue: $("#m-issue").value.trim() || null,
    pages: $("#m-pages").value.trim() || null,
    doi: normalizeDOI($("#m-doi").value.trim()) || null,
    url: $("#m-url").value.trim() || null,
    datePublished: $("#m-date").value.trim() || null
  };
  addCitation(item);
  toast("Manual citation added.");
  // Optional: clear
}

function addCitation(item) {
  item._id = cryptoRandom();
  item._t = Date.now();
  state.items.unshift(item);
  saveItems();
  renderList();
}

function removeCitation(id) {
  state.items = state.items.filter((x) => x._id !== id);
  saveItems();
  renderList();
}

function renderList() {
  const list = $("#citationsList");
  list.innerHTML = "";
  for (const item of state.items) {
    const li = document.createElement("li");
    li.className = "citation-card";
    const cite = formatCitation(item, state.style);
    li.innerHTML = `
      <div class="cite-text">${escapeHTML(cite)}</div>
      <div class="meta">
        ${badge(item.type)}
        ${item.doi ? `<span class="pill">DOI: ${escapeHTML(item.doi)}</span>` : ""}
        ${item.url ? `<span class="pill">URL</span>` : ""}
        ${item.year ? `<span class="pill">${item.year}</span>` : ""}
      </div>
      <div class="card-actions">
        <button class="action" data-act="copy">Copy</button>
        <button class="action" data-act="edit">Edit</button>
        <button class="action" data-act="delete">Delete</button>
      </div>
    `;
    li.querySelector('[data-act="copy"]').addEventListener("click", () =>
      copyText(cite)
    );
    li.querySelector('[data-act="delete"]').addEventListener("click", () =>
      removeCitation(item._id)
    );
    li.querySelector('[data-act="edit"]').addEventListener("click", () =>
      editItem(item._id)
    );
    list.appendChild(li);
  }
}

function badge(type) {
  const map = {
    "journal-article": "Journal",
    "webpage": "Web",
    "book": "Book",
    "generic": "Source"
  };
  return `<span class="pill">${map[type] || "Source"}</span>`;
}

function editItem(id) {
  const item = state.items.find((x) => x._id === id);
  if (!item) return;
  const proposed = prompt(
    "Edit JSON (advanced users only):",
    JSON.stringify(item, null, 2)
  );
  if (!proposed) return;
  try {
    const parsed = JSON.parse(proposed);
    parsed._id = id;
    parsed._t = item._t;
    state.items = state.items.map((x) => (x._id === id ? parsed : x));
    saveItems();
    renderList();
    toast("Updated.");
  } catch {
    toast("Invalid JSON.");
  }
}

function onExportAll() {
  if (state.items.length === 0) return toast("Nothing to export.");
  const lines = state.items.map((it) => formatCitation(it, state.style));
  const blob = new Blob([lines.join("\n\n") + "\n"], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `citations-${state.style}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function onClearAll() {
  if (!confirm("Clear all citations?")) return;
  state.items = [];
  saveItems();
  renderList();
}

// ===================== Formatting =====================

function formatCitation(item, style) {
  switch (style) {
    case "mla":
      return formatMLA(item);
    case "apa":
      return formatAPA(item);
    case "chicago":
      return formatChicagoAD(item);
    default:
      return formatMLA(item);
  }
}

function formatMLA(it) {
  // Authors: 1 author -> Last, First.
  // 2 authors -> Last, First, and First Last.
  // 3+ -> Last, First, et al.
  const authors = formatAuthorsMLA(it.authors || []);
  const title = it.title ? `“${titleCase(it.title)}.”` : "";
  // Container italicized if present
  const container = it.container ? `<i>${titleCase(it.container)}</i>` : "";
  const vol = it.volume ? `vol. ${it.volume}` : "";
  const iss = it.issue ? `no. ${it.issue}` : "";
  const pages = it.pages ? `pp. ${it.pages}` : "";
  const year = it.year || (it.datePublished ? new Date(it.datePublished).getUTCFullYear() : null);
  const date = year ? `${year}` : "";
  const doi = it.doi ? `https://doi.org/${it.doi}` : "";
  const url = !it.doi && it.url ? it.url : "";
  const parts = [authors, title, container, joinComma([vol, iss]), pages, date, doi || url]
    .filter(Boolean)
    .join(" ");

  return ensurePeriod(parts);
}

function formatAPA(it) {
  // Authors: up to 20 authors. 21+ => first 19, …, last
  const authors = formatAuthorsAPA(it.authors || []);
  const year = it.year ?? (it.datePublished ? new Date(it.datePublished).getUTCFullYear() : "n.d.");
  const date = it.datePublished ? formatAPADate(it.datePublished) : `(${year}).`;
  const title = it.title ? `${sentenceCase(it.title)}.` : "";
  const container = it.container ? `<i>${titleCase(it.container)}</i>` : "";
  const vol = it.volume ? `<i>${it.volume}</i>` : "";
  const iss = it.issue ? `(${it.issue})` : "";
  const pages = it.pages ? `${it.pages}` : "";
  const doi = it.doi ? `https://doi.org/${it.doi}` : "";
  const url = !it.doi && it.url ? it.url : "";

  // Journal article vs webpage heuristics
  if (it.type === "journal-article" || (it.container && (it.volume || it.issue || it.pages))) {
    const parts = [authors, date, title, joinSpace([container, joinNoSpace([vol, iss]) + (pages ? `, ${pages}` : "") + "."]), doi || url].filter(Boolean);
    return sanitizeAPA(parts.join(" "));
  } else {
    const site = it.container || it.website || it.publisher || "";
    const parts = [authors, date, `<i>${sentenceCase(it.title || "")}</i>.`, site ? `${titleCase(site)}.` : "", doi || url].filter(Boolean);
    return sanitizeAPA(parts.join(" "));
  }
}

function formatChicagoAD(it) {
  // Authors: list all up to 10; if >10, first 7 + et al.
  const authors = formatAuthorsChicago(it.authors || []);
  const year = it.year ?? (it.datePublished ? new Date(it.datePublished).getUTCFullYear() : "n.d.");
  const title = it.title ? `“${titleCase(it.title)}.”` : "";
  const container = it.container ? `<i>${titleCase(it.container)}</i>` : "";
  const volIss = joinNoSpace([it.volume || "", it.issue ? `, no. ${it.issue}` : ""]);
  const pages = it.pages ? `: ${it.pages}` : "";
  const doi = it.doi ? `https://doi.org/${it.doi}` : "";
  const url = !it.doi && it.url ? it.url : "";
  // Webpage fallback
  if (it.type === "webpage" && !it.volume && !it.issue) {
    const site = it.container || it.website || it.publisher || "";
    const parts = [authors + ".", `${year}.`, title, `${titleCase(site)}.`, doi || url].filter(Boolean);
    return joinSpace(parts);
  }
  const parts = [authors + ".", `${year}.`, title, joinComma([container, volIss]) + (pages || "") + ".", doi || url].filter(Boolean);
  return joinSpace(parts);
}

// ===================== Author name helpers =====================

function formatAuthorsMLA(arr) {
  if (arr.length === 0) return "";
  if (arr.length === 1) {
    const a = arr[0];
    return nameMLA(a) + ".";
  }
  if (arr.length === 2) {
    return `${nameMLA(arr[0])}, and ${nameNatural(arr[1])}.`;
  }
  // 3+ -> et al.
  return `${nameMLA(arr[0])}, et al.`;
}

function nameMLA(a) {
  if (!a) return "";
  const last = a.family || "";
  const first = a.given || "";
  if (last && first) return `${last}, ${first}`;
  return a.literal || [first, last].filter(Boolean).join(" ");
}

function nameNatural(a) {
  if (!a) return "";
  const last = a.family || "";
  const first = a.given || "";
  if (last && first) return `${first} ${last}`;
  return a.literal || [first, last].filter(Boolean).join(" ");
}

function formatAuthorsAPA(arr) {
  if (arr.length === 0) return "";
  // APA 7: up to 20 authors; 21+ => first 19, …, last
  let list = arr.map((a) => {
    const last = a.family || "";
    const initials = (a.given || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n[0].toUpperCase() + ".")
      .join(" ");
    return last ? `${last}, ${initials}` : a.literal || "";
  }).filter(Boolean);

  if (list.length <= 20) {
    if (list.length === 1) return list[0] + ".";
    if (list.length === 2) return `${list[0]} & ${list[1]}.`;
    return list.slice(0, -1).join(", ") + ", & " + list.slice(-1) + ".";
  } else {
    const first19 = list.slice(0, 19).join(", ");
    const last = list[list.length - 1];
    return `${first19}, …, ${last}.`;
  }
}

function formatAuthorsChicago(arr) {
  if (arr.length === 0) return "";
  let list = arr.map((a, idx) => {
    const last = a.family || "";
    const first = a.given || "";
    if (idx === 0) {
      // In bibliography: Last, First
      if (last && first) return `${last}, ${first}`;
      return a.literal || [first, last].filter(Boolean).join(" ");
    } else {
      // Subsequent: First Last
      if (last && first) return `${first} ${last}`;
      return a.literal || [first, last].filter(Boolean).join(" ");
    }
  });

  if (list.length <= 10) {
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return list.slice(0, -1).join(", ") + ", and " + list.slice(-1);
  } else {
    return list.slice(0, 7).join(", ") + ", et al.";
  }
}

// ===================== Text helpers =====================

function titleCase(str) {
  if (!str) return "";
  const small = new Set(["a","an","the","and","but","or","for","nor","on","at","to","from","by","of","in","with"]);
  return str
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w, i, arr) => {
      if (w.trim() === "" || w === "-") return w;
      const lw = w.toLowerCase();
      const isFirst = i === 0;
      const isLast = i === arr.length - 1;
      if (!isFirst && !isLast && small.has(lw)) return lw;
      return w[0].toUpperCase() + w.slice(1);
    })
    .join("")
    .replace(/\bI\b/g, "I");
}

function sentenceCase(str) {
  if (!str) return "";
  const s = str.trim();
  if (!s) return "";
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

function joinComma(arr) {
  const a = arr.filter(Boolean);
  if (a.length === 0) return "";
  return a.join(", ");
}

function joinSpace(arr) {
  return arr.filter(Boolean).join(" ");
}

function joinNoSpace(arr) {
  return arr.filter(Boolean).join("");
}

function ensurePeriod(s) {
  if (!s) return s;
  return /[.!?]$/.test(s.trim()) ? s : s + ".";
}

function sanitizeAPA(s) {
  // Fix duplicate periods before URL/DOI
  return s.replace(/\. (\(https?:\/\/|https?:\/\/|https?:\/\/doi\.org|https:\/\/doi\.org)/i, ". $1");
}

function escapeHTML(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ===================== Parsers (Crossref, Open Library) =====================

function crossrefToItem(m) {
  const authors = (m.author || []).map((a) => ({
    given: a.given || "",
    family: a.family || "",
    literal: [a.given, a.family].filter(Boolean).join(" ").trim()
  }));

  const issued = m["issued"]?.["date-parts"]?.[0] || [];
  const year = issued[0] || null;

  const pages = m.page || null;
  const container = m["container-title"]?.[0] || null;
  const doi = m.DOI || null;
  const url = m.URL || null;
  const volume = m.volume || null;
  const issue = m.issue || null;
  const publisher = m.publisher || null;
  const title = Array.isArray(m.title) ? m.title[0] : m.title;

  let type = "journal-article";
  if (m.type === "book") type = "book";
  if (m.type?.includes("journal-article")) type = "journal-article";

  return {
    type,
    title,
    authors,
    container,
    publisher,
    year,
    volume,
    issue,
    pages,
    doi,
    url
  };
}

function openLibraryToItem(data, isbnRaw) {
  const authors = (data.authors || []).map((a) => ({
    given: "",
    family: a.name || "",
    literal: a.name || ""
  }));

  const year =
    (data.publish_date && parseInt(String(data.publish_date).match(/\d{4}/)?.[0])) ||
    null;

  return {
    type: "book",
    title: data.title || null,
    authors,
    container: null,
    publisher: (data.publishers && data.publishers[0]?.name) || null,
    year,
    volume: null,
    issue: null,
    pages: (data.pagination || "").replace(/[^0-9\-–]/g, "") || null,
    doi: null,
    url: `https://openlibrary.org/isbn/${isbnRaw}`
  };
}

// ===================== Misc helpers =====================

function normalizeDOI(s) {
  if (!s) return null;
  return s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
}

function parseAuthorsText(text) {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((full) => {
    if (full.includes(",")) {
      const [last, ...rest] = full.split(",");
      const given = rest.join(",").trim();
      return { given, family: last.trim(), literal: full };
    }
    const parts = full.split(/\s+/);
    if (parts.length === 1) return { given: "", family: parts[0], literal: full };
    const family = parts.pop();
    const given = parts.join(" ");
    return { given, family, literal: full };
  });
}

function sanitizeItem(it) {
  // Ensure minimal fields and basic types
  return {
    type: it.type || "generic",
    title: it.title || null,
    authors: Array.isArray(it.authors) ? it.authors : [],
    container: it.container || null,
    publisher: it.publisher || null,
    year: it.year || (it.datePublished ? new Date(it.datePublished).getUTCFullYear() : null),
    volume: it.volume || null,
    issue: it.issue || null,
    pages: it.pages || null,
    doi: it.doi || null,
    url: it.url || null,
    datePublished: it.datePublished || null
  };
}

function startBusy(sel) {
  const btn = $(sel);
  btn.disabled = true;
  btn.dataset.label = btn.textContent;
  btn.textContent = "Working…";
}
function endBusy(sel) {
  const btn = $(sel);
  btn.disabled = false;
  btn.textContent = btn.dataset.label || "Done";
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(
    () => toast("Copied to clipboard."),
    () => toast("Copy failed.")
  );
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function cryptoRandom() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function formatAPADate(dateStr) {
  // (Year, Month Day).
  const d = new Date(dateStr);
  if (isNaN(d)) return `(${new Date().getUTCFullYear()}).`;
  const year = d.getUTCFullYear();
  const month = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const day = d.getUTCDate();
  return `(${year}, ${month} ${day}).`;
}
