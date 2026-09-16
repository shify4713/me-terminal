(() => {
  "use strict";
  var STORAGE_KEY = "me_terminal_cfg";
  var SESSION_KEY = "me_terminal_session";
  var PAGE_SIZE = 60;
  var ICON_BASE_GH = "https://raw.githubusercontent.com/shify4713/me-terminal/main/icons/";
  function loadCfg() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch (e) { return {}; } }
  function saveCfg(c) { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); }
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; } }
  function saveSession(s) { if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); else sessionStorage.removeItem(SESSION_KEY); }
  var cfg = Object.assign({ gistUser: "", gistId: "", token: "", pollSec: 12 }, loadCfg());
  var session = loadSession();
  var usersList = [];
  var state = { items: [], craftables: [], cpus: [], power: {}, online: false, updated: null, error: null };
  var prevFp = { items: "", craftables: "", cpus: "", power: "" };
  var currentCraftItem = null, pollTimer = null, page = 0, filteredItems = [], ruNames = {}, filterDirty = true;
  var DEFAULT_USERS = [{ login: "LiwMorgan", password: "change_me_admin", role: "admin" }, { login: "teammate1", password: "change_me_1", role: "user" }, { login: "teammate2", password: "change_me_2", role: "user" }];
  var AE2_META = { "0": "CertusQuartzCrystal", "1": "CertusQuartzCrystalCharged", "5": "FluixCrystal", "6": "FluixDust", "7": "CertusQuartzDust", "10": "GoldDust", "11": "IronDust", "12": "Silicon", "24": "CalcProcessor", "25": "EngProcessor", "26": "LogicProcessor", "36": "FormationCore", "37": "AnnihilationCore", "38": "Cell1kPart", "39": "Cell4kPart", "40": "Cell16kPart", "41": "Cell64kPart", "52": "BlankPattern", "54": "Wireless", "55": "WirelessBooster" };
  function appBase() { var p = location.pathname || "/"; if (p.indexOf(".html") !== -1) p = p.replace(/\/[^\/]*$/, "/"); else if (p.charAt(p.length - 1) !== "/") p = p + "/"; return p; }
  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }
  var els = {};
  function cacheEls() {
    els = { search: $("#search"), clearSearch: $("#clearSearch"), onlyCraftable: $("#onlyCraftable"), onlyStock: $("#onlyStock"), modFilter: $("#modFilter"), sortBy: $("#sortBy"), itemsGrid: $("#itemsGrid"), craftGrid: $("#craftGrid"), cpusList: $("#cpusList"), networkCards: $("#networkCards"), emptyState: $("#emptyState"), powerValue: $("#powerValue"), itemCount: $("#itemCount"), cpuCount: $("#cpuCount"), connStatus: $("#connStatus"), craftModal: $("#craftModal"), craftPreview: $("#craftPreview"), craftQty: $("#craftQty"), toast: $("#toast"), settingsModal: $("#settingsModal"), cfgGistUser: $("#cfgGistUser"), cfgGistId: $("#cfgGistId"), cfgToken: $("#cfgToken"), cfgPoll: $("#cfgPoll"), loginOverlay: $("#loginOverlay"), loginUser: $("#loginUser"), loginPass: $("#loginPass"), loginError: $("#loginError"), btnLogin: $("#btnLogin") };
  }
  function ensurePager() {
    if ($("#pager")) return;
    var g = els.itemsGrid; if (!g || !g.parentNode) return;
    var p = document.createElement("div"); p.id = "pager"; p.className = "pager";
    p.innerHTML = '<button type="button" class="btn secondary" id="pagePrev">←</button><span id="pageInfo">1 / 1</span><button type="button" class="btn secondary" id="pageNext">→</button><span id="pageTotal" class="pager-total"></span>';
    g.parentNode.insertBefore(p, g.nextSibling);
  }
  async function loadUsers() {
    usersList = DEFAULT_USERS.slice();
    try { var r = await fetch(appBase() + "data/users.json", { cache: "no-store" }); if (!r.ok) throw 0; var d = await r.json(); if (d && d.users && d.users.length) usersList = d.users; } catch (e) {}
  }
  async function loadRuNames() {
    try { var r = await fetch(appBase() + "data/ru_names.json", { cache: "force-cache" }); if (r.ok) ruNames = await r.json(); } catch (e) {}
  }
  function isLoggedIn() { return !!(session && session.login); }
  function canCraft() { return isLoggedIn() && (session.role === "admin" || session.role === "user"); }
  function applyAuthUI() {
    if (isLoggedIn()) { document.body.classList.remove("locked"); if (els.loginOverlay) { els.loginOverlay.hidden = true; els.loginOverlay.style.display = "none"; } }
    else { document.body.classList.add("locked"); if (els.loginOverlay) { els.loginOverlay.hidden = false; els.loginOverlay.style.display = ""; } }
  }
  function showLoginError(m) { if (!els.loginError) return; els.loginError.textContent = m || "Неверный логин или пароль"; els.loginError.hidden = false; els.loginError.style.display = "block"; }
  function tryLogin() {
    try {
      if (!usersList.length) usersList = DEFAULT_USERS.slice();
      var login = ((els.loginUser && els.loginUser.value) || "").trim();
      var pass = ((els.loginPass && els.loginPass.value) || "").trim();
      if (!login || !pass) { showLoginError("Введите логин и пароль"); return; }
      var user = null;
      for (var i = 0; i < usersList.length; i++) { if (usersList[i].login === login && String(usersList[i].password) === String(pass)) { user = usersList[i]; break; } }
      if (!user) { showLoginError("Неверный логин или пароль"); return; }
      if (els.loginError) { els.loginError.hidden = true; els.loginError.style.display = "none"; }
      session = { login: user.login, role: user.role || "user" }; saveSession(session); applyAuthUI(); showToast("Привет, " + session.login); refresh(true); startPolling();
    } catch (err) { showLoginError("Ошибка: " + (err.message || err)); }
  }
  function logout() { session = null; saveSession(null); applyAuthUI(); showToast("Вышли"); }
  function formatNum(n) { if (n == null || n === "") return "—"; n = Number(n); if (isNaN(n)) return "—"; if (n >= 1e6) return (n / 1e6).toFixed(1) + "M"; if (n >= 1e4) return (n / 1e3).toFixed(1) + "k"; if (n >= 1e3) return (n / 1e3).toFixed(2) + "k"; return String(Math.floor(n)); }
  function modColor(mod) { var h = 0; mod = mod || "x"; for (var i = 0; i < mod.length; i++) h = (h * 31 + mod.charCodeAt(i)) >>> 0; return "hsl(" + (h % 360) + " 50% 38%)"; }
  function humanize(raw) { if (!raw) return "?"; raw = String(raw).replace(/^item\.|^tile\.|^block\./i, ""); raw = raw.replace(/ItemMultiMaterial\.?/i, "Material ").replace(/ItemMaterial\.?/i, ""); raw = raw.replace(/[._]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim(); return raw.replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, 28) || "?"; }
  function prettyName(item) {
    var id = item.id || "";
    if (ruNames[id]) return ruNames[id];
    var base = id.replace(/:\d+$/, "");
    if (ruNames[base]) return ruNames[base];
    if (item.label && /[A-Za-zА-Яа-я]/.test(item.label) && item.label.length > 1) return item.label.slice(0, 28);
    var m = id.match(/^appliedenergistics2:item\.ItemMultiMaterial\.(\d+)$/i);
    if (m && AE2_META[m[1]]) return humanize(AE2_META[m[1]]);
    var parts = id.split(":");
    if (parts.length >= 2) return humanize(parts.slice(1).join(":").replace(/^item\.|^tile\./i, ""));
    return humanize(id);
  }
  function iconCandidates(item) {
    var id = item.id || "", list = [];
    if (item.icon) list.push(item.icon);
    var parts = id.split(":"), mod = parts[0] || "", rest = parts.slice(1).join(":");
    var m = id.match(/^appliedenergistics2:item\.ItemMultiMaterial\.(\d+)$/i);
    if (m && AE2_META[m[1]]) list.push("appliedenergistics2_ItemMaterial." + AE2_META[m[1]] + ".png");
    m = id.match(/^appliedenergistics2:item\.ItemEncodedPattern/i);
    if (m) list.push("appliedenergistics2_ItemEncodedPattern.png");
    m = id.match(/^appliedenergistics2:item\.ItemBasicStorageCell\.(.+)$/i);
    if (m) list.push("appliedenergistics2_ItemBasicStorageCell." + m[1] + ".png");
    m = id.match(/^appliedenergistics2:item\.ItemMaterial\.(.+)$/i);
    if (m) list.push("appliedenergistics2_ItemMaterial." + m[1] + ".png");
    if (mod && rest) {
      list.push(mod + "_" + rest + ".png");
      list.push(mod + "_" + rest.replace(/^item\./i, "") + ".png");
      list.push(mod + "_" + rest.replace(/^tile\./i, "") + ".png");
    }
    var seen = {};
    return list.filter(function (x) { if (!x || seen[x]) return false; seen[x] = true; return true; });
  }
  function iconHtml(item) {
    var name = prettyName(item);
    var initials = name.replace(/[^A-Za-zА-Яа-я0-9]/g, "").slice(0, 2).toUpperCase() || "??";
    var cands = iconCandidates(item);
    if (cands[0]) {
      var fb = cands.slice(1).concat(cands.map(function (c) { return "GH:" + c; }));
      return '<img class="item-icon" src="' + appBase() + "icons/" + cands[0] + '" alt="" loading="lazy" data-fb="' + fb.join("|") + '" onerror="window.__iconErr&&window.__iconErr(this)"/><div class="item-placeholder" style="display:none;background:' + modColor(item.mod) + '">' + initials + "</div>";
    }
    return '<div class="item-placeholder" style="background:' + modColor(item.mod) + '">' + initials + "</div>";
  }
  window.__iconErr = function (img) {
    var fb = (img.getAttribute("data-fb") || "").split("|").filter(Boolean);
    if (fb.length) {
      var next = fb[0]; img.setAttribute("data-fb", fb.slice(1).join("|"));
      img.src = next.indexOf("GH:") === 0 ? ICON_BASE_GH + next.slice(3) : appBase() + "icons/" + next;
      return;
    }
    img.style.display = "none"; var ph = img.nextElementSibling; if (ph) ph.style.display = "grid";
  };
  function showToast(msg, ms) {
    if (!els.toast) return; els.toast.textContent = msg; els.toast.hidden = false; els.toast.style.display = "";
    clearTimeout(showToast._t); showToast._t = setTimeout(function () { els.toast.hidden = true; }, ms || 2800);
  }
  function fpItems(arr) { return (arr || []).map(function (i) { return (i.id || "") + ":" + (i.size || 0) + ":" + (i.isCraftable ? 1 : 0); }).join("|"); }
  function fpCpus(arr) { return (arr || []).map(function (c) { return (c.name || "") + ":" + (c.busy ? 1 : 0); }).join("|"); }
  function renderItemCard(item, opts) {
    opts = opts || {}; var craftable = !!item.isCraftable, qty = item.size || 0;
    var extra = (craftable && opts.showCraftDot !== false) ? " craftable" : "";
    var title = (item.id || "") + " | " + qty + (craftable ? " | craftable" : "");
    var qtyText = qty > 0 ? formatNum(qty) : (craftable ? "craft" : "0");
    return '<div class="item-card' + extra + '" data-id="' + (item.id || "").replace(/"/g, "") + '" title="' + title.replace(/"/g, "") + '">' + iconHtml(item) + '<div class="item-qty">' + qtyText + '</div><div class="item-name">' + prettyName(item) + "</div></div>";
  }
  function buildFiltered() {
    var q = ((els.search && els.search.value) || "").trim().toLowerCase();
    var onlyCraft = els.onlyCraftable && els.onlyCraftable.checked;
    var onlyStock = els.onlyStock && els.onlyStock.checked;
    var mod = els.modFilter && els.modFilter.value;
    var sort = (els.sortBy && els.sortBy.value) || "name";
    var list = (state.items || []).slice();
    if (onlyCraft) list = list.filter(function (i) { return i.isCraftable; });
    if (onlyStock) list = list.filter(function (i) { return (i.size || 0) > 0; });
    if (mod) list = list.filter(function (i) { return i.mod === mod; });
    if (q) list = list.filter(function (i) { return (i.id || "").toLowerCase().indexOf(q) >= 0 || prettyName(i).toLowerCase().indexOf(q) >= 0 || (i.mod || "").toLowerCase().indexOf(q) >= 0; });
    list.sort(function (a, b) {
      if (sort === "qty-desc") return (b.size || 0) - (a.size || 0);
      if (sort === "qty-asc") return (a.size || 0) - (b.size || 0);
      if (sort === "mod") return (a.mod || "").localeCompare(b.mod || "") || prettyName(a).localeCompare(prettyName(b));
      return prettyName(a).localeCompare(prettyName(b));
    });
    filteredItems = list;
    var maxPage = Math.max(0, Math.ceil(filteredItems.length / PAGE_SIZE) - 1);
    if (page > maxPage) page = maxPage; if (page < 0) page = 0;
  }
  function renderPage(force) {
    if (!els.itemsGrid) return; ensurePager(); buildFiltered();
    var total = filteredItems.length, pages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
    var slice = filteredItems.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    var newFp = slice.map(function (i) { return (i.id || "") + ":" + (i.size || 0); }).join("|") + "@" + page + "/" + total;
    if (!force && newFp === renderPage._fp && els.itemsGrid.children.length) {
      var cards = els.itemsGrid.querySelectorAll(".item-card");
      for (var i = 0; i < cards.length; i++) {
        var id = cards[i].dataset.id;
        var it = null; for (var j = 0; j < slice.length; j++) if (slice[j].id === id) { it = slice[j]; break; }
        if (it) { var qel = cards[i].querySelector(".item-qty"); if (qel) qel.textContent = it.size > 0 ? formatNum(it.size) : (it.isCraftable ? "craft" : "0"); }
      }
    } else {
      renderPage._fp = newFp;
      if (!state.items.length && !state.online) {
        els.itemsGrid.innerHTML = ""; if (els.emptyState) { els.emptyState.hidden = false; els.emptyState.textContent = state.error ? ("Ошибка: " + state.error) : (cfg.gistId ? "МЭ пуста или OC не отправил данные" : "Укажи Gist в Settings"); }
      } else if (!slice.length) {
        els.itemsGrid.innerHTML = ""; if (els.emptyState) { els.emptyState.hidden = false; els.emptyState.textContent = (state.items || []).length ? "Ничего не найдено (сними фильтры)" : "Ничего не найдено"; }
      } else {
        els.itemsGrid.innerHTML = slice.map(function (i) { return renderItemCard(i); }).join(""); if (els.emptyState) els.emptyState.hidden = true;
      }
    }
    var info = $("#pageInfo"), totalEl = $("#pageTotal"), prev = $("#pagePrev"), next = $("#pageNext");
    if (info) info.textContent = (page + 1) + " / " + pages;
    if (totalEl) totalEl.textContent = total ? (total + " items") : "";
    if (prev) prev.disabled = page <= 0; if (next) next.disabled = page >= pages - 1;
    var pager = $("#pager"); if (pager) pager.style.display = total ? "flex" : "none";
  }
  function renderCraftables(force) {
    if (!els.craftGrid) return;
    var map = {}; (state.craftables || []).forEach(function (i) { map[i.id] = i; });
    (state.items || []).forEach(function (i) { if (i.isCraftable && !map[i.id]) map[i.id] = Object.assign({}, i, { size: 0 }); });
    var list = Object.keys(map).map(function (k) { return map[k]; });
    list.sort(function (a, b) { return prettyName(a).localeCompare(prettyName(b)); });
    var fp = list.map(function (i) { return i.id; }).join("|");
    if (!force && fp === renderCraftables._fp) return; renderCraftables._fp = fp;
    if (!list.length) {
      els.craftGrid.innerHTML = '<div class="empty-tab">Нет craftables в МЭ.<br><span style="opacity:.7">Закодированные шаблоны должны стоять в <b>ME Interface</b> (слоты pattern), не просто лежать в сети.</span></div>';
      return;
    }
    els.craftGrid.innerHTML = list.slice(0, 120).map(function (i) { return renderItemCard(i, { showCraftDot: false }); }).join("");
  }
  function renderCpus(force) {
    if (!els.cpusList) return;
    var cpus = state.cpus || [], fp = fpCpus(cpus);
    if (!force && fp === renderCpus._fp) return; renderCpus._fp = fp;
    if (!cpus.length) { els.cpusList.innerHTML = '<div class="empty-tab">Нет crafting CPU</div>'; return; }
    els.cpusList.innerHTML = cpus.map(function (c, idx) {
      return '<div class="cpu-card"><div class="cpu-header"><span class="cpu-name">' + (c.name || ("CPU-" + (idx + 1))) + '</span><span class="cpu-badge ' + (c.busy ? "busy" : "free") + '">' + (c.busy ? "Busy" : "Free") + '</span></div><div class="cpu-meta">' + formatNum(c.storage) + " bytes · " + (c.coprocessors || 0) + " coprocessors</div></div>";
    }).join("");
  }
  function renderNetwork(force) {
    if (!els.networkCards) return;
    var p = state.power || {};
    var fp = (state.online ? 1 : 0) + ":" + (p.stored || 0) + ":" + (state.items || []).length + ":" + (state.craftables || []).length;
    if (!force && fp === renderNetwork._fp) return; renderNetwork._fp = fp;
    var cards = [
      { label: "Статус", value: state.online ? "Live · Gist" : (state.error ? "Ошибка" : "Offline") },
      { label: "Power", value: formatNum(p.stored) + " / " + formatNum(p.max) + " AE" },
      { label: "Items", value: formatNum((state.items || []).length) },
      { label: "Craftables", value: formatNum((state.craftables || []).length) },
      { label: "CPUs", value: formatNum((state.cpus || []).length) },
      { label: "Updated", value: state.updated ? String(state.updated) : "—" },
      { label: "User", value: session ? (session.login + " (" + session.role + ")") : "—" },
      { label: "Gist", value: cfg.gistUser && cfg.gistId ? (cfg.gistUser + " / " + cfg.gistId.slice(0, 8) + "…") : "не задан" }
    ];
    if (state.error) cards.push({ label: "Ошибка", value: state.error });
    els.networkCards.innerHTML = cards.map(function (c) { return '<div class="net-card"><div class="net-card-label">' + c.label + '</div><div class="net-card-value">' + c.value + "</div></div>"; }).join("");
  }
  function updateHeader() {
    var p = state.power || {};
    if (els.powerValue) els.powerValue.textContent = p.stored != null ? formatNum(p.stored) + " / " + formatNum(p.max) : "—";
    if (els.itemCount) els.itemCount.textContent = formatNum((state.items || []).length);
    var cpus = state.cpus || [];
    if (els.cpuCount) els.cpuCount.textContent = cpus.filter(function (c) { return !c.busy; }).length + "/" + cpus.length;
    if (els.connStatus) els.connStatus.innerHTML = state.online ? '<span class="dot online"></span> Live' : '<span class="dot offline"></span> ' + (state.error ? "Error" : "Offline");
  }
  function populateModFilter() {
    if (!els.modFilter) return;
    var cur = els.modFilter.value, mods = [], seen = {};
    (state.items || []).forEach(function (i) { if (i.mod && !seen[i.mod]) { seen[i.mod] = true; mods.push(i.mod); } });
    mods.sort();
    var html = '<option value="">Все моды</option>' + mods.map(function (m) { return '<option value="' + m + '">' + m + "</option>"; }).join("");
    if (els.modFilter.innerHTML !== html) { els.modFilter.innerHTML = html; if (cur) els.modFilter.value = cur; }
  }
  function smartRender(force) {
    var itemsFp = fpItems(state.items), craftFp = fpItems(state.craftables), cpusFp = fpCpus(state.cpus);
    var powerFp = String((state.power || {}).stored) + "/" + String((state.power || {}).max);
    var itemsChanged = force || filterDirty || itemsFp !== prevFp.items;
    var craftChanged = force || craftFp !== prevFp.craftables;
    var cpusChanged = force || cpusFp !== prevFp.cpus;
    var powerChanged = force || powerFp !== prevFp.power;
    if (itemsChanged) { populateModFilter(); renderPage(force || filterDirty); filterDirty = false; prevFp.items = itemsFp; }
    else renderPage(false);
    if (craftChanged) { renderCraftables(true); prevFp.craftables = craftFp; }
    if (cpusChanged) { renderCpus(true); prevFp.cpus = cpusFp; }
    if (powerChanged || itemsChanged || craftChanged || cpusChanged) { renderNetwork(true); updateHeader(); prevFp.power = powerFp; }
  }
  function openCraftModal(item) {
    if (!canCraft()) { showToast("Нет прав"); return; }
    if (!item || !item.isCraftable) { showToast("Нет шаблона крафта"); return; }
    currentCraftItem = item;
    if (els.craftPreview) els.craftPreview.innerHTML = iconHtml(item) + '<div class="info"><div class="name">' + prettyName(item) + '</div><div class="id">' + item.id + "</div></div>";
    if (els.craftQty) els.craftQty.value = 1;
    if (els.craftModal) { els.craftModal.hidden = false; els.craftModal.style.display = "grid"; }
  }
  function closeCraftModal() { if (els.craftModal) { els.craftModal.hidden = true; els.craftModal.style.display = "none"; } currentCraftItem = null; }
  function stateUrl() { if (!cfg.gistUser || !cfg.gistId) return null; return "https://gist.githubusercontent.com/" + cfg.gistUser + "/" + cfg.gistId + "/raw/me_state.json?t=" + Date.now(); }
  function queueUrl() { if (!cfg.gistUser || !cfg.gistId) return null; return "https://gist.githubusercontent.com/" + cfg.gistUser + "/" + cfg.gistId + "/raw/craft_queue.json?t=" + Date.now(); }
  function gistApiUrl() { return cfg.gistId ? "https://api.github.com/gists/" + cfg.gistId : null; }
  async function submitCraft() {
    if (!currentCraftItem || !canCraft()) return;
    var qty = Math.max(1, parseInt(els.craftQty && els.craftQty.value, 10) || 1);
    var id = currentCraftItem.id, label = prettyName(currentCraftItem);
    if (!cfg.token || !cfg.gistId) { showToast("Нужен Token в Settings"); closeCraftModal(); openSettings(); return; }
    try {
      var queue = [];
      try { var r = await fetch(queueUrl()); if (r.ok) { queue = JSON.parse((await r.text()) || "[]"); if (!Array.isArray(queue)) queue = []; } } catch (e) {}
      queue.push({ id: id, amount: qty, label: label, by: session.login, ts: Date.now() });
      var res = await fetch(gistApiUrl(), { method: "PATCH", headers: { Authorization: "token " + cfg.token, Accept: "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify({ files: { "craft_queue.json": { content: JSON.stringify(queue, null, 2) } } }) });
      if (!res.ok) throw new Error(res.status + " " + (await res.text()).slice(0, 100));
      showToast("В очередь: " + qty + "× " + label);
    } catch (e) { showToast("Ошибка: " + e.message); }
    closeCraftModal();
  }
  async function loadFromGist() {
    var url = stateUrl(); if (!url) { state.error = "Gist не настроен"; return false; }
    try {
      var res = await fetch(url, { cache: "no-store" }); if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      var items = (data.items || []).map(function (i) { return { id: i.id || "?", label: i.label || "", size: Number(i.size) || 0, isCraftable: !!i.isCraftable, mod: i.mod || (i.id || "").split(":")[0] || "?", icon: i.icon || null }; });
      state = { items: items, craftables: data.craftables || items.filter(function (i) { return i.isCraftable; }), cpus: data.cpus || [], power: data.power || {}, online: true, updated: data.updated || null, error: null };
      return true;
    } catch (e) { state.online = false; state.error = e.message || String(e); return false; }
  }
  async function refresh(force) { if (!isLoggedIn()) return; await loadFromGist(); if (force) page = 0; smartRender(!!force); }
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    var sec = Math.max(8, parseInt(cfg.pollSec, 10) || 12);
    pollTimer = setInterval(function () { if (isLoggedIn() && cfg.gistId && cfg.gistUser) refresh(false); }, sec * 1000);
  }
  function openSettings() {
    if (!isLoggedIn()) return;
    if (els.cfgGistUser) els.cfgGistUser.value = cfg.gistUser || "";
    if (els.cfgGistId) els.cfgGistId.value = cfg.gistId || "";
    if (els.cfgToken) els.cfgToken.value = cfg.token || "";
    if (els.cfgPoll) els.cfgPoll.value = cfg.pollSec || 12;
    if (els.settingsModal) { els.settingsModal.hidden = false; els.settingsModal.style.display = "grid"; }
  }
  function closeSettings() { if (els.settingsModal) { els.settingsModal.hidden = true; els.settingsModal.style.display = "none"; } }
  function saveSettings() {
    try {
      cfg.gistUser = ((els.cfgGistUser && els.cfgGistUser.value) || "").trim();
      cfg.gistId = ((els.cfgGistId && els.cfgGistId.value) || "").trim();
      cfg.token = ((els.cfgToken && els.cfgToken.value) || "").trim();
      cfg.pollSec = Math.max(8, parseInt(els.cfgPoll && els.cfgPoll.value, 10) || 12);
      saveCfg(cfg); closeSettings(); showToast("Сохранено"); startPolling(); refresh(true);
    } catch (e) { showToast("Ошибка: " + e.message); closeSettings(); }
  }
  function bindEvents() {
    if (els.btnLogin) els.btnLogin.addEventListener("click", tryLogin);
    if (els.loginPass) els.loginPass.addEventListener("keydown", function (e) { if (e.key === "Enter") tryLogin(); });
    $$(".tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!isLoggedIn()) return;
        $$(".tab").forEach(function (t) { t.classList.remove("active"); });
        $$(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active"); var panel = $("#tab-" + btn.dataset.tab); if (panel) panel.classList.add("active");
      });
    });
    function onFilter() { filterDirty = true; page = 0; renderPage(true); }
    [els.search, els.onlyCraftable, els.onlyStock, els.modFilter, els.sortBy].forEach(function (el) { if (!el) return; el.addEventListener("input", onFilter); el.addEventListener("change", onFilter); });
    if (els.clearSearch) els.clearSearch.addEventListener("click", function () { if (els.search) els.search.value = ""; onFilter(); });
    document.addEventListener("click", function (e) {
      if (e.target && e.target.id === "pagePrev") { page = Math.max(0, page - 1); renderPage(true); }
      if (e.target && e.target.id === "pageNext") { page = page + 1; renderPage(true); }
    });
    function handleCard(e) {
      if (!isLoggedIn()) return;
      var card = e.target.closest(".item-card"); if (!card) return;
      var id = card.dataset.id;
      var item = null;
      var arr = state.items || []; for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { item = arr[i]; break; }
      if (!item) { arr = state.craftables || []; for (var j = 0; j < arr.length; j++) if (arr[j].id === id) { item = arr[j]; break; } }
      if (item && item.isCraftable) openCraftModal(item);
      else if (item) showToast(prettyName(item) + " · " + formatNum(item.size));
    }
    if (els.itemsGrid) els.itemsGrid.addEventListener("click", handleCard);
    if (els.craftGrid) els.craftGrid.addEventListener("click", handleCard);
    var closeModal = $("#closeModal"); if (closeModal) closeModal.addEventListener("click", closeCraftModal);
    var cancelCraft = $("#cancelCraft"); if (cancelCraft) cancelCraft.addEventListener("click", closeCraftModal);
    var confirmCraft = $("#confirmCraft"); if (confirmCraft) confirmCraft.addEventListener("click", submitCraft);
    if (els.craftModal) els.craftModal.addEventListener("click", function (e) { if (e.target === els.craftModal) closeCraftModal(); });
    $$(".qty-btn").forEach(function (btn) { btn.addEventListener("click", function () { var d = parseInt(btn.dataset.d, 10); if (els.craftQty) els.craftQty.value = Math.max(1, (parseInt(els.craftQty.value, 10) || 1) + d); }); });
    $$(".qty-presets button").forEach(function (btn) { btn.addEventListener("click", function () { if (els.craftQty) els.craftQty.value = btn.dataset.q; }); });
    var btnSettings = $("#btnSettings"); if (btnSettings) btnSettings.addEventListener("click", openSettings);
    var btnLogout = $("#btnLogout"); if (btnLogout) btnLogout.addEventListener("click", logout);
    var closeSettingsBtn = $("#closeSettings"); if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", closeSettings);
    var saveSettingsBtn = $("#saveSettings"); if (saveSettingsBtn) saveSettingsBtn.addEventListener("click", saveSettings);
    var cancelSettings = $("#cancelSettings"); if (cancelSettings) cancelSettings.addEventListener("click", closeSettings);
    if (els.settingsModal) els.settingsModal.addEventListener("click", function (e) { if (e.target === els.settingsModal) closeSettings(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeCraftModal(); closeSettings(); } });
  }
  async function init() {
    cacheEls(); await Promise.all([loadUsers(), loadRuNames()]); bindEvents(); applyAuthUI(); ensurePager();
    if (isLoggedIn()) { await refresh(true); startPolling(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
