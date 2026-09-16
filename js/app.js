(() => {
  "use strict";

  /* =========================================================
     ME Terminal — GitHub Pages + Gist + Auth
     Main: LiwMorgan | teammates via data/users.json
     ========================================================= */

  const STORAGE_KEY = "me_terminal_cfg";
  const SESSION_KEY = "me_terminal_session";

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveCfg(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
    catch { return null; }
  }
  function saveSession(s) {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  }

  let cfg = Object.assign({
    gistUser: "",
    gistId: "",
    token: "",
    pollSec: 12
  }, loadCfg());

  let session = loadSession(); // { login, role }
  let usersList = [];

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

  let state = {
    items: [], craftables: [], cpus: [], power: {}, online: false, updated: null
  };
  let currentCraftItem = null;
  let pollTimer = null;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const els = {
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

  // ---------- Auth ----------
  async function loadUsers() {
    try {
      const res = await fetch("data/users.json", { cache: "no-store" });
      if (!res.ok) throw new Error("no users");
      const data = await res.json();
      usersList = data.users || [];
    } catch {
      // fallback hardcoded
      usersList = [
        { login: "LiwMorgan", password: "change_me_admin", role: "admin" }
      ];
    }
  }

  function isLoggedIn() {
    return !!(session && session.login);
  }

  function canCraft() {
    return isLoggedIn() && (session.role === "admin" || session.role === "user");
  }

  function applyAuthUI() {
    if (isLoggedIn()) {
      document.body.classList.remove("locked");
      if (els.loginOverlay) els.loginOverlay.hidden = true;
    } else {
      document.body.classList.add("locked");
      if (els.loginOverlay) els.loginOverlay.hidden = false;
    }
  }

  function tryLogin() {
    const login = (els.loginUser.value || "").trim();
    const pass = els.loginPass.value || "";
    const user = usersList.find(function(u) {
      return u.login === login && u.password === pass;
    });
    if (!user) {
      els.loginError.hidden = false;
      return;
    }
    els.loginError.hidden = true;
    session = { login: user.login, role: user.role || "user" };
    saveSession(session);
    applyAuthUI();
    showToast("Привет, " + session.login);
    refresh();
  }

  function logout() {
    session = null;
    saveSession(null);
    applyAuthUI();
    showToast("Вышли");
  }

  // ---------- Helpers ----------
  function formatNum(n) {
    if (n == null) return "—";
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 10000) return (n / 1000).toFixed(1) + "k";
    if (n >= 1000) return (n / 1000).toFixed(2) + "k";
    return String(n);
  }

  function modColor(mod) {
    let h = 0;
    for (let i = 0; i < (mod || "").length; i++) h = (h * 31 + mod.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + " 55% 42%)";
  }

  function iconHtml(item) {
    if (item.icon) {
      return '<img class="item-icon" src="icons/' + item.icon + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\'" />' +
        '<div class="item-placeholder" style="display:none;background:' + modColor(item.mod) + '">' +
        (item.label || item.id || "?").slice(0, 2).toUpperCase() + "</div>";
    }
    const label = (item.label || (item.id || "?").split(":").pop() || "?").slice(0, 2).toUpperCase();
    return '<div class="item-placeholder" style="background:' + modColor(item.mod || "x") + '">' + label + "</div>";
  }

  function shortName(item) {
    if (item.label) return item.label;
    const raw = (item.id || "").split(":").pop() || item.id || "?";
    return raw.replace(/[._]/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); }).slice(0, 18);
  }

  function showToast(msg, ms) {
    ms = ms || 3000;
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function() { els.toast.hidden = true; }, ms);
  }

  function renderItemCard(item, opts) {
    opts = opts || {};
    const showCraftDot = opts.showCraftDot !== false;
    const craftable = !!item.isCraftable;
    const qty = item.size || 0;
    return '<div class="item-card ' + (craftable && showCraftDot ? "craftable" : "") + '" data-id="' + item.id +
      '" title="' + item.id + "\nQty: " + qty + (craftable ? "\n(Craftable)" : "") + '">' +
      iconHtml(item) +
      '<div class="item-qty">' + (qty > 0 ? formatNum(qty) : (craftable ? "craft" : "0")) + "</div>" +
      '<div class="item-name">' + shortName(item) + "</div></div>";
  }

  function applyFilters() {
    if (!isLoggedIn()) return;
    const q = (els.search.value || "").trim().toLowerCase();
    const onlyCraft = els.onlyCraftable.checked;
    const onlyStock = els.onlyStock.checked;
    const mod = els.modFilter.value;
    const sort = els.sortBy.value;
    let list = (state.items || []).slice();
    if (onlyCraft) list = list.filter(function(i) { return i.isCraftable; });
    if (onlyStock) list = list.filter(function(i) { return (i.size || 0) > 0; });
    if (mod) list = list.filter(function(i) { return i.mod === mod; });
    if (q) {
      list = list.filter(function(i) {
        return (i.id || "").toLowerCase().indexOf(q) >= 0 ||
          (i.label || "").toLowerCase().indexOf(q) >= 0 ||
          (i.mod || "").toLowerCase().indexOf(q) >= 0;
      });
    }
    list.sort(function(a, b) {
      if (sort === "qty-desc") return (b.size || 0) - (a.size || 0);
      if (sort === "qty-asc") return (a.size || 0) - (b.size || 0);
      if (sort === "mod") return (a.mod || "").localeCompare(b.mod || "") || shortName(a).localeCompare(shortName(b));
      return shortName(a).localeCompare(shortName(b));
    });
    els.itemsGrid.innerHTML = list.map(function(i) { return renderItemCard(i); }).join("");
    els.emptyState.hidden = list.length > 0;
  }

  function renderCraftables() {
    if (!isLoggedIn()) return;
    const list = (state.craftables || []).slice().sort(function(a, b) { return shortName(a).localeCompare(shortName(b)); });
    els.craftGrid.innerHTML = list.length
      ? list.map(function(i) { return renderItemCard(i, { showCraftDot: false }); }).join("")
      : '<div class="empty">No craftable patterns</div>';
  }

  function renderCpus() {
    if (!isLoggedIn()) return;
    const cpus = state.cpus || [];
    if (!cpus.length) {
      els.cpusList.innerHTML = '<div class="empty">No crafting CPUs</div>';
      return;
    }
    els.cpusList.innerHTML = cpus.map(function(c) {
      const busy = c.busy;
      const pct = c.output && c.output.progress != null ? Math.round(c.output.progress * 100) : 0;
      return '<div class="cpu-card"><div class="cpu-header"><span class="cpu-name">' + (c.name || "CPU") +
        '</span><span class="cpu-badge ' + (busy ? "busy" : "free") + '">' + (busy ? "Busy" : "Free") +
        "</span></div><div class=\"cpu-meta\">" + (c.storage || "?") + " bytes · " + (c.coprocessors || 0) +
        " coprocessors</div>" +
        (busy && c.output ? '<div class="cpu-job">Crafting: ' + (c.output.label || c.output.id) +
          '</div><div class="cpu-progress"><div style="width:' + pct + '%"></div></div>' : "") +
        "</div>";
    }).join("");
  }

  function renderNetwork() {
    if (!isLoggedIn()) return;
    const p = state.power || {};
    const cards = [
      { label: "Stored Power", value: formatNum(p.stored) + " AE" },
      { label: "Max Power", value: formatNum(p.max) + " AE" },
      { label: "Avg Injection", value: (p.avgInjection != null ? Number(p.avgInjection).toFixed(1) : "—") + " AE/t" },
      { label: "Avg Usage", value: (p.avgUsage != null ? Number(p.avgUsage).toFixed(1) : "—") + " AE/t" },
      { label: "Idle Usage", value: (p.idle != null ? Number(p.idle).toFixed(1) : "—") + " AE/t" },
      { label: "Items tracked", value: formatNum((state.items || []).length) },
      { label: "Craftables", value: formatNum((state.craftables || []).length) },
      { label: "Crafting CPUs", value: formatNum((state.cpus || []).length) },
      { label: "Last update", value: state.updated ? String(state.updated).replace("T", " ").replace("Z", "") : "—" },
      { label: "Logged as", value: session ? session.login + " (" + session.role + ")" : "—" }
    ];
    els.networkCards.innerHTML = cards.map(function(c) {
      return '<div class="net-card"><div class="net-card-label">' + c.label +
        '</div><div class="net-card-value">' + c.value + "</div></div>";
    }).join("");
  }

  function updateHeader() {
    const p = state.power || {};
    els.powerValue.textContent = p.stored != null ? formatNum(p.stored) + " / " + formatNum(p.max) : "—";
    els.itemCount.textContent = formatNum((state.items || []).length);
    const cpus = state.cpus || [];
    els.cpuCount.textContent = cpus.filter(function(c) { return !c.busy; }).length + "/" + cpus.length;
    els.connStatus.innerHTML = state.online
      ? '<span class="dot online"></span> Live (Gist)'
      : '<span class="dot offline"></span> Offline / Mock';
  }

  function populateModFilter() {
    const mods = [], seen = {};
    (state.items || []).forEach(function(i) {
      if (i.mod && !seen[i.mod]) { seen[i.mod] = true; mods.push(i.mod); }
    });
    mods.sort();
    els.modFilter.innerHTML = '<option value="">All mods</option>' +
      mods.map(function(m) { return '<option value="' + m + '">' + m + "</option>"; }).join("");
  }

  function openCraftModal(item) {
    if (!canCraft()) {
      showToast("Нет прав на крафт");
      return;
    }
    if (!item || !item.isCraftable) {
      showToast("Нет шаблона крафта");
      return;
    }
    currentCraftItem = item;
    els.craftPreview.innerHTML = iconHtml(item) +
      '<div class="info"><div class="name">' + shortName(item) +
      '</div><div class="id">' + item.id + "</div></div>";
    els.craftQty.value = 1;
    els.craftModal.hidden = false;
  }

  function closeCraftModal() {
    els.craftModal.hidden = true;
    currentCraftItem = null;
  }

  async function submitCraft() {
    if (!currentCraftItem || !canCraft()) return;
    const qty = Math.max(1, parseInt(els.craftQty.value, 10) || 1);
    const id = currentCraftItem.id;
    const label = shortName(currentCraftItem);

    if (!cfg.token || !cfg.gistId) {
      showToast("Нужен Token в Settings для заказа");
      closeCraftModal();
      openSettings();
      return;
    }

    try {
      let queue = [];
      try {
        const r = await fetch(queueUrl());
        if (r.ok) {
          const text = await r.text();
          queue = JSON.parse(text || "[]");
          if (!Array.isArray(queue)) queue = [];
        }
      } catch (_) {}

      queue.push({
        id: id,
        amount: qty,
        label: label,
        by: session.login,
        ts: Date.now()
      });

      const body = {
        files: {
          "craft_queue.json": { content: JSON.stringify(queue, null, 2) }
        }
      };

      const res = await fetch(gistApiUrl(), {
        method: "PATCH",
        headers: {
          "Authorization": "token " + cfg.token,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(res.status + " " + err.slice(0, 120));
      }
      showToast("В очередь: " + qty + "× " + label);
    } catch (e) {
      showToast("Ошибка: " + e.message);
      console.error(e);
    }
    closeCraftModal();
  }

  async function loadFromGist() {
    const url = stateUrl();
    if (!url) return false;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state = {
        items: data.items || [],
        craftables: data.craftables || (data.items || []).filter(function(i) { return i.isCraftable; }),
        cpus: data.cpus || [],
        power: data.power || {},
        online: true,
        updated: data.updated || null
      };
      return true;
    } catch (e) {
      console.warn("Gist fetch failed:", e);
      return false;
    }
  }

  async function loadMock() {
    try {
      const res = await fetch("data/me_state.json");
      const data = await res.json();
      state = {
        items: data.items || [],
        craftables: data.craftables || [],
        cpus: data.cpus || [],
        power: data.power || {},
        online: false,
        updated: data.updated || null
      };
      return true;
    } catch {
      return false;
    }
  }

  async function refresh() {
    if (!isLoggedIn()) return;
    const ok = await loadFromGist();
    if (!ok) await loadMock();
    populateModFilter();
    applyFilters();
    renderCraftables();
    renderCpus();
    renderNetwork();
    updateHeader();
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    const sec = Math.max(8, parseInt(cfg.pollSec, 10) || 12);
    pollTimer = setInterval(function() {
      if (isLoggedIn() && cfg.gistId && cfg.gistUser) refresh();
    }, sec * 1000);
  }

  function openSettings() {
    if (!isLoggedIn()) return;
    els.cfgGistUser.value = cfg.gistUser || "";
    els.cfgGistId.value = cfg.gistId || "";
    els.cfgToken.value = cfg.token || "";
    els.cfgPoll.value = cfg.pollSec || 12;
    els.settingsModal.hidden = false;
  }
  function closeSettings() { els.settingsModal.hidden = true; }

  function saveSettings() {
    cfg.gistUser = (els.cfgGistUser.value || "").trim();
    cfg.gistId = (els.cfgGistId.value || "").trim();
    cfg.token = (els.cfgToken.value || "").trim();
    cfg.pollSec = Math.max(8, parseInt(els.cfgPoll.value, 10) || 12);
    saveCfg(cfg);
    closeSettings();
    showToast("Настройки сохранены");
    startPolling();
    refresh();
  }

  function bindEvents() {
    els.btnLogin.addEventListener("click", tryLogin);
    els.loginPass.addEventListener("keydown", function(e) {
      if (e.key === "Enter") tryLogin();
    });
    els.loginUser.addEventListener("keydown", function(e) {
      if (e.key === "Enter") els.loginPass.focus();
    });

    $$(".tab").forEach(function(btn) {
      btn.addEventListener("click", function() {
        if (!isLoggedIn()) return;
        $$(".tab").forEach(function(t) { t.classList.remove("active"); });
        $$(".tab-panel").forEach(function(p) { p.classList.remove("active"); });
        btn.classList.add("active");
        $("#tab-" + btn.dataset.tab).classList.add("active");
      });
    });

    [els.search, els.onlyCraftable, els.onlyStock, els.modFilter, els.sortBy].forEach(function(el) {
      el.addEventListener("input", applyFilters);
      el.addEventListener("change", applyFilters);
    });
    els.clearSearch.addEventListener("click", function() {
      els.search.value = "";
      applyFilters();
      els.search.focus();
    });

    function handleCard(e) {
      if (!isLoggedIn()) return;
      const card = e.target.closest(".item-card");
      if (!card) return;
      const id = card.dataset.id;
      const item = state.items.find(function(i) { return i.id === id; }) ||
                   (state.craftables || []).find(function(i) { return i.id === id; });
      if (item && item.isCraftable) openCraftModal(item);
    }
    els.itemsGrid.addEventListener("click", handleCard);
    els.craftGrid.addEventListener("click", handleCard);

    $("#closeModal").addEventListener("click", closeCraftModal);
    $("#cancelCraft").addEventListener("click", closeCraftModal);
    $("#confirmCraft").addEventListener("click", submitCraft);
    els.craftModal.addEventListener("click", function(e) {
      if (e.target === els.craftModal) closeCraftModal();
    });

    $$(".qty-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        const d = parseInt(btn.dataset.d, 10);
        els.craftQty.value = Math.max(1, (parseInt(els.craftQty.value, 10) || 1) + d);
      });
    });
    $$(".qty-presets button").forEach(function(btn) {
      btn.addEventListener("click", function() { els.craftQty.value = btn.dataset.q; });
    });

    $("#btnSettings").addEventListener("click", openSettings);
    $("#btnLogout").addEventListener("click", logout);
    $("#closeSettings").addEventListener("click", closeSettings);
    $("#saveSettings").addEventListener("click", saveSettings);
    $("#cancelSettings").addEventListener("click", closeSettings);
    els.settingsModal.addEventListener("click", function(e) {
      if (e.target === els.settingsModal) closeSettings();
    });

    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        closeCraftModal();
        closeSettings();
      }
    });
  }

  async function init() {
    await loadUsers();
    bindEvents();
    applyAuthUI();
    if (isLoggedIn()) {
      await refresh();
      startPolling();
    }
  }

  init();
})();
