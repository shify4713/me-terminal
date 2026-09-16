(() => {
  "use strict";
  const STORAGE_KEY = "me_terminal_cfg";
  const SESSION_KEY = "me_terminal_session";
  function loadCfg() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; } }
  function saveCfg(cfg) { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } }
  function saveSession(s) { if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); else sessionStorage.removeItem(SESSION_KEY); }
  let cfg = Object.assign({ gistUser: "", gistId: "", token: "", pollSec: 12 }, loadCfg());
  let session = loadSession();
  let usersList = [];
  function appBase() {
    var path = location.pathname || "/";
    if (path.indexOf(".html") !== -1) path = path.replace(/\/[^\/]*$/, "/");
    else if (path.charAt(path.length - 1) !== "/") path = path + "/";
    return path;
  }
  var DEFAULT_USERS = [
    { login: "LiwMorgan", password: "change_me_admin", role: "admin" },
    { login: "teammate1", password: "change_me_1", role: "user" },
    { login: "teammate2", password: "change_me_2", role: "user" }
  ];
  function stateUrl() {
    if (!cfg.gistUser || !cfg.gistId) return null;
    return "https://gist.githubusercontent.com/" + cfg.gistUser + "/" + cfg.gistId + "/raw/me_state.json?t=" + Date.now();
  }
  function queueUrl() {
    if (!cfg.gistUser || !cfg.gistId) return null;
    return "https://gist.githubusercontent.com/" + cfg.gistUser + "/" + cfg.gistId + "/raw/craft_queue.json?t=" + Date.now();
  }
  function gistApiUrl() {
    if (!cfg.gistId) return null;
    return "https://api.github.com/gists/" + cfg.gistId;
  }
  let state = { items: [], craftables: [], cpus: [], power: {}, online: false, updated: null };
  let currentCraftItem = null;
  let pollTimer = null;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  let els = {};
  function cacheEls() {
    els = {
      search: $("#search"), clearSearch: $("#clearSearch"), onlyCraftable: $("#onlyCraftable"), onlyStock: $("#onlyStock"),
      modFilter: $("#modFilter"), sortBy: $("#sortBy"), itemsGrid: $("#itemsGrid"), craftGrid: $("#craftGrid"),
      cpusList: $("#cpusList"), networkCards: $("#networkCards"), emptyState: $("#emptyState"),
      powerValue: $("#powerValue"), itemCount: $("#itemCount"), cpuCount: $("#cpuCount"), connStatus: $("#connStatus"),
      craftModal: $("#craftModal"), craftPreview: $("#craftPreview"), craftQty: $("#craftQty"), toast: $("#toast"),
      settingsModal: $("#settingsModal"), cfgGistUser: $("#cfgGistUser"), cfgGistId: $("#cfgGistId"),
      cfgToken: $("#cfgToken"), cfgPoll: $("#cfgPoll"), loginOverlay: $("#loginOverlay"),
      loginUser: $("#loginUser"), loginPass: $("#loginPass"), loginError: $("#loginError"), btnLogin: $("#btnLogin")
    };
  }
  async function loadUsers() {
    usersList = DEFAULT_USERS.slice();
    try {
      var res = await fetch(appBase() + "data/users.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      if (data && Array.isArray(data.users) && data.users.length) usersList = data.users;
    } catch (e) { console.warn("users.json fallback", e); }
  }
  function isLoggedIn() { return !!(session && session.login); }
  function canCraft() { return isLoggedIn() && (session.role === "admin" || session.role === "user"); }
  function applyAuthUI() {
    if (isLoggedIn()) {
      document.body.classList.remove("locked");
      if (els.loginOverlay) { els.loginOverlay.hidden = true; els.loginOverlay.style.display = "none"; }
    } else {
      document.body.classList.add("locked");
      if (els.loginOverlay) { els.loginOverlay.hidden = false; els.loginOverlay.style.display = ""; }
    }
  }
  function showLoginError(msg) {
    if (!els.loginError) return;
    els.loginError.textContent = msg || "Неверный логин или пароль";
    els.loginError.hidden = false;
    els.loginError.style.display = "block";
  }
  function hideLoginError() {
    if (!els.loginError) return;
    els.loginError.hidden = true;
    els.loginError.style.display = "none";
  }
  function tryLogin() {
    try {
      if (!usersList || !usersList.length) usersList = DEFAULT_USERS.slice();
      var login = (els.loginUser && els.loginUser.value || "").trim();
      var pass = (els.loginPass && els.loginPass.value || "");
      if (!login || !pass) { showLoginError("Введите логин и пароль"); return; }
      var user = null;
      for (var i = 0; i < usersList.length; i++) {
        var u = usersList[i];
        if (u && u.login === login && String(u.password) === String(pass)) { user = u; break; }
      }
      if (!user) { showLoginError("Неверный логин или пароль"); return; }
      hideLoginError();
      session = { login: user.login, role: user.role || "user" };
      saveSession(session);
      applyAuthUI();
      showToast("Привет, " + session.login);
      refresh();
      startPolling();
    } catch (err) {
      console.error(err);
      showLoginError("Ошибка входа: " + (err && err.message ? err.message : err));
    }
  }
  function logout() { session = null; saveSession(null); applyAuthUI(); showToast("Вышли"); }
  function formatNum(n) {
    if (n == null) return "—";
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 10000) return (n / 1000).toFixed(1) + "k";
    if (n >= 1000) return (n / 1000).toFixed(2) + "k";
    return String(n);
  }
  function modColor(mod) {
    var h = 0;
    for (var i = 0; i < (mod || "").length; i++) h = (h * 31 + mod.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + " 55% 42%)";
  }
  function iconHtml(item) {
    if (item.icon) {
      return '<img class="item-icon" src="' + appBase() + 'icons/' + item.icon + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\'" /><div class="item-placeholder" style="display:none;background:' + modColor(item.mod) + '">' + (item.label || item.id || "?").slice(0, 2).toUpperCase() + "</div>";
    }
    var label = (item.label || (item.id || "?").split(":").pop() || "?").slice(0, 2).toUpperCase();
    return '<div class="item-placeholder" style="background:' + modColor(item.mod || "x") + '">' + label + "</div>";
  }
  function shortName(item) {
    if (item.label) return item.label;
    var raw = (item.id || "").split(":").pop() || item.id || "?";
    return raw.replace(/[._]/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); }).slice(0, 18);
  }
  function showToast(msg, ms) {
    ms = ms || 3000;
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function() { els.toast.hidden = true; }, ms);
  }
  function renderItemCard(item, opts) {
    opts = opts || {};
    var showCraftDot = opts.showCraftDot !== false;
    var craftable = !!item.isCraftable;
    var qty = item.size || 0;
    return '<div class="item-card ' + (craftable && showCraftDot ? "craftable" : "") + '" data-id="' + item.id + '" title="' + item.id + '\nQty: ' + qty + (craftable ? '\n(Craftable)' : '') + '">' + iconHtml(item) + '<div class="item-qty">' + (qty > 0 ? formatNum(qty) : (craftable ? "craft" : "0")) + '</div><div class="item-name">' + shortName(item) + '</div></div>';
  }
  function applyFilters() {
    if (!isLoggedIn() || !els.itemsGrid) return;
    var q = (els.search && els.search.value || "").trim().toLowerCase();
    var onlyCraft = els.onlyCraftable && els.onlyCraftable.checked;
    var onlyStock = els.onlyStock && els.onlyStock.checked;
    var mod = els.modFilter && els.modFilter.value;
    var sort = els.sortBy && els.sortBy.value;
    var list = (state.items || []).slice();
    if (onlyCraft) list = list.filter(function(i) { return i.isCraftable; });
    if (onlyStock) list = list.filter(function(i) { return (i.size || 0) > 0; });
    if (mod) list = list.filter(function(i) { return i.mod === mod; });
    if (q) list = list.filter(function(i) { return (i.id || "").toLowerCase().indexOf(q) >= 0 || (i.label || "").toLowerCase().indexOf(q) >= 0 || (i.mod || "").toLowerCase().indexOf(q) >= 0; });
    list.sort(function(a, b) {
      if (sort === "qty-desc") return (b.size || 0) - (a.size || 0);
      if (sort === "qty-asc") return (a.size || 0) - (b.size || 0);
      if (sort === "mod") return (a.mod || "").localeCompare(b.mod || "") || shortName(a).localeCompare(shortName(b));
      return shortName(a).localeCompare(shortName(b));
    });
    els.itemsGrid.innerHTML = list.map(function(i) { return renderItemCard(i); }).join("");
    if (els.emptyState) els.emptyState.hidden = list.length > 0;
  }
  function renderCraftables() {
    if (!isLoggedIn() || !els.craftGrid) return;
    var list = (state.craftables || []).slice().sort(function(a, b) { return shortName(a).localeCompare(shortName(b)); });
    els.craftGrid.innerHTML = list.length ? list.map(function(i) { return renderItemCard(i, { showCraftDot: false }); }).join("") : '<div class="empty">No craftable patterns</div>';
  }
  function renderCpus() {
    if (!isLoggedIn() || !els.cpusList) return;
    var cpus = state.cpus || [];
    if (!cpus.length) { els.cpusList.innerHTML = '<div class="empty">No crafting CPUs</div>'; return; }
    els.cpusList.innerHTML = cpus.map(function(c) {
      var busy = c.busy;
      var pct = c.output && c.output.progress != null ? Math.round(c.output.progress * 100) : 0;
      return '<div class="cpu-card"><div class="cpu-header"><span class="cpu-name">' + (c.name || "CPU") + '</span><span class="cpu-badge ' + (busy ? "busy" : "free") + '">' + (busy ? "Busy" : "Free") + '</span></div><div class="cpu-meta">' + (c.storage || "?") + ' bytes · ' + (c.coprocessors || 0) + ' coprocessors</div>' + (busy && c.output ? '<div class="cpu-job">Crafting: ' + (c.output.label || c.output.id) + '</div><div class="cpu-progress"><div style="width:' + pct + '%"></div></div>' : '') + '</div>';
    }).join("");
  }
  function renderNetwork() {
    if (!isLoggedIn() || !els.networkCards) return;
    var p = state.power || {};
    var cards = [
      { label: "Stored Power", value: formatNum(p.stored) + " AE" },
      { label: "Max Power", value: formatNum(p.max) + " AE" },
      { label: "Items tracked", value: formatNum((state.items || []).length) },
      { label: "Craftables", value: formatNum((state.craftables || []).length) },
      { label: "Crafting CPUs", value: formatNum((state.cpus || []).length) },
      { label: "Last update", value: state.updated ? String(state.updated).replace("T", " ").replace("Z", "") : "—" },
      { label: "Logged as", value: session ? session.login + " (" + session.role + ")" : "—" }
    ];
    els.networkCards.innerHTML = cards.map(function(c) { return '<div class="net-card"><div class="net-card-label">' + c.label + '</div><div class="net-card-value">' + c.value + '</div></div>'; }).join("");
  }
  function updateHeader() {
    var p = state.power || {};
    if (els.powerValue) els.powerValue.textContent = p.stored != null ? formatNum(p.stored) + " / " + formatNum(p.max) : "—";
    if (els.itemCount) els.itemCount.textContent = formatNum((state.items || []).length);
    var cpus = state.cpus || [];
    if (els.cpuCount) els.cpuCount.textContent = cpus.filter(function(c) { return !c.busy; }).length + "/" + cpus.length;
    if (els.connStatus) els.connStatus.innerHTML = state.online ? '<span class="dot online"></span> Live (Gist)' : '<span class="dot offline"></span> Offline / Mock';
  }
  function populateModFilter() {
    if (!els.modFilter) return;
    var mods = [], seen = {};
    (state.items || []).forEach(function(i) { if (i.mod && !seen[i.mod]) { seen[i.mod] = true; mods.push(i.mod); } });
    mods.sort();
    els.modFilter.innerHTML = '<option value="">All mods</option>' + mods.map(function(m) { return '<option value="' + m + '">' + m + '</option>'; }).join("");
  }
  function openCraftModal(item) {
    if (!canCraft()) { showToast("Нет прав на крафт"); return; }
    if (!item || !item.isCraftable) { showToast("Нет шаблона крафта"); return; }
    currentCraftItem = item;
    if (els.craftPreview) els.craftPreview.innerHTML = iconHtml(item) + '<div class="info"><div class="name">' + shortName(item) + '</div><div class="id">' + item.id + '</div></div>';
    if (els.craftQty) els.craftQty.value = 1;
    if (els.craftModal) els.craftModal.hidden = false;
  }
  function closeCraftModal() { if (els.craftModal) els.craftModal.hidden = true; currentCraftItem = null; }
  async function submitCraft() {
    if (!currentCraftItem || !canCraft()) return;
    var qty = Math.max(1, parseInt(els.craftQty && els.craftQty.value, 10) || 1);
    var id = currentCraftItem.id;
    var label = shortName(currentCraftItem);
    if (!cfg.token || !cfg.gistId) { showToast("Нужен Token в Settings"); closeCraftModal(); openSettings(); return; }
    try {
      var queue = [];
      try { var r = await fetch(queueUrl()); if (r.ok) { queue = JSON.parse(await r.text() || "[]"); if (!Array.isArray(queue)) queue = []; } } catch (_) {}
      queue.push({ id: id, amount: qty, label: label, by: session.login, ts: Date.now() });
      var res = await fetch(gistApiUrl(), { method: "PATCH", headers: { "Authorization": "token " + cfg.token, "Accept": "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify({ files: { "craft_queue.json": { content: JSON.stringify(queue, null, 2) } } }) });
      if (!res.ok) throw new Error(res.status + " " + (await res.text()).slice(0, 120));
      showToast("В очередь: " + qty + "× " + label);
    } catch (e) { showToast("Ошибка: " + e.message); console.error(e); }
    closeCraftModal();
  }
  async function loadFromGist() {
    var url = stateUrl();
    if (!url) return false;
    try {
      var res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      state = { items: data.items || [], craftables: data.craftables || (data.items || []).filter(function(i) { return i.isCraftable; }), cpus: data.cpus || [], power: data.power || {}, online: true, updated: data.updated || null };
      return true;
    } catch (e) { console.warn("Gist fetch failed", e); return false; }
  }
  async function loadMock() {
    try {
      var res = await fetch(appBase() + "data/me_state.json");
      var data = await res.json();
      state = { items: data.items || [], craftables: data.craftables || [], cpus: data.cpus || [], power: data.power || {}, online: false, updated: data.updated || null };
      return true;
    } catch { return false; }
  }
  async function refresh() {
    if (!isLoggedIn()) return;
    var ok = await loadFromGist();
    if (!ok) await loadMock();
    populateModFilter(); applyFilters(); renderCraftables(); renderCpus(); renderNetwork(); updateHeader();
  }
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    var sec = Math.max(8, parseInt(cfg.pollSec, 10) || 12);
    pollTimer = setInterval(function() { if (isLoggedIn() && cfg.gistId && cfg.gistUser) refresh(); }, sec * 1000);
  }
  function openSettings() {
    if (!isLoggedIn()) return;
    if (els.cfgGistUser) els.cfgGistUser.value = cfg.gistUser || "";
    if (els.cfgGistId) els.cfgGistId.value = cfg.gistId || "";
    if (els.cfgToken) els.cfgToken.value = cfg.token || "";
    if (els.cfgPoll) els.cfgPoll.value = cfg.pollSec || 12;
    if (els.settingsModal) els.settingsModal.hidden = false;
  }
  function closeSettings() { if (els.settingsModal) els.settingsModal.hidden = true; }
  function saveSettings() {
    cfg.gistUser = (els.cfgGistUser && els.cfgGistUser.value || "").trim();
    cfg.gistId = (els.cfgGistId && els.cfgGistId.value || "").trim();
    cfg.token = (els.cfgToken && els.cfgToken.value || "").trim();
    cfg.pollSec = Math.max(8, parseInt(els.cfgPoll && els.cfgPoll.value, 10) || 12);
    saveCfg(cfg); closeSettings(); showToast("Настройки сохранены"); startPolling(); refresh();
  }
  function bindEvents() {
    if (els.btnLogin) els.btnLogin.addEventListener("click", tryLogin);
    if (els.loginPass) els.loginPass.addEventListener("keydown", function(e) { if (e.key === "Enter") tryLogin(); });
    if (els.loginUser) els.loginUser.addEventListener("keydown", function(e) { if (e.key === "Enter" && els.loginPass) els.loginPass.focus(); });
    $$(".tab").forEach(function(btn) {
      btn.addEventListener("click", function() {
        if (!isLoggedIn()) return;
        $$(".tab").forEach(function(t) { t.classList.remove("active"); });
        $$(".tab-panel").forEach(function(p) { p.classList.remove("active"); });
        btn.classList.add("active");
        var panel = $("#tab-" + btn.dataset.tab);
        if (panel) panel.classList.add("active");
      });
    });
    [els.search, els.onlyCraftable, els.onlyStock, els.modFilter, els.sortBy].forEach(function(el) {
      if (!el) return;
      el.addEventListener("input", applyFilters);
      el.addEventListener("change", applyFilters);
    });
    if (els.clearSearch) els.clearSearch.addEventListener("click", function() { if (els.search) els.search.value = ""; applyFilters(); if (els.search) els.search.focus(); });
    function handleCard(e) {
      if (!isLoggedIn()) return;
      var card = e.target.closest(".item-card");
      if (!card) return;
      var id = card.dataset.id;
      var item = state.items.find(function(i) { return i.id === id; }) || (state.craftables || []).find(function(i) { return i.id === id; });
      if (item && item.isCraftable) openCraftModal(item);
    }
    if (els.itemsGrid) els.itemsGrid.addEventListener("click", handleCard);
    if (els.craftGrid) els.craftGrid.addEventListener("click", handleCard);
    var cm = $("#closeModal"); if (cm) cm.addEventListener("click", closeCraftModal);
    var cc = $("#cancelCraft"); if (cc) cc.addEventListener("click", closeCraftModal);
    var cf = $("#confirmCraft"); if (cf) cf.addEventListener("click", submitCraft);
    if (els.craftModal) els.craftModal.addEventListener("click", function(e) { if (e.target === els.craftModal) closeCraftModal(); });
    $$(".qty-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var d = parseInt(btn.dataset.d, 10);
        if (els.craftQty) els.craftQty.value = Math.max(1, (parseInt(els.craftQty.value, 10) || 1) + d);
      });
    });
    $$(".qty-presets button").forEach(function(btn) {
      btn.addEventListener("click", function() { if (els.craftQty) els.craftQty.value = btn.dataset.q; });
    });
    var bs = $("#btnSettings"); if (bs) bs.addEventListener("click", openSettings);
    var bl = $("#btnLogout"); if (bl) bl.addEventListener("click", logout);
    var cs = $("#closeSettings"); if (cs) cs.addEventListener("click", closeSettings);
    var ss = $("#saveSettings"); if (ss) ss.addEventListener("click", saveSettings);
    var cset = $("#cancelSettings"); if (cset) cset.addEventListener("click", closeSettings);
    if (els.settingsModal) els.settingsModal.addEventListener("click", function(e) { if (e.target === els.settingsModal) closeSettings(); });
    document.addEventListener("keydown", function(e) { if (e.key === "Escape") { closeCraftModal(); closeSettings(); } });
  }
  async function init() {
    cacheEls();
    await loadUsers();
    bindEvents();
    applyAuthUI();
    if (isLoggedIn()) { await refresh(); startPolling(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
