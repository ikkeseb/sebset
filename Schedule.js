// Sebset's schedule model: pure functions, no QML, no I/O.
//
// Loaded by Panel.qml (`import "Schedule.js" as Schedule`) and by the tests
// (`require("../Schedule.js")`), so it sticks to plain ES5-style functions and
// exports through `module` only when one exists.
//
// Times are minutes after local midnight (0..1439). An evening belongs to the
// calendar day it starts on: Friday's night runs into Saturday morning and is
// Friday's. Instants are computed in local wall-clock time, so a DST change in
// the night moves nothing a person would notice: the ramp starts at the
// clock's 18:30 and the morning comes at the clock's 07:00.

var NEUTRAL = 6500
var WARMEST = 3000
var MAX_RAMP = 240
var MINUTE = 60000
// A ramp moves the screen at most this much per step, small enough that no
// single step is noticed, and steps no more often than every MIN_STEP_MS.
var MAX_STEP_KELVIN = 25
var MIN_STEP_MS = 5000
// An evening starts between noon and 05:59 the next morning; a start typed
// as 01:00 is that night's 01:00, not the next afternoon's. Mornings end by noon.
var EARLIEST_START = 12 * 60
var LATEST_START = 6 * 60 - 1
var LATEST_MORNING = 12 * 60

var DEFAULTS = {
  scheduleEnabled: true,
  vacation: false,
  weekdays: { start: 18 * 60 + 30, rampMinutes: 60, endKelvin: 5000, morning: 7 * 60 },
  weekend: { start: 20 * 60, rampMinutes: 60, endKelvin: 5500, morning: 9 * 60 }
}

function clampInt(value, low, high, fallback) {
  var n = typeof value === "number" ? value
    : (typeof value === "string" && value.trim() !== "" ? Number(value) : NaN)
  if (!isFinite(n)) return fallback
  n = Math.round(n)
  return Math.max(low, Math.min(high, n))
}

function clampKelvin(value, fallback) {
  return clampInt(value, WARMEST, NEUTRAL, fallback === undefined ? NEUTRAL : fallback)
}

