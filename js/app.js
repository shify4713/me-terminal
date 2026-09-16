(() => {
  "use strict";

  var STORAGE_KEY = "me_terminal_cfg";
  var SESSION_KEY = "me_terminal_session";
  var PAGE_SIZE = 48;

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveCfg(c) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
    catch (e) { return null; }
  }
  function saveSession(s) {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  }

  var cfg = Object.assign({ gistUser: "", gistId: "", token: "", pollSec: 12 }, loadCfg());
  var session = loadSession();
  var usersList = [];
  var state = { items: [], craftables: [], cpus: [], power: {}, online: false, updated: null, error: null };
  var currentCraftItem = null;
  var pollTimer = null;
  var page = 0;
  var filteredItems = [];

  var DEFAULT_USERS = [
    { login: "LiwMorgan", password: "change_me_admin", role: "admin" },
    { login: "teammate1", password: "change_me_1", role: "user" },
    { login: "teammate2", password: "change_me_2", role: "user" }
  ];

  function appBase() {
    var path = location.pathname || "/";
    if (path.indexOf(".html") !== -1) path = path.replace(/\/[^\/]*$/, "/");
    else if (path.charAt(path.length - 1) !== "/") path = path + "/";
    return path;
  }

  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }

  var els = {};
  function cacheEls() {
    els = {
      search: $("#search"),
      clearSearch: $("#clearSearch"),
      onlyCraftable: $("#onlyCraftable"),
      onlyStock: $("#onlyStock"),
      modFilter: $("#modFilter"),
      sortBy: $("#sortBy"),
      itemsGrid: $("#itemsGrid"),
      craftGrid: $("#craftGrid"),
      cpusList: $("#cpusList"),
      networkCards: $("#networkCards"),
      emptyState: $("#emptyState"),
      powerValue: $("#powerValue"),
      itemCount: $("#itemCount"),
      cpuCount: $("#cpuCount"),
      connStatus: $("#connStatus"),
      craftModal: $("#craftModal"),
      craftPreview: $("#craftPreview"),
      craftQty: $("#craftQty"),
      toast: $("#toast"),
      settingsModal: $("#settingsModal"),
      cfgGistUser: $("#cfgGistUser"),
      cfgGistId: $("#cfgGistId"),
      cfgToken: $("#cfgToken"),
      cfgPoll: $("#cfgPoll"),
      loginOverlay: $("#loginOverlay"),
      loginUser: $("#loginUser"),
      loginPass: $("#loginPass"),
      loginError: $("#loginError"),
      btnLogin: $("#btnLogin")
    };
  }

  function ensurePager() {
    if ($("#pager")) return;
    var grid = els.itemsGrid;
    if (!grid || !grid.parentNode) return;
    var pager = document.createElement("div");
    pager.id = "pager";
    pager.className = "pager";
    pager.innerHTML = '<button type="button" class="btn secondary" id="pagePrev">←</button>' +
      '<span id="pageInfo">1 / 1</span>' +
      '<button type="button" class="btn secondary" id="pageNext">→</button>' +
      '<span id="pageTotal" class="pager-total"></span>';
    grid.parentNode.insertBefore(pager, grid.nextSibling);
  }

  async function loadUsers() {
    usersList = DEFAULT_USERS.slice();
    try {
      var res = await fetch(appBase() + "data/users.json", { cache: "no-store" });
      if (!res.ok) throw new Error("no");
      var data = await res.json();
      if (data && data.users && data.users.length) usersList = data.users;
    } catch (e) {}
  }

  function isLoggedIn() { return !!(session && session.login); }
  function canCraft() { return isLoggedIn() && (session.role === "admin" || session.role === "user"); }

  function applyAuthUI() {
    if (isLoggedIn()) {
      document.body.classList.remove("locked");
      if (els.loginOverlay) {
        els.loginOverlay.hidden = true;
        els.loginOverlay.style.display = "none";
      }
    } else {
      document.body.classList.add("locked");
      if (els.loginOverlay) {
        els.loginOverlay.hidden = false;
        els.loginOverlay.style.display = "";
      }
    }
  }

  function showLoginError(msg) {
    if (!els.loginError) return;
    els.loginError.textContent = msg || "Неверный логин или пароль";
    els.loginError.hidden = false;
    els.loginError.style.display = "block";
  }

  function tryLogin() {
    try {
      if (!usersList.length) usersList = DEFAULT_USERS.slice();
      var login = ((els.loginUser && els.loginUser.value) || "").trim();
      var pass = ((els.loginPass && els.loginPass.value) || "").trim();
      if (!login || !pass) {
        showLoginError("Введите логин и пароль");
        return;
      }
      var user = null;
      for (var i = 0; i < usersList.length; i++) {
        if (usersList[i].login === login && String(usersList[i].password) === String(pass)) {
          user = usersList[i];
          break;
        }
      }
      if (!user) {
        showLoginError("Неверный логин или пароль");
        return;
      }
      if (els.loginError) {
        els.loginError.hidden = true;
        els.loginError.style.display = "none";
      }
      session = { login: user.login, role: user.role || "user" };
      saveSession(session);
      applyAuthUI();
      showToast("Привет, " + session.login);
      refresh();
      startPolling();
    } catch (err) {
      showLoginError("Ошибка: " + (err.message || err));
    }
  }

  function logout() {
    session = null;
    saveSession(null);
    applyAuthUI();
    showToast("Вышли");
  }

  function formatNum(n) {
    if (n == null || n === "") return "—";
    n = Number(n);
    if (isNaN(n)) return "—";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e4) return (n / 1e3).toFixed(1) + "k";
    if (n >= 1e3) return (n / 1e3).toFixed(2) + "k";
    return String(n);
  }

  function modColor(mod) {
    var h = 0;
    mod = mod || "x";
    for (var i = 0; i < mod.length; i++) h = (h * 31 + mod.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + " 55% 42%)";
  }

  function iconHtml(item) {
    var name = (item.label || (item.id || "?").split(":").pop() || "?").slice(0, 2).toUpperCase();
    if (item.icon) {
      return '<img class="item-icon" src="' + appBase() + "icons/" + item.icon +
        '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\'"/>' +
        '<div class="item-placeholder" style="display:none;background:' + modColor(item.mod) + '">' + name + "</div>";
    }
    return '<div class="item-placeholder" style="background:' + modColor(item.mod) + '">' + name + "</div>";
  }

  function shortName(item) {
    if (item.label) return item.label;
    var raw = (item.id || "").split(":").pop() || item.id || "?";
    return raw.replace(/[._]/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, 18);
  }

  function showToast(msg, ms) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.hidden = false;
    els.toast.style.display = "";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { els.toast.hidden = true; }, ms || 2800);
  }

  function renderItemCard(item, opts) {
    opts = opts || {};
    var craftable = !!item.isCraftable;
    var qty = item.size || 0;
    var extra = (craftable && opts.showCraftDot !== false) ? " craftable" : "";
    var title = (item.id || "") + " | qty " + qty + (craftable ? " | craftable" : "");
    var qtyText = qty > 0 ? formatNum(qty) : (craftable ? "craft" : "0");
    return '<div class="item-card' + extra + '" data-id="' + (item.id || "") + '" title="' + title.replace(/"/g, "") + '">' +
      iconHtml(item) +
      '<div class="item-qty">' + qtyText + "</div>" +
      '<div class="item-name">' + shortName(item) + "</div></div>";
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
    if (q) {
      list = list.filter(function (i) {
        return (i.id || "").toLowerCase().indexOf(q) >= 0 ||
          (i.label || "").toLowerCase().indexOf(q) >= 0 ||
          (i.mod || "").toLowerCase().indexOf(q) >= 0;
      });
    }
    list.sort(function (a, b) {
      if (sort === "qty-desc") return (b.size || 0) - (a.size || 0);
      if (sort === "qty-asc") return (a.size || 0) - (b.size || 0);
      if (sort === "mod") return (a.mod || "").localeCompare(b.mod || "") || shortName(a).localeCompare(shortName(b));
      return shortName(a).localeCompare(shortName(b));
    });
    filteredItems = list;
    var maxPage = Math.max(0, Math.ceil(filteredItems.length / PAGE_SIZE) - 1);
    if (page > maxPage) page = maxPage;
    if (page < 0) page = 0;
  }

  function renderPage() {
    if (!els.itemsGrid) return;
    ensurePager();
    buildFiltered();
    var total = filteredItems.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
    var start = page * PAGE_SIZE;
    var slice = filteredItems.slice(start, start + PAGE_SIZE);

    if (!state.items.length && !state.online) {
      els.itemsGrid.innerHTML = "";
      if (els.emptyState) {
        els.emptyState.hidden = false;
        els.emptyState.textContent = state.error
          ? ("Ошибка Gist: " + state.error)
          : (cfg.gistId
            ? "МЭ пуста или OC ещё не отправил данные. Запусти me_terminal.lua"
            : "Укажи Gist в Settings (username = shify4713)");
      }
    } else if (!slice.length) {
      els.itemsGrid.innerHTML = "";
      if (els.emptyState) {
        els.emptyState.hidden = false;
        els.emptyState.textContent = "Ничего не найдено";
      }
    } else {
      els.itemsGrid.innerHTML = slice.map(function (i) { return renderItemCard(i); }).join("");
      if (els.emptyState) els.emptyState.hidden = true;
    }

    var info = $("#pageInfo");
    var totalEl = $("#pageTotal");
    var prev = $("#pagePrev");
    var next = $("#pageNext");
    if (info) info.textContent = (page + 1) + " / " + pages;
    if (totalEl) totalEl.textContent = total ? (total + " items") : "";
    if (prev) prev.disabled = page <= 0;
    if (next) next.disabled = page >= pages - 1;
    var pager = $("#pager");
    if (pager) pager.style.display = total ? "flex" : "none";
  }

  function renderCraftables() {
    if (!els.craftGrid) return;
    var list = (state.craftables || []).slice().sort(function (a, b) {
      return shortName(a).localeCompare(shortName(b));
    });
    if (!list.length) {
      els.craftGrid.innerHTML = '<div class="empty-tab">Нет шаблонов крафта в МЭ</div>';
      return;
    }
    var max = 96;
    var shown = list.slice(0, max);
    var html = shown.map(function (i) { return renderItemCard(i, { showCraftDot: false }); }).join("");
    if (list.length > max) html += '<div class="empty-tab">и ещё ' + (list.length - max) + "</div>";
    els.craftGrid.innerHTML = html;
  }

  function renderCpus() {
    if (!els.cpusList) return;
    var cpus = state.cpus || [];
    if (!cpus.length) {
      els.cpusList.innerHTML = '<div class="empty-tab">Нет crafting CPU</div>';
      return;
    }
    els.cpusList.innerHTML = cpus.map(function (c) {
      var busy = c.busy;
      var pct = c.output && c.output.progress != null ? Math.round(c.output.progress * 100) : 0;
      var job = "";
      if (busy && c.output) {
        job = '<div class="cpu-job">Crafting: ' + (c.output.label || c.output.id) +
          '</div><div class="cpu-progress"><div style="width:' + pct + '%"></div></div>';
      }
      return '<div class="cpu-card"><div class="cpu-header"><span class="cpu-name">' +
        (c.name || "CPU") + '</span><span class="cpu-badge ' + (busy ? "busy" : "free") + '">' +
        (busy ? "Busy" : "Free") + '</span></div><div class="cpu-meta">' +
        (c.storage || "?") + " bytes · " + (c.coprocessors || 0) + " coprocessors</div>" + job + "</div>";
    }).join("");
  }

  function renderNetwork() {
    if (!els.networkCards) return;
    var p = state.power || {};
    var cards = [
      { label: "Статус", value: state.online ? "Live · Gist" : (state.error ? "Ошибка" : "Offline") },
      { label: "Stored Power", value: formatNum(p.stored) + " AE" },
      { label: "Max Power", value: formatNum(p.max) + " AE" },
      { label: "Items in ME", value: formatNum((state.items || []).length) },
      { label: "Craftables", value: formatNum((state.craftables || []).length) },
      { label: "Crafting CPUs", value: formatNum((state.cpus || []).length) },
      { label: "Last update", value: state.updated ? String(state.updated).replace("T", " ").replace("Z", "") : "—" },
      { label: "Logged as", value: session ? (session.login + " (" + session.role + ")") : "—" },
      { label: "Gist", value: cfg.gistUser && cfg.gistId ? (cfg.gistUser + " / " + cfg.gistId.slice(0, 8) + "…") : "не задан" }
    ];
    if (state.error) cards.push({ label: "Ошибка", value: state.error });
    els.networkCards.innerHTML = cards.map(function (c) {
      return '<div class="net-card"><div class="net-card-label">' + c.label +
        '</div><div class="net-card-value">' + c.value + "</div></div>";
    }).join("");
  }

  function updateHeader() {
    var p = state.power || {};
    if (els.powerValue) {
      els.powerValue.textContent = p.stored != null ? formatNum(p.stored) + " / " + formatNum(p.max) : "—";
    }
    if (els.itemCount) els.itemCount.textContent = formatNum((state.items || []).length);
    var cpus = state.cpus || [];
    if (els.cpuCount) {
      els.cpuCount.textContent = cpus.filter(function (c) { return !c.busy; }).length + "/" + cpus.length;
    }
    if (els.connStatus) {
      els.connStatus.innerHTML = state.online
        ? '<span class="dot online"></span> Live'
        : '<span class="dot offline"></span> ' + (state.error ? "Error" : "Offline");
    }
  }

  function populateModFilter() {
    if (!els.modFilter) return;
    var cur = els.modFilter.value;
    var mods = [];
    var seen = {};
    (state.items || []).forEach(function (i) {
      if (i.mod && !seen[i.mod]) { seen[i.mod] = true; mods.push(i.mod); }
    });
    mods.sort();
    els.modFilter.innerHTML = '<option value="">All mods</option>' +
      mods.map(function (m) { return '<option value="' + m + '">' + m + "</option>"; }).join("");
    if (cur) els.modFilter.value = cur;
  }

  function fullRender() {
    populateModFilter();
    renderPage();
    renderCraftables();
    renderCpus();
    renderNetwork();
    updateHeader();
  }

  function openCraftModal(item) {
    if (!canCraft()) { showToast("Нет прав на крафт"); return; }
    if (!item || !item.isCraftable) { showToast("Нет шаблона крафта"); return; }
    currentCraftItem = item;
    if (els.craftPreview) {
      els.craftPreview.innerHTML = iconHtml(item) +
        '<div class="info"><div class="name">' + shortName(item) +
        '</div><div class="id">' + item.id + "</div></div>";
    }
    if (els.craftQty) els.craftQty.value = 1;
    if (els.craftModal) {
      els.craftModal.hidden = false;
      els.craftModal.style.display = "grid";
    }
  }

  function closeCraftModal() {
    if (els.craftModal) {
      els.craftModal.hidden = true;
      els.craftModal.style.display = "none";
    }
    currentCraftItem = null;
  }

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

  async function submitCraft() {
    if (!currentCraftItem || !canCraft()) return;
    var qty = Math.max(1, parseInt(els.craftQty && els.craftQty.value, 10) || 1);
    var id = currentCraftItem.id;
    var label = shortName(currentCraftItem);
    if (!cfg.token || !cfg.gistId) {
      showToast("Нужен Token в Settings");
      closeCraftModal();
      openSettings();
      return;
    }
    try {
      var queue = [];
      try {
        var r = await fetch(queueUrl());
        if (r.ok) {
          queue = JSON.parse((await r.text()) || "[]");
          if (!Array.isArray(queue)) queue = [];
        }
      } catch (e) {}
      queue.push({ id: id, amount: qty, label: label, by: session.login, ts: Date.now() });
      var res = await fetch(gistApiUrl(), {
        method: "PATCH",
        headers: {
          Authorization: "token " + cfg.token,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ files: { "craft_queue.json": { content: JSON.stringify(queue, null, 2) } } })
      });
      if (!res.ok) throw new Error(res.status + " " + (await res.text()).slice(0, 100));
      showToast("В очередь: " + qty + "× " + label);
    } catch (e) {
      showToast("Ошибка: " + e.message);
    }
    closeCraftModal();
  }

  async function loadFromGist() {
    var url = stateUrl();
    if (!url) {
      state.error = "Gist не настроен";
      return false;
    }
    try {
      var res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status + " (проверь username/Gist ID)");
      var data = await res.json();
      state = {
        items: data.items || [],
        craftables: data.craftables || (data.items || []).filter(function (i) { return i.isCraftable; }),
        cpus: data.cpus || [],
        power: data.power || {},
        online: true,
        updated: data.updated || null,
        error: null
      };
      return true;
    } catch (e) {
      state.online = false;
      state.error = e.message || String(e);
      return false;
    }
  }

  async function refresh() {
    if (!isLoggedIn()) return;
    await loadFromGist();
    page = 0;
    fullRender();
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    var sec = Math.max(8, parseInt(cfg.pollSec, 10) || 12);
    pollTimer = setInterval(function () {
      if (isLoggedIn() && cfg.gistId && cfg.gistUser) refresh();
    }, sec * 1000);
  }

  function openSettings() {
    if (!isLoggedIn()) return;
    if (els.cfgGistUser) els.cfgGistUser.value = cfg.gistUser || "";
    if (els.cfgGistId) els.cfgGistId.value = cfg.gistId || "";
    if (els.cfgToken) els.cfgToken.value = cfg.token || "";
    if (els.cfgPoll) els.cfgPoll.value = cfg.pollSec || 12;
    if (els.settingsModal) {
      els.settingsModal.hidden = false;
      els.settingsModal.style.display = "grid";
    }
  }

  function closeSettings() {
    if (els.settingsModal) {
      els.settingsModal.hidden = true;
      els.settingsModal.style.display = "none";
    }
  }

  function saveSettings() {
    try {
      cfg.gistUser = ((els.cfgGistUser && els.cfgGistUser.value) || "").trim();
      cfg.gistId = ((els.cfgGistId && els.cfgGistId.value) || "").trim();
      cfg.token = ((els.cfgToken && els.cfgToken.value) || "").trim();
      cfg.pollSec = Math.max(8, parseInt(els.cfgPoll && els.cfgPoll.value, 10) || 12);
      saveCfg(cfg);
      closeSettings();
      showToast("Сохранено · " + (cfg.gistUser || "?") + " / " + (cfg.gistId ? cfg.gistId.slice(0, 8) + "…" : "нет gist"));
      startPolling();
      refresh();
    } catch (e) {
      showToast("Ошибка: " + e.message);
      closeSettings();
    }
  }

  function bindEvents() {
    if (els.btnLogin) els.btnLogin.addEventListener("click", tryLogin);
    if (els.loginPass) {
      els.loginPass.addEventListener("keydown", function (e) {
        if (e.key === "Enter") tryLogin();
      });
    }
    if (els.loginUser) {
      els.loginUser.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && els.loginPass) els.loginPass.focus();
      });
    }

    $$(".tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!isLoggedIn()) return;
        $$(".tab").forEach(function (t) { t.classList.remove("active"); });
        $$(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        var panel = $("#tab-" + btn.dataset.tab);
        if (panel) panel.classList.add("active");
      });
    });

    function onFilter() { page = 0; renderPage(); }
    [els.search, els.onlyCraftable, els.onlyStock, els.modFilter, els.sortBy].forEach(function (el) {
      if (!el) return;
      el.addEventListener("input", onFilter);
      el.addEventListener("change", onFilter);
    });
    if (els.clearSearch) {
      els.clearSearch.addEventListener("click", function () {
        if (els.search) els.search.value = "";
        onFilter();
      });
    }

    document.addEventListener("click", function (e) {
      if (e.target && e.target.id === "pagePrev") {
        page = Math.max(0, page - 1);
        renderPage();
      }
      if (e.target && e.target.id === "pageNext") {
        page = page + 1;
        renderPage();
      }
    });

    function handleCard(e) {
      if (!isLoggedIn()) return;
      var card = e.target.closest(".item-card");
      if (!card) return;
      var id = card.dataset.id;
      var item = (state.items || []).find(function (i) { return i.id === id; }) ||
        (state.craftables || []).find(function (i) { return i.id === id; });
      if (item && item.isCraftable) openCraftModal(item);
    }
    if (els.itemsGrid) els.itemsGrid.addEventListener("click", handleCard);
    if (els.craftGrid) els.craftGrid.addEventListener("click", handleCard);

    var closeModal = $("#closeModal");
    if (closeModal) closeModal.addEventListener("click", closeCraftModal);
    var cancelCraft = $("#cancelCraft");
    if (cancelCraft) cancelCraft.addEventListener("click", closeCraftModal);
    var confirmCraft = $("#confirmCraft");
    if (confirmCraft) confirmCraft.addEventListener("click", submitCraft);
    if (els.craftModal) {
      els.craftModal.addEventListener("click", function (e) {
        if (e.target === els.craftModal) closeCraftModal();
      });
    }

    $$(".qty-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var d = parseInt(btn.dataset.d, 10);
        if (els.craftQty) els.craftQty.value = Math.max(1, (parseInt(els.craftQty.value, 10) || 1) + d);
      });
    });
    $$(".qty-presets button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (els.craftQty) els.craftQty.value = btn.dataset.q;
      });
    });

    var btnSettings = $("#btnSettings");
    if (btnSettings) btnSettings.addEventListener("click", openSettings);
    var btnLogout = $("#btnLogout");
    if (btnLogout) btnLogout.addEventListener("click", logout);
    var closeSettingsBtn = $("#closeSettings");
    if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", closeSettings);
    var saveSettingsBtn = $("#saveSettings");
    if (saveSettingsBtn) saveSettingsBtn.addEventListener("click", saveSettings);
    var cancelSettings = $("#cancelSettings");
    if (cancelSettings) cancelSettings.addEventListener("click", closeSettings);
    if (els.settingsModal) {
      els.settingsModal.addEventListener("click", function (e) {
        if (e.target === els.settingsModal) closeSettings();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeCraftModal();
        closeSettings();
      }
    });
  }

  async function init() {
    cacheEls();
    await loadUsers();
    bindEvents();
    applyAuthUI();
    ensurePager();
    if (isLoggedIn()) {
      await refresh();
      startPolling();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
