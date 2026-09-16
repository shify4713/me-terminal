--[[
  ME Terminal Bridge — OC 1.7.10 / OpenOS 1.6.1 / Lua 5.2
  Gist: me_state.json (OC writes) + craft_queue.json (site writes)
]]

local component = require("component")
local computer = require("computer")
local internet = require("internet")
local term = require("term")

local CONFIG = {
  token  = "ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  gistId = "YOUR_GIST_ID_HERE",
  updateInterval = 15,
  maxItems = 800,
  localFile = "/home/me_state.json",
  debugFile = "/home/last_payload.json",
}

local function findAE()
  for addr in component.list("me_controller") do
    return component.proxy(addr), "me_controller"
  end
  for addr in component.list("me_interface") do
    return component.proxy(addr), "me_interface"
  end
  for addr, t in component.list() do
    if tostring(t):find("me_") then
      local ok, proxy = pcall(component.proxy, addr)
      if ok and proxy and type(proxy.getItemsInNetwork) == "function" then
        return proxy, t
      end
    end
  end
  return nil, "No AE2 (Adapter next to Controller/Interface)"
end

local function safe(fn, ...)
  local ok, a = pcall(fn, ...)
  if ok then return a end
  return nil
end

local function clean(s)
  s = tostring(s or "")
  s = s:gsub("[%z\1-\31]", "")
  s = s:gsub('"', "'")
  s = s:gsub("\\", "/")
  if #s > 64 then s = s:sub(1, 64) end
  return s
end

local function jstr(s)
  s = tostring(s or "")
  s = s:gsub("\\", "\\\\")
  s = s:gsub('"', '\\"')
  s = s:gsub("\n", "\\n")
  s = s:gsub("\r", "\\r")
  s = s:gsub("\t", "\\t")
  s = s:gsub("[%z\1-\31]", "")
  return '"' .. s .. '"'
end

