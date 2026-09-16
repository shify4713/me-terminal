--[[
  ME Terminal Bridge — OC 1.7.10 / OpenOS 1.6.1 / Lua 5.2
]]

local component = require("component")
local computer = require("computer")
local internet = require("internet")
local term = require("term")

local CONFIG = {
  token  = "ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  gistId = "YOUR_GIST_ID_HERE",
  updateInterval = 15,
  maxItems = 500,
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
    if b >= 32 and b < 127 and b ~= 34 and b ~= 92 then
      out[#out + 1] = string.char(b)
    elseif b == 34 then
      out[#out + 1] = "'"
    end
  end
  s = table.concat(out)
  if #s > 48 then s = s:sub(1, 48) end
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
    elseif b >= 32 and b < 127 then out[#out + 1] = string.char(b)
    end
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
    local keys = {}
    local isArr = true
    local maxn = 0
    for k, _ in pairs(val) do
      keys[#keys + 1] = k
      if type(k) ~= "number" or k < 1 or k ~= math.floor(k) then isArr = false end
      if type(k) == "number" and k > maxn then maxn = k end
    end
    if isArr and maxn == #keys then
      local parts = {}
      for i = 1, maxn do parts[i] = jencode(val[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, v in pairs(val) do
      if type(k) == "string" then
        parts[#parts + 1] = jstr(k) .. ":" .. jencode(v)
      end
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
  local ok, ierr = pcall(function()
    for chunk in handle do chunks[#chunks + 1] = chunk end
  end)
  local data = table.concat(chunks)
  if not ok then return data, tostring(ierr) end
  return data, nil
end

local function gistPatch(filesMap)
  local filesObj = {}
  for name, content in pairs(filesMap) do
    filesObj[name] = { content = content }
  end
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
  if data:find("Problems parsing JSON") or data:find("Invalid request") then
    return false, "Bad JSON: " .. data:sub(1, 200)
  end
  if data:find('"message"') and not data:find("html_url") then
    return false, "API: " .. data:sub(1, 200)
  end
  if err then
    if data:find("html_url") then return true, data end
    return false, tostring(err) .. " | " .. data:sub(1, 150)
  end
  return true, data
end

local function gistGetRaw(filename)
  local api = "https://api.github.com/gists/" .. CONFIG.gistId
  local headers = {
    ["Authorization"] = authHeader(),
    ["Accept"] = "application/vnd.github.v3+json",
    ["User-Agent"] = "OC-ME-Terminal"
  }
  local data, err = httpRequest("GET", api, nil, headers)
  if not data then return nil, err end
  local pos = data:find('"' .. filename .. '"', 1, true)
  if not pos then return "[]" end
  local sub = data:sub(pos, pos + 50000)
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
        isCraftable = stack.isCraftable and true or false,
        mod = id:match("^([^:]+)") or "?"
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
        local id = clean(stack.name or stack.id or "?")
        list[#list + 1] = {
          id = id, label = clean(stack.label or id), size = 0,
          isCraftable = true, mod = id:match("^([^:]+)") or "?"
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
      cpus[#cpus + 1] = {
        name = clean(cpu.name or ("CPU" .. tostring(i))),
        busy = cpu.busy and true or false,
        storage = math.floor(tonumber(cpu.storage) or 0),
        coprocessors = math.floor(tonumber(cpu.coprocessors) or 0)
      }
    end
  end
  return cpus
end

local function collectPower(ae)
  return {
    stored = math.floor(tonumber(safe(ae.getStoredPower)) or 0),
    max = math.floor(tonumber(safe(ae.getMaxStoredPower)) or 0)
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
      if type(stack) == "table" and clean(stack.name or stack.id or "") == itemId then
        local ok, st = pcall(function() return c.request(amount) end)
        if ok then return true end
        return false, tostring(st)
      end
    end
  end
  return false, "not found"
end

local function processQueue(ae)
  local raw, err = gistGetRaw("craft_queue.json")
  if not raw then print("queue err: " .. tostring(err)) return end
  if raw == "[]" or raw == "" then return end
  local queue = {}
  for obj in raw:gmatch("{.-}") do
    local id = obj:match('"id"%s*:%s*"([^"]*)"')
    local amount = obj:match('"amount"%s*:%s*(%d+)')
    if id then queue[#queue + 1] = { id = id, amount = tonumber(amount) or 1 } end
  end
  if #queue == 0 then return end
  print("queue " .. #queue)
  for _, req in ipairs(queue) do
    local ok, msg = requestCraft(ae, req.id, req.amount)
    print(" " .. req.amount .. "x " .. req.id .. " " .. (ok and "OK" or tostring(msg)))
  end
  gistPatch({ ["craft_queue.json"] = "[]" })
end

local function main()
  term.clear()
  print("=== ME Terminal Bridge ===")
  local ae, kind = findAE()
  if not ae then print("ERROR " .. tostring(kind)) return end
  print("AE2: " .. tostring(kind))

  if CONFIG.token:find("XXX") or CONFIG.gistId:find("YOUR_") then
    print("Set CONFIG.token and CONFIG.gistId")
    return
  end

  print("Test...")
  local okT, errT = gistPatch({
    ["me_state.json"] = '{"items":[],"craftables":[],"cpus":[],"power":{},"ping":1}'
  })
  if not okT then
    print("TEST FAIL: " .. tostring(errT))
    return
  end
  print("Test OK")

  while true do
    local t0 = computer.uptime()
    print("")
    print("---")
    local state = buildState(ae)
    print("i=" .. #state.items .. " c=" .. #state.craftables .. " cpu=" .. #state.cpus)

    local stateJson = jencode(state)
    local f = io.open(CONFIG.localFile, "w")
    if f then f:write(stateJson) f:close() end

    local okP, errP = gistPatch({ ["me_state.json"] = stateJson })
    if okP then
      print("push OK")
    else
      print("full FAIL: " .. tostring(errP))
      local miniItems = {}
      for i, it in ipairs(state.items) do
        miniItems[i] = { id = it.id, size = it.size }
      end
      local mini = jencode({
        items = miniItems,
        craftables = {},
        cpus = state.cpus,
        power = state.power,
        updated = state.updated
      })
      print("try mini (" .. #mini .. "b)")
      local ok2, err2 = gistPatch({ ["me_state.json"] = mini })
      if ok2 then print("mini OK")
      else
        print("mini FAIL: " .. tostring(err2))
        local tiny = jencode({
          items = {}, craftables = {}, cpus = {},
          power = state.power, updated = state.updated,
          itemCount = #state.items
        })
        local ok3, err3 = gistPatch({ ["me_state.json"] = tiny })
        print("tiny: " .. (ok3 and "OK" or tostring(err3)))
      end
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
  if ae then
    local ok, msg = requestCraft(ae, args[2], args[3] or 1)
    print(ok and "OK" or msg)
  end
else
  main()
end
