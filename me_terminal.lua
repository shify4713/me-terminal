--[[
  ME Terminal Bridge — OpenComputers 1.7.10 / OpenOS 1.6.1 / Lua 5.2
  Gist: me_state.json (OC writes) + craft_queue.json (site writes)
  Need: Adapter next to ME Controller/Interface + Internet Card
]]

local component = require("component")
local computer = require("computer")
local event = require("event")
local fs = require("filesystem")
local internet = require("internet")
local term = require("term")

local CONFIG = {
  token   = "ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  gistId  = "YOUR_GIST_ID_HERE",
  updateInterval = 15,
  maxItems = 800,
  localFile = "/home/me_state.json",
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
  local ok, a, b = pcall(fn, ...)
  if ok then return a, b end
  return nil
end

local function esc(s)
  s = tostring(s or "")
  s = s:gsub("\\", "\\\\")
  s = s:gsub('"', '\\"')
  s = s:gsub("\n", "\\n")
  s = s:gsub("\r", "\\r")
  s = s:gsub("\t", "\\t")
  s = s:gsub("[%z\1-\31]", "?")
  return s
end

local function jsonEncode(val)
  local t = type(val)
  if val == nil then return "null"
  elseif t == "boolean" then return val and "true" or "false"
  elseif t == "number" then
    if val ~= val or val == math.huge or val == -math.huge then return "null" end
    return string.format("%.12g", val)
  elseif t == "string" then
    return '"' .. esc(val) .. '"'
  elseif t == "table" then
    local isArr, maxn = true, 0
    for k, _ in pairs(val) do
      if type(k) ~= "number" then isArr = false break end
      if k > maxn then maxn = k end
    end
    if isArr then
      local parts = {}
      for i = 1, maxn do parts[i] = jsonEncode(val[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      local parts = {}
      for k, v in pairs(val) do
        if type(k) == "string" and k:sub(1, 1) ~= "_" then
          parts[#parts + 1] = jsonEncode(k) .. ":" .. jsonEncode(v)
        end
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  return "null"
end

local function jsonDecodeArray(str)
  if not str or str == "" or str == "[]" then return {} end
  local arr = {}
  for obj in str:gmatch("{.-}") do
    local id = obj:match('"id"%s*:%s*"([^"]*)"')
    local amount = obj:match('"amount"%s*:%s*(%d+)')
    local label = obj:match('"label"%s*:%s*"([^"]*)"')
    if id then
      arr[#arr + 1] = { id = id, amount = tonumber(amount) or 1, label = label }
    end
  end
  return arr
end

local function authHeader()
  local tok = (CONFIG.token or ""):gsub("%s+", "")
  if tok:sub(1, 11) == "github_pat_" then
    return "Bearer " .. tok
  end
  return "token " .. tok
end

local function httpRequest(method, url, body, headers)
  headers = headers or {}
  local handle, err = internet.request(url, body, headers, method)
  if not handle then
    return nil, tostring(err or "request failed")
  end
  local chunks = {}
  local okIter, iterErr = pcall(function()
    for chunk in handle do chunks[#chunks + 1] = chunk end
  end)
  local data = table.concat(chunks)
  if not okIter then return data, tostring(iterErr) end
  return data, nil
end

local function gistPatch(filesTable)
  local payload = jsonEncode({ files = filesTable })
  local url = "https://api.github.com/gists/" .. CONFIG.gistId
  local headers = {
    ["Authorization"] = authHeader(),
    ["Accept"] = "application/vnd.github+json",
    ["Content-Type"] = "application/json",
    ["User-Agent"] = "OC-ME-Terminal/1.0"
  }
  print(" PATCH gist (" .. #payload .. " bytes)...")
  local data, err = httpRequest("PATCH", url, payload, headers)
  if err and (not data or data == "") then return false, err end
  data = data or ""
  if data:find("Bad credentials") then return false, "Bad credentials — token scope gist?" end
  if data:find("Not Found") then return false, "Gist not found — check gistId" end
  if data:find("Problems parsing JSON") or data:find("Invalid request") then
    return false, "Invalid JSON: " .. data:sub(1, 120)
  end
  if data:find('"message"') and not data:find('"files"') then
    return false, "GitHub: " .. data:sub(1, 150)
  end
  if tostring(err or ""):find("400") then return false, "HTTP 400: " .. data:sub(1, 150) end
  if tostring(err or ""):find("40") then return false, tostring(err) .. " " .. data:sub(1, 100) end
  return true, data
end

local function gistGetFile(filename)
  local apiUrl = "https://api.github.com/gists/" .. CONFIG.gistId
  local headers = {
    ["Authorization"] = authHeader(),
    ["Accept"] = "application/vnd.github+json",
    ["User-Agent"] = "OC-ME-Terminal/1.0"
  }
  local data, err = httpRequest("GET", apiUrl, nil, headers)
  if not data then return nil, err end
  if data:find("Bad credentials") then return nil, "Bad credentials" end
  local key = '"' .. filename .. '"'
  local pos = data:find(key, 1, true)
  if not pos then return nil, "file " .. filename .. " not in gist" end
  local sub = data:sub(pos)
  local content = sub:match('"content"%s*:%s*"(.-[^\\])"') or sub:match('"content"%s*:%s*"(.-)"%s*[,}]')
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
      local id = tostring(stack.name or stack.id)
      if stack.damage and tonumber(stack.damage) and tonumber(stack.damage) ~= 0 then
        id = id .. ":" .. tostring(stack.damage)
      end
      items[#items + 1] = {
        id = id,
        label = tostring(stack.label or stack.displayName or id),
        size = tonumber(stack.size or stack.qty) or 0,
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
        local id = tostring(stack.name or stack.id or "unknown")
        list[#list + 1] = {
          id = id, label = tostring(stack.label or id), size = 0,
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
          id = tostring(cpu.output.name or cpu.output.id or "?"),
          label = tostring(cpu.output.label or "?"),
          progress = tonumber(cpu.progress) or tonumber(cpu.output.progress)
        }
      end
      cpus[#cpus + 1] = {
        name = tostring(cpu.name or ("CPU-" .. tostring(i))),
        busy = not not cpu.busy,
        storage = tonumber(cpu.storage) or 0,
        coprocessors = tonumber(cpu.coprocessors) or 0,
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
    updated = os.date("!%Y-%m-%dT%H:%M:%SZ")
  }
end

local function requestCraft(ae, itemId, amount)
  amount = tonumber(amount) or 1
  local crafts = safe(ae.getCraftables) or {}
  for _, c in pairs(crafts) do
    if type(c) == "table" and type(c.getItemStack) == "function" and type(c.request) == "function" then
      local stack = safe(c.getItemStack)
      if type(stack) == "table" then
        local id = tostring(stack.name or stack.id or "")
        if id == itemId then
          local ok, status = pcall(function() return c.request(amount) end)
          if ok then return true, "ok" end
          return false, tostring(status)
        end
      end
    end
  end
  return false, "craftable not found: " .. tostring(itemId)
end

local function processQueue(ae)
  local raw, err = gistGetFile("craft_queue.json")
  if not raw then print(" queue read: " .. tostring(err)) return end
  local queue = jsonDecodeArray(raw)
  if #queue == 0 then return end
  print(" Queue: " .. #queue .. " job(s)")
  for _, req in ipairs(queue) do
    print("  craft " .. tostring(req.amount) .. "x " .. tostring(req.id))
    local ok, msg = requestCraft(ae, req.id, req.amount)
    print("  -> " .. (ok and "OK" or ("FAIL " .. tostring(msg))))
  end
  local okClear, errClear = gistPatch({ ["craft_queue.json"] = { content = "[]" } })
  if not okClear then print(" clear queue fail: " .. tostring(errClear)) end
end

local function main()
  term.clear()
  print("=== ME Terminal Bridge ===")
  print("Looking for AE2...")
  local ae, kind = findAE()
  if not ae then print("ERROR: " .. tostring(kind)) return end
  print("Found: " .. tostring(kind))
  print("Gist: " .. tostring(CONFIG.gistId):sub(1, 16) .. "...")

  if CONFIG.token:find("XXX") or CONFIG.gistId:find("YOUR_") then
    print("ERROR: fill CONFIG.token and CONFIG.gistId")
    return
  end

  print("Testing Gist access...")
  local okTest, errTest = gistPatch({
    ["me_state.json"] = {
      content = jsonEncode({
        items = {}, craftables = {}, cpus = {}, power = {},
        updated = os.date("!%Y-%m-%dT%H:%M:%SZ"), ping = true
      })
    }
  })
  if not okTest then
    print("TEST FAIL: " .. tostring(errTest))
    print("1) classic PAT with gist scope")
    print("2) ONE gist with BOTH files me_state.json + craft_queue.json")
    print("3) Internet Card in computer")
    return
  end
  print("Gist OK")

  while true do
    local t0 = computer.uptime()
    print("")
    print("[" .. os.date("%H:%M:%S") .. "] update...")
    local state = buildState(ae)
    print(" items=" .. #state.items .. " craftables=" .. #state.craftables .. " cpus=" .. #state.cpus)

    local f = io.open(CONFIG.localFile, "w")
    if f then f:write(jsonEncode(state)) f:close() end

    local okPush, errPush = gistPatch({ ["me_state.json"] = { content = jsonEncode(state) } })
    if okPush then print(" pushed me_state.json")
    else print(" push FAIL: " .. tostring(errPush)) end

    processQueue(ae)

    local elapsed = computer.uptime() - t0
    local wait = math.max(1, CONFIG.updateInterval - elapsed)
    print(" sleep " .. string.format("%.0f", wait) .. "s")
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