local function jencode(val)
  local t = type(val)
  if val == nil then return "null"
  elseif t == "boolean" then return val and "true" or "false"
  elseif t == "number" then
    if val ~= val or val == math.huge or val == -math.huge then return "0" end
    return string.format("%.10g", val)
  elseif t == "string" then return jstr(val)
  elseif t == "table" then
    local isArr, maxn = true, 0
    for k, _ in pairs(val) do
      if type(k) ~= "number" then isArr = false break end
      if k > maxn then maxn = k end
    end
    if isArr then
      local parts = {}
      for i = 1, maxn do parts[i] = jencode(val[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, v in pairs(val) do
      if type(k) == "string" and k:sub(1, 1) ~= "_" then
        parts[#parts + 1] = jstr(k) .. ":" .. jencode(v)
      end
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

local function decodeQueue(str)
  if not str or str == "" or str == "[]" then return {} end
  local arr = {}
  for obj in str:gmatch("{.-}") do
    local id = obj:match('"id"%s*:%s*"([^"]*)"')
    local amount = obj:match('"amount"%s*:%s*(%d+)')
    if id then arr[#arr + 1] = { id = id, amount = tonumber(amount) or 1 } end
  end
  return arr
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
  local ok, ierr = pcall(function()
    for chunk in handle do chunks[#chunks + 1] = chunk end
  end)
  local data = table.concat(chunks)
  if not ok then return data, tostring(ierr) end
  return data, nil
end

local function gistPatch(filename, contentStr)
  local payload = '{"files":{' .. jstr(filename) .. ':{"content":' .. jstr(contentStr) .. "}}"
  local url = "https://api.github.com/gists/" .. CONFIG.gistId
  local headers = {
    ["Authorization"] = authHeader(),
    ["Accept"] = "application/vnd.github.v3+json",
    ["Content-Type"] = "application/json",
    ["User-Agent"] = "OpenComputers-ME-Terminal"
  }
  local f = io.open(CONFIG.debugFile, "w")
  if f then f:write(payload) f:close() end
  print(" PATCH " .. filename .. " (" .. #payload .. "b)")
  local data, err = httpRequest("PATCH", url, payload, headers)
  data = data or ""
  if data:find("Bad credentials") then return false, "Bad credentials" end
  if data:find("Not Found") then return false, "Gist not found" end
  if data:find("Problems parsing JSON") or data:find("Invalid request") then
    return false, "Invalid JSON: " .. data:sub(1, 180)
  end
  if data:find('"message"') and not data:find("html_url") and not data:find('"files"') then
    return false, "GitHub: " .. data:sub(1, 180)
  end
  if err then
    if data:find("html_url") or data:find('"id"') then return true, data end
    return false, tostring(err) .. " | " .. data:sub(1, 120)
  end
  return true, data
end

local function gistGetFile(filename)
  local url = "https://api.github.com/gists/" .. CONFIG.gistId
  local headers = {
    ["Authorization"] = authHeader(),
    ["Accept"] = "application/vnd.github.v3+json",
    ["User-Agent"] = "OpenComputers-ME-Terminal"
  }
  local data, err = httpRequest("GET", url, nil, headers)
  if not data then return nil, err end
  if data:find("Bad credentials") then return nil, "Bad credentials" end
  local pos = data:find('"' .. filename .. '"', 1, true)
  if not pos then return "[]" end
  local sub = data:sub(pos, pos + 20000)
  local content = sub:match('"content"%s*:%s*"(.-)"%s*[,}%\r\n]')
  if not content then return "[]" end
  content = content:gsub("\\n", "\n"):gsub('\\"', '"'):gsub("\\\\", "\\")
  return content
end

local function collectItems(ae)
  local raw = safe(ae.getItemsInNetwork) or {}
  local items, n = {}, 0
  for _, stack in pairs(raw) do
    if n >= CONFIG.maxItems then break end
    if type(stack) == "table" and (stack.name or stack.id) then
      local id = clean(stack.name or stack.id)
      local dmg = tonumber(stack.damage)
      if dmg and dmg ~= 0 then id = id .. ":" .. tostring(math.floor(dmg)) end
      items[#items + 1] = {
        id = id,
        label = clean(stack.label or stack.displayName or id),
        size = math.floor(tonumber(stack.size or stack.qty) or 0),
        isCraftable = not not stack.isCraftable,
        mod = id:match("^([^:]+)") or "unknown"
      }
      n = n + 1
    end
  end
  return items
end

local function collectCraftables(ae)
  local raw = safe(ae.getCraftables) or {}
  local list = {}
  for _, c in pairs(raw) do
    if type(c) == "table" and type(c.getItemStack) == "function" then
      local stack = safe(c.getItemStack)
      if type(stack) == "table" then
        local id = clean(stack.name or stack.id or "unknown")
        list[#list + 1] = {
          id = id, label = clean(stack.label or id), size = 0,
          isCraftable = true, mod = id:match("^([^:]+)") or "unknown"
        }
      end
    end
  end
  return list
end

local function collectCpus(ae)
  local raw = safe(ae.getCpus) or {}
  local cpus = {}
  for i, cpu in pairs(raw) do
    if type(cpu) == "table" then
      local out = nil
      if cpu.busy and type(cpu.output) == "table" then
        out = {
          id = clean(cpu.output.name or cpu.output.id or "?"),
          label = clean(cpu.output.label or "?"),
          progress = tonumber(cpu.progress) or tonumber(cpu.output.progress) or 0
        }
      end
      cpus[#cpus + 1] = {
        name = clean(cpu.name or ("CPU-" .. tostring(i))),
        busy = not not cpu.busy,
        storage = math.floor(tonumber(cpu.storage) or 0),
        coprocessors = math.floor(tonumber(cpu.coprocessors) or 0),
        output = out
      }
    end
  end
  return cpus
end

local function collectPower(ae)
  return {
    stored = tonumber(safe(ae.getStoredPower)) or 0,
    max = tonumber(safe(ae.getMaxStoredPower)) or 0,
    avgInjection = tonumber(safe(ae.getAvgPowerInjection)) or 0,
    avgUsage = tonumber(safe(ae.getAvgPowerUsage)) or 0,
    idle = tonumber(safe(ae.getIdlePowerUsage)) or 0
  }
end

local function buildState(ae)
  return {
    items = collectItems(ae),
    craftables = collectCraftables(ae),
    cpus = collectCpus(ae),
    power = collectPower(ae),
    updated = tostring(os.time())
  }
end

local function requestCraft(ae, itemId, amount)
  amount = tonumber(amount) or 1
  local crafts = safe(ae.getCraftables) or {}
  for _, c in pairs(crafts) do
    if type(c) == "table" and type(c.getItemStack) == "function" and type(c.request) == "function" then
      local stack = safe(c.getItemStack)
      if type(stack) == "table" then
        local id = clean(stack.name or stack.id or "")
        if id == itemId then
          local ok, st = pcall(function() return c.request(amount) end)
          if ok then return true, "ok" end
          return false, tostring(st)
        end
      end
    end
  end
  return false, "not found"
end

local function processQueue(ae)
  local raw, err = gistGetFile("craft_queue.json")
  if not raw then print(" queue: " .. tostring(err)) return end
  local queue = decodeQueue(raw)
  if #queue == 0 then return end
  print(" queue: " .. #queue)
  for _, req in ipairs(queue) do
    local ok, msg = requestCraft(ae, req.id, req.amount)
    print("  " .. tostring(req.amount) .. "x " .. tostring(req.id) .. " -> " .. (ok and "OK" or tostring(msg)))
  end
  local okc, errc = gistPatch("craft_queue.json", "[]")
  if not okc then print(" clear: " .. tostring(errc)) end
end

local function main()
  term.clear()
  print("=== ME Terminal Bridge ===")
  local ae, kind = findAE()
  if not ae then print("ERROR: " .. tostring(kind)) return end
  print("AE2: " .. tostring(kind))
  print("Gist: " .. tostring(CONFIG.gistId):sub(1, 20))

  if CONFIG.token:find("XXX") or CONFIG.gistId:find("YOUR_") then
    print("ERROR: set token + gistId in CONFIG")
    return
  end

  print("Test PATCH...")
  local okT, errT = gistPatch("me_state.json", '{"items":[],"craftables":[],"cpus":[],"power":{},"ping":true}')
  if not okT then
    print("TEST FAIL: " .. tostring(errT))
    print("Need classic PAT with gist scope + valid gistId")
    return
  end
  print("Test OK")

  while true do
    local t0 = computer.uptime()
    print("")
    print("--- update ---")
    local state = buildState(ae)
    print("items=" .. #state.items .. " craft=" .. #state.craftables .. " cpus=" .. #state.cpus)

    local stateJson = jencode(state)
    local f = io.open(CONFIG.localFile, "w")
    if f then f:write(stateJson) f:close() end

    local okP, errP = gistPatch("me_state.json", stateJson)
    if okP then print("pushed OK")
    else
      print("push FAIL: " .. tostring(errP))
      print("see " .. CONFIG.debugFile)
    end

    processQueue(ae)

    local wait = math.max(1, CONFIG.updateInterval - (computer.uptime() - t0))
    print("sleep " .. string.format("%.0f", wait) .. "s")
    os.sleep(wait)
  end
end

local args = { ... }
if args[1] == "craft" and args[2] then
  local ae = findAE()
  if not ae then print("no AE") return end
  local ok, msg = requestCraft(ae, args[2], args[3] or 1)
  print(ok and "OK" or msg)
else
  main()
end
