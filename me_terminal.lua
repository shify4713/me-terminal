--[[
  ME Terminal Bridge — OC 1.7.10 / OpenOS 1.6.1 / Lua 5.2
  getCraftables returns userdata with getItemStack() and request(amount)
  Filter: getCraftables({name=..., damage=...})
]]

local component = require("component")
local computer = require("computer")
local internet = require("internet")
local term = require("term")

local CONFIG = {
  token  = "ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  gistId = "YOUR_GIST_ID_HERE",
  updateInterval = 12,
  maxItems = 2500,
  maxCraftables = 800,
  localFile = "/home/me_state.json",
  debugFile = "/home/last_payload.json",
}

local function findAE()
  for addr in component.list("me_controller") do return component.proxy(addr), "me_controller" end
  for addr in component.list("me_interface") do return component.proxy(addr), "me_interface" end
  for addr, t in component.list() do
    if tostring(t):find("me_") then
      local ok, proxy = pcall(component.proxy, addr)
      if ok and proxy and type(proxy.getItemsInNetwork) == "function" then return proxy, tostring(t) end
    end
  end
  return nil, "No AE2"
end

local function safe(fn, ...)
  local ok, a = pcall(fn, ...)
  if ok then return a end
  return nil
end

local function clean(s)
  s = tostring(s or "")
  local out = {}
  for i = 1, #s do
    local b = s:byte(i)
    if b >= 32 and b < 127 and b ~= 34 and b ~= 92 then out[#out + 1] = string.char(b)
    elseif b == 34 then out[#out + 1] = "'" end
  end
  s = table.concat(out)
  if #s > 56 then s = s:sub(1, 56) end
  return s
end

local function jstr(s)
  s = tostring(s or "")
  local out = {'"'}
  for i = 1, #s do
    local b = s:byte(i)
    if b == 34 then out[#out + 1] = '\\"'
    elseif b == 92 then out[#out + 1] = '\\\\'
    elseif b == 10 then out[#out + 1] = '\\n'
    elseif b == 13 then out[#out + 1] = '\\r'
    elseif b == 9 then out[#out + 1] = '\\t'
    elseif b >= 32 and b < 127 then out[#out + 1] = string.char(b) end
  end
  out[#out + 1] = '"'
  return table.concat(out)
end

local function jencode(val)
  local t = type(val)
  if val == nil then return "null" end
  if t == "boolean" then return val and "true" or "false" end
  if t == "number" then
    if val ~= val or val >= math.huge or val <= -math.huge then return "0" end
    local n = math.floor(val)
    if n == val then return tostring(n) end
    return string.format("%.6g", val)
  end
  if t == "string" then return jstr(val) end
  if t == "table" then
    local isArr, maxn, nkeys = true, 0, 0
    for k, _ in pairs(val) do
      nkeys = nkeys + 1
      if type(k) ~= "number" or k < 1 or k ~= math.floor(k) then isArr = false end
      if type(k) == "number" and k > maxn then maxn = k end
    end
    if isArr and maxn == nkeys then
      local parts = {}
      for i = 1, maxn do parts[i] = jencode(val[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, v in pairs(val) do
      if type(k) == "string" then parts[#parts + 1] = jstr(k) .. ":" .. jencode(v) end
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

local function authHeader()
  local tok = (CONFIG.token or ""):gsub("%s+", "")
  if tok:sub(1, 11) == "github_pat_" then return "Bearer " .. tok end
  return "token " .. tok
end

local function httpRequest(method, url, body, headers)
  headers = headers or {}
  local handle, err = internet.request(url, body or "", headers, method)
  if not handle then return nil, tostring(err or "no handle") end
  local chunks = {}
  local ok, ierr = pcall(function() for chunk in handle do chunks[#chunks + 1] = chunk end end)
  local data = table.concat(chunks)
  if not ok then return data, tostring(ierr) end
  return data, nil
end

local function gistPatch(filesMap)
  local filesObj = {}
  for name, content in pairs(filesMap) do filesObj[name] = { content = content } end
  local payload = jencode({ files = filesObj })
  local url = "https://api.github.com/gists/" .. CONFIG.gistId
  local headers = {
    ["Authorization"] = authHeader(),
    ["Accept"] = "application/vnd.github.v3+json",
    ["Content-Type"] = "application/json",
    ["User-Agent"] = "OC-ME-Terminal"
  }
  local f = io.open(CONFIG.debugFile, "w")
  if f then f:write(payload) f:close() end
  print(" PATCH (" .. #payload .. "b)")
  local data, err = httpRequest("PATCH", url, payload, headers)
  data = data or ""
  if data:find("Bad credentials") then return false, "Bad credentials" end
  if data:find("Not Found") then return false, "Gist not found" end
  if data:find("Problems parsing JSON") or data:find("Invalid request") then return false, "Bad JSON: " .. data:sub(1, 180) end
  if data:find('"message"') and not data:find("html_url") then return false, "API: " .. data:sub(1, 180) end
  if err then
    if data:find("html_url") then return true, data end
    return false, tostring(err) .. " | " .. data:sub(1, 120)
  end
  return true, data
end

local function gistGetFile(filename)
  local api = "https://api.github.com/gists/" .. CONFIG.gistId
  local headers = { ["Authorization"] = authHeader(), ["Accept"] = "application/vnd.github.v3+json", ["User-Agent"] = "OC-ME-Terminal" }
  local data, err = httpRequest("GET", api, nil, headers)
  if not data then return nil, err end
  local pos = data:find('"' .. filename .. '"', 1, true)
  if not pos then return "[]" end
  local sub = data:sub(pos, pos + 80000)
  local content = sub:match('"content"%s*:%s*"(.-)"%s*[,}%\r\n]')
  if not content then return "[]" end
  content = content:gsub("\\n", "\n"):gsub('\\"', '"'):gsub("\\\\", "\\")
  return content
end

local function makeId(name, damage)
  name = clean(name or "?")
  damage = math.floor(tonumber(damage) or 0)
  if damage ~= 0 then return name .. ":" .. tostring(damage) end
  return name
end

local function labelFromId(id)
  local raw = id:match(":(.+)$") or id
  raw = raw:gsub("^item%.", ""):gsub("^tile%.", "")
  raw = raw:gsub("ItemMultiMaterial%.", "Mat "):gsub("[._]", " ")
  return clean(raw)
end

local function stackToItem(stack)
  if type(stack) ~= "table" then return nil end
  local name = stack.name or stack.id
  if not name then return nil end
  name = clean(name)
  local damage = math.floor(tonumber(stack.damage) or 0)
  local id = makeId(name, damage)
  local label = clean(stack.label or stack.displayName or "")
  if label == "" or not label:find("%a") then label = labelFromId(id) end
  if label == "" then label = id end
  return {
    id = id, name = name, damage = damage, label = label,
    size = math.floor(tonumber(stack.size or stack.qty) or 0),
    isCraftable = not not stack.isCraftable,
    mod = name:match("^([^:]+)") or "?"
  }
end

local function tableLen(t)
  if type(t) ~= "table" then return 0 end
  if type(t.n) == "number" then return t.n end
  local n = 0
  for k, _ in pairs(t) do if type(k) == "number" and k > n then n = k end end
  return n
end

local function collectItems(ae)
  local raw = safe(ae.getItemsInNetwork) or {}
  local items, n = {}, 0
  local len = tableLen(raw)
  if len == 0 then
    for _, stack in pairs(raw) do
      if type(stack) == "table" and (stack.name or stack.id) then
        if n >= CONFIG.maxItems then break end
        local it = stackToItem(stack)
        if it then items[#items + 1] = it n = n + 1 end
      end
    end
  else
    for i = 1, len do
      if n >= CONFIG.maxItems then break end
      local it = stackToItem(raw[i])
      if it then items[#items + 1] = it n = n + 1 end
    end
  end
  return items
end

local function collectCraftables(ae)
  local list = {}
  local raw = safe(ae.getCraftables)
  if type(raw) ~= "table" then
    print(" getCraftables: " .. type(raw))
    return list
  end
  local len = tableLen(raw)
  local scanned = 0
  local function addFrom(c)
    if type(c) ~= "table" and type(c) ~= "userdata" then return end
    if type(c.getItemStack) ~= "function" then return end
    local stack = safe(c.getItemStack)
    local it = stackToItem(stack)
    if it then it.size = 0 it.isCraftable = true list[#list + 1] = it end
  end
  if len > 0 then
    for i = 1, len do
      if #list >= CONFIG.maxCraftables then break end
      scanned = scanned + 1
      addFrom(raw[i])
    end
  else
    for k, c in pairs(raw) do
      if k ~= "n" then
        if #list >= CONFIG.maxCraftables then break end
        scanned = scanned + 1
        addFrom(c)
      end
    end
  end
  print(" craftables scanned=" .. scanned .. " ok=" .. #list)
  return list
end

local function collectCpus(ae)
  local raw = safe(ae.getCpus) or {}
  local cpus = {}
  local len = tableLen(raw)
  local function add(cpu, i)
    if type(cpu) ~= "table" then return end
    cpus[#cpus + 1] = {
      name = clean(cpu.name or ("CPU" .. tostring(i))),
      busy = not not cpu.busy,
      storage = math.floor(tonumber(cpu.storage) or 0),
      coprocessors = math.floor(tonumber(cpu.coprocessors) or 0)
    }
  end
  if len > 0 then for i = 1, len do add(raw[i], i) end
  else for i, cpu in pairs(raw) do if type(i) == "number" then add(cpu, i) end end end
  return cpus
end

local function collectPower(ae)
  return {
    stored = math.floor(tonumber(safe(ae.getStoredPower)) or 0),
    max = math.floor(tonumber(safe(ae.getMaxStoredPower)) or 0)
  }
end

local function buildState(ae)
  local items = collectItems(ae)
  local craftables = collectCraftables(ae)
  local craftSet = {}
  for _, c in ipairs(craftables) do craftSet[c.id] = true end
  for _, it in ipairs(items) do if craftSet[it.id] then it.isCraftable = true end end
  return {
    items = items, craftables = craftables,
    cpus = collectCpus(ae), power = collectPower(ae),
    updated = tostring(os.time())
  }
end

local function requestCraft(ae, name, damage, amount)
  name = clean(name or "")
  damage = math.floor(tonumber(damage) or 0)
  amount = math.floor(tonumber(amount) or 1)
  if name == "" or amount < 1 then return false, "bad args" end

  local filtered = safe(function() return ae.getCraftables({ name = name, damage = damage }) end)
  if type(filtered) == "table" then
    local len = tableLen(filtered)
    if len >= 1 and filtered[1] and type(filtered[1].request) == "function" then
      local ok, st = pcall(function() return filtered[1].request(amount) end)
      if ok then return true, "ok" end
      return false, tostring(st)
    end
  end

  local all = safe(ae.getCraftables) or {}
  local len = tableLen(all)
  local function tryOne(c)
    if type(c) ~= "table" and type(c) ~= "userdata" then return false end
    if type(c.getItemStack) ~= "function" or type(c.request) ~= "function" then return false end
    local stack = safe(c.getItemStack)
    if type(stack) ~= "table" then return false end
    local sn = clean(stack.name or stack.id or "")
    local sd = math.floor(tonumber(stack.damage) or 0)
    if sn == name and sd == damage then
      local ok, st = pcall(function() return c.request(amount) end)
      if ok then return true end
      return false, tostring(st)
    end
    return false
  end
  if len > 0 then
    for i = 1, len do
      local ok, msg = tryOne(all[i])
      if ok then return true, "ok" end
      if msg then return false, msg end
    end
  else
    for k, c in pairs(all) do
      if k ~= "n" then
        local ok, msg = tryOne(c)
        if ok then return true, "ok" end
        if msg then return false, msg end
      end
    end
  end
  return false, "not found: " .. name .. " dmg=" .. tostring(damage)
end

local function processQueue(ae)
  local raw, err = gistGetFile("craft_queue.json")
  if not raw then print(" queue err: " .. tostring(err)) return end
  if raw == "[]" or raw == "" then return end
  local queue = {}
  for obj in raw:gmatch("{.-}") do
    local name = obj:match('"name"%s*:%s*"([^"]*)"')
    local id = obj:match('"id"%s*:%s*"([^"]*)"')
    local damage = tonumber(obj:match('"damage"%s*:%s*(%d+)'))
    local amount = tonumber(obj:match('"amount"%s*:%s*(%d+)')) or 1
    if not name and id then
      local a, b, c = id:match("^([^:]+):([^:]+):(%d+)$")
      if a and b and c then name = a .. ":" .. b damage = tonumber(c)
      else name = id damage = 0 end
    end
    if name then queue[#queue + 1] = { name = name, damage = damage or 0, amount = amount } end
  end
  if #queue == 0 then return end
  print(" queue: " .. #queue)
  for _, req in ipairs(queue) do
    local ok, msg = requestCraft(ae, req.name, req.damage, req.amount)
    print("  " .. req.amount .. "x " .. req.name .. ":" .. req.damage .. " -> " .. (ok and "OK" or tostring(msg)))
  end
  gistPatch({ ["craft_queue.json"] = "[]" })
end

local function main()
  term.clear()
  print("=== ME Terminal Bridge ===")
  local ae, kind = findAE()
  if not ae then print("ERROR: " .. tostring(kind)) return end
  print("AE2: " .. tostring(kind))
  print("api: items=" .. tostring(type(ae.getItemsInNetwork)=="function") .. " craft=" .. tostring(type(ae.getCraftables)=="function"))

  if CONFIG.token:find("XXX") or CONFIG.gistId:find("YOUR_") then
    print("Set CONFIG.token and CONFIG.gistId")
    return
  end

  print("Test PATCH...")
  local okT, errT = gistPatch({ ["me_state.json"] = '{"items":[],"craftables":[],"cpus":[],"power":{},"ping":1}' })
  if not okT then print("TEST FAIL: " .. tostring(errT)) return end
  print("Test OK")

  while true do
    local t0 = computer.uptime()
    print("")
    print("---")
    local state = buildState(ae)
    print("i=" .. #state.items .. " c=" .. #state.craftables .. " cpu=" .. #state.cpus)
    if #state.craftables > 0 then
      local s = {}
      for i = 1, math.min(3, #state.craftables) do s[i] = state.craftables[i].id end
      print(" craft: " .. table.concat(s, ", "))
    end

    local stateJson = jencode(state)
    local f = io.open(CONFIG.localFile, "w")
    if f then f:write(stateJson) f:close() end

    local okP, errP = gistPatch({ ["me_state.json"] = stateJson })
    if okP then print("push OK")
    else
      print("full FAIL: " .. tostring(errP))
      local miniItems, miniCraft = {}, {}
      for i, it in ipairs(state.items) do
        miniItems[i] = { id = it.id, name = it.name, damage = it.damage, size = it.size, isCraftable = it.isCraftable, mod = it.mod }
      end
      for i, it in ipairs(state.craftables) do
        miniCraft[i] = { id = it.id, name = it.name, damage = it.damage, size = 0, isCraftable = true, mod = it.mod }
      end
      local mini = jencode({ items = miniItems, craftables = miniCraft, cpus = state.cpus, power = state.power, updated = state.updated })
      local ok2, err2 = gistPatch({ ["me_state.json"] = mini })
      print("mini: " .. (ok2 and "OK" or tostring(err2)))
    end

    processQueue(ae)
    local wait = math.max(1, CONFIG.updateInterval - (computer.uptime() - t0))
    print("sleep " .. string.format("%.0f", wait))
    os.sleep(wait)
  end
end

local args = { ... }
if args[1] == "craft" and args[2] then
  local ae = findAE()
  if not ae then print("no AE") return end
  local name, damage, amount = args[2], tonumber(args[3]) or 0, tonumber(args[4]) or 1
  local a, b = name:match("^(.+):(%d+)$")
  if a and b then name = a damage = tonumber(b) amount = tonumber(args[3]) or 1 end
  local ok, msg = requestCraft(ae, name, damage, amount)
  print(ok and "OK" or msg)
elseif args[1] == "listcraft" then
  local ae = findAE()
  if not ae then print("no AE") return end
  local c = collectCraftables(ae)
  print("craftables: " .. #c)
  for i = 1, math.min(30, #c) do print(" " .. c[i].id .. " | " .. c[i].label) end
else
  main()
end