// "18:43", "18.43", "1843", "18" or a number of minutes -> minutes after
// midnight, or null when it is not a time.
function parseTime(value) {
  if (typeof value === "number") return isFinite(value) ? ((Math.round(value) % 1440) + 1440) % 1440 : null
  if (typeof value !== "string") return null
  var m = /^(\d{1,2})(?:[:.h ]?(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  var hours = Number(m[1])
  var minutes = m[2] === undefined ? 0 : Number(m[2])
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null
  return (hours * 60 + minutes) % 1440
}

function formatTime(minutes) {
  var m = ((Math.round(Number(minutes) || 0) % 1440) + 1440) % 1440
  var h = Math.floor(m / 60)
  var mm = m % 60
  return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm
}

// "37", "37m", "37 min", "1:05", "1h", "1h 5m", "1.5h" -> whole minutes, or null.
function parseDuration(value) {
  if (typeof value === "number") return isFinite(value) ? Math.round(value) : null
  if (typeof value !== "string") return null
  var text = value.trim().toLowerCase()
  var m
  if ((m = /^(\d+)\s*(m|min|mins|minutes?)?$/.exec(text))) return Number(m[1])
  if ((m = /^(\d+):(\d{2})$/.exec(text))) return Number(m[1]) * 60 + Number(m[2])
  if ((m = /^(\d+(?:[.,]\d+)?)\s*h(?:ours?)?(?:\s*(\d+)\s*(?:m|min|mins|minutes?)?)?$/.exec(text)))
    return Math.round(Number(m[1].replace(",", ".")) * 60) + (m[2] ? Number(m[2]) : 0)
  return null
}

function formatDuration(minutes) {
  var m = Math.max(0, Math.round(Number(minutes) || 0))
  if (m < 60) return m + " min"
  var h = Math.floor(m / 60)
  var rest = m % 60
  return rest === 0 ? h + " h" : h + " h " + rest + " min"
}

// "5200", "5200K", "5200 k" -> kelvin, or null.
function parseKelvin(value) {
  if (typeof value === "number") return isFinite(value) ? Math.round(value) : null
  if (typeof value !== "string") return null
  var m = /^(\d{3,5})\s*k?$/i.exec(value.trim())
  return m ? Number(m[1]) : null
}

// Start times live on the evening's own axis: noon..23:59, then 00:00..05:59
// as minutes past midnight of the next day.
function startOffset(start) {
  return start < EARLIEST_START ? start + 1440 : start
}

function clampStart(value, fallback) {
  var t = parseTime(value)
  if (t === null) return fallback
  if (t > LATEST_START && t < EARLIEST_START)
    return (t - LATEST_START) <= (EARLIEST_START - t) ? LATEST_START : EARLIEST_START
  return t
}

function clampMorning(value, fallback) {
  var t = parseTime(value)
  if (t === null) return fallback
  return Math.min(LATEST_MORNING, t)
}

function normalizePlan(raw, defaults) {
  var plan = raw && typeof raw === "object" ? raw : {}
  var ramp = typeof plan.rampMinutes === "string" ? parseDuration(plan.rampMinutes) : plan.rampMinutes
  var kelvin = typeof plan.endKelvin === "string" ? parseKelvin(plan.endKelvin) : plan.endKelvin
  return {
    start: clampStart(plan.start, defaults.start),
    rampMinutes: clampInt(ramp, 0, MAX_RAMP, defaults.rampMinutes),
    endKelvin: clampKelvin(kelvin, defaults.endKelvin),
    morning: clampMorning(plan.morning, defaults.morning)
  }
}

// Any value (parsed JSON, garbage, null) -> complete, clamped settings.
function normalize(raw) {
  var s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  return {
    scheduleEnabled: typeof s.scheduleEnabled === "boolean" ? s.scheduleEnabled : DEFAULTS.scheduleEnabled,
    vacation: typeof s.vacation === "boolean" ? s.vacation : DEFAULTS.vacation,
    weekdays: normalizePlan(s.weekdays, DEFAULTS.weekdays),
    weekend: normalizePlan(s.weekend, DEFAULTS.weekend)
  }
}

function defaults() {
  return normalize({})
}

// The file's shape: times as "HH:MM" so the file reads and edits by hand.
function serialize(settings) {
  var s = normalize(settings)
  function plan(p) {
    return { start: formatTime(p.start), rampMinutes: p.rampMinutes, endKelvin: p.endKelvin, morning: formatTime(p.morning) }
  }
  return { scheduleEnabled: s.scheduleEnabled, vacation: s.vacation, weekdays: plan(s.weekdays), weekend: plan(s.weekend) }
}

// One step of a menu stepper, clamped. Start times step along the evening's
// axis, so 23:50 + 15 min is 00:05 and 12:00 - 15 min stays 12:00.
function stepField(field, value, delta) {
  if (field === "start") {
    var off = startOffset(clampStart(value, DEFAULTS.weekdays.start)) + delta
    off = Math.max(EARLIEST_START, Math.min(1440 + LATEST_START, off))
    return off % 1440
  }
  if (field === "morning") return Math.max(0, Math.min(LATEST_MORNING, clampMorning(value, 0) + delta))
  if (field === "rampMinutes") return clampInt(Number(value) + delta, 0, MAX_RAMP, 0)
  if (field === "endKelvin") return clampKelvin(Number(value) + delta)
  return value
}

// Typed text for a field -> the clamped value, or null when it does not parse.
function parseField(field, text) {
  var v
  if (field === "start") { v = parseTime(text); return v === null ? null : clampStart(v, null) }
  if (field === "morning") { v = parseTime(text); return v === null ? null : clampMorning(v, null) }
  if (field === "rampMinutes") { v = parseDuration(text); return v === null ? null : clampInt(v, 0, MAX_RAMP, null) }
  if (field === "endKelvin") { v = parseKelvin(text); return v === null ? null : clampKelvin(v, null) }
  return null
}

function formatField(field, value) {
  if (field === "start" || field === "morning") return formatTime(value)
  if (field === "rampMinutes") return Math.round(value) + " min"
  if (field === "endKelvin") return Math.round(value) + "K"
  return String(value)
}

// Fri and Sat evenings come before a day off; vacation makes every evening one.
function planKeyFor(settings, year, month, day) {
  if (settings.vacation) return "weekend"
  var weekday = new Date(year, month, day).getDay()
  return weekday === 5 || weekday === 6 ? "weekend" : "weekdays"
}

// The evening that starts on the given calendar day, in epoch milliseconds.
// Empty when its morning does not come after its start.
function eveningOf(settings, year, month, day) {
  var key = planKeyFor(settings, year, month, day)
  var plan = settings[key]
  var startAt = new Date(year, month, day, 0, startOffset(plan.start)).getTime()
  var morningAt = new Date(year, month, day + 1, 0, plan.morning).getTime()
  var fullRampEndAt = startAt + plan.rampMinutes * MINUTE
  var span = NEUTRAL - plan.endKelvin
  // The ramp steps on a fixed grid from its start: as long a step as keeps
  // each one within MAX_STEP_KELVIN, never shorter than MIN_STEP_MS.
  var stepMs = span > 0 && plan.rampMinutes > 0
    ? Math.max(MIN_STEP_MS, Math.floor(plan.rampMinutes * MINUTE * MAX_STEP_KELVIN / span))
    : Math.max(MIN_STEP_MS, plan.rampMinutes * MINUTE)
  return {
    plan: key,
    endKelvin: plan.endKelvin,
    rampMinutes: plan.rampMinutes,
    stepMs: stepMs,
    startAt: startAt,
    fullRampEndAt: fullRampEndAt,
    // A morning inside the ramp cuts the ramp short.
    rampEndAt: Math.min(fullRampEndAt, morningAt),
    morningAt: morningAt,
    empty: morningAt <= startAt
  }
}

function kelvinAt(evening, t) {
  if (evening.rampMinutes <= 0) return evening.endKelvin
  var progress = (t - evening.startAt) / (evening.fullRampEndAt - evening.startAt)
  progress = Math.max(0, Math.min(1, progress))
  return Math.round(NEUTRAL - (NEUTRAL - evening.endKelvin) * progress)
}

function nextEveningAfter(settings, t) {
  var d = new Date(t)
  for (var i = -1; i <= 8; i++) {
    var e = eveningOf(settings, d.getFullYear(), d.getMonth(), d.getDate() + i)
    if (!e.empty && e.startAt > t) return e
  }
  return null
}

// The target at an instant:
//   kelvin       what the screen should be (6500 = neutral, applied as identity)
//   phase        "day" | "ramp" | "night"
//   nextChangeAt Date the target next changes: the ramp's next step, or the
//                ramp start or the morning; null when it never changes
//   boundaryAt   Date of the next phase boundary (ramp start or morning),
//                where a manual override ends; null when there is none
//   plan, endKelvin   the evening in progress, or else the next one
//   rampEndAt, morningAt   Dates of the evening in progress, else null
//   nextStartAt, nextPlan, nextEndKelvin   the next evening to start
function targetAt(rawSettings, date) {
  var settings = normalize(rawSettings)
  var t = date instanceof Date ? date.getTime() : Number(date)
  if (!isFinite(t)) t = Date.now()
  var result = {
    kelvin: NEUTRAL, phase: "day", nextChangeAt: null, boundaryAt: null,
    plan: null, endKelvin: NEUTRAL, rampEndAt: null, morningAt: null,
    nextStartAt: null, nextPlan: null, nextEndKelvin: NEUTRAL
  }
  if (!settings.scheduleEnabled) return result

  var d = new Date(t)
  var current = null
  // An evening spans at most noon to noon, so only yesterday's or today's can
  // hold this instant.
  for (var i = -1; i <= 0 && !current; i++) {
    var e = eveningOf(settings, d.getFullYear(), d.getMonth(), d.getDate() + i)
    if (!e.empty && t >= e.startAt && t < e.morningAt) current = e
  }

  var next = nextEveningAfter(settings, current ? current.morningAt - 1 : t)
  if (next) {
    result.nextStartAt = new Date(next.startAt)
    result.nextPlan = next.plan
    result.nextEndKelvin = next.endKelvin
  }

  if (!current) {
    if (next) {
      result.nextChangeAt = new Date(next.startAt)
      result.boundaryAt = new Date(next.startAt)
      result.plan = next.plan
      result.endKelvin = next.endKelvin
    }
    return result
  }

  result.plan = current.plan
  result.endKelvin = current.endKelvin
  result.morningAt = new Date(current.morningAt)
  result.boundaryAt = new Date(current.morningAt)

  if (t < current.rampEndAt) {
    // Quantized to the step grid, so a timer that fires late never makes a
    // bigger jump than the grid allows.
    var step = Math.floor((t - current.startAt) / current.stepMs)
    var stepAt = current.startAt + step * current.stepMs
    result.phase = "ramp"
    result.kelvin = kelvinAt(current, stepAt)
    result.rampEndAt = new Date(current.rampEndAt)
    result.nextChangeAt = new Date(Math.min(stepAt + current.stepMs, current.rampEndAt))
  } else {
    result.phase = "night"
    result.kelvin = kelvinAt(current, current.rampEndAt)
    result.nextChangeAt = new Date(current.morningAt)
  }
  return result
}

// The warmth a left click on a neutral screen turns on: the end warmth of the
// evening in progress, or else of the next one.
function toggleWarmth(rawSettings, date) {
  var target = targetAt(rawSettings, date)
  if (target.plan) return target.endKelvin
  var s = normalize(rawSettings)
  var d = date instanceof Date ? date : new Date()
  return s[planKeyFor(s, d.getFullYear(), d.getMonth(), d.getDate())].endKelvin
}

if (typeof module !== "undefined") {
  module.exports = {
    NEUTRAL: NEUTRAL,
    WARMEST: WARMEST,
    MAX_RAMP: MAX_RAMP,
    MAX_STEP_KELVIN: MAX_STEP_KELVIN,
    MIN_STEP_MS: MIN_STEP_MS,
    DEFAULTS: DEFAULTS,
    normalize: normalize,
    defaults: defaults,
    serialize: serialize,
    parseTime: parseTime,
    formatTime: formatTime,
    parseDuration: parseDuration,
    formatDuration: formatDuration,
    parseKelvin: parseKelvin,
    clampKelvin: clampKelvin,
    stepField: stepField,
    parseField: parseField,
    formatField: formatField,
    planKeyFor: planKeyFor,
    eveningOf: eveningOf,
    targetAt: targetAt,
    toggleWarmth: toggleWarmth
  }
}
