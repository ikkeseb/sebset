// Run with `node --test tests/`. Dates are local wall-clock times in
// Europe/Oslo, so the DST cases mean the same thing on every machine.
process.env.TZ = "Europe/Oslo"

const test = require("node:test")
const assert = require("node:assert/strict")
const S = require("../Schedule.js")

// 2026-11-23 is a Monday; 2026-11-27 a Friday.
function at(y, mo, d, h, mi, s) {
  return new Date(y, mo - 1, d, h, mi, s || 0)
}
function hm(date) {
  return date ? S.formatTime(date.getHours() * 60 + date.getMinutes()) : null
}
function defaults(overrides) {
  return Object.assign(S.serialize(S.defaults()), overrides || {})
}

test("daytime is neutral and waits for the weekday ramp", () => {
  const t = S.targetAt(defaults(), at(2026, 11, 24, 12, 0))
  assert.equal(t.phase, "day")
  assert.equal(t.kelvin, 6500)
  assert.deepEqual(t.nextChangeAt, at(2026, 11, 24, 18, 30))
  assert.deepEqual(t.boundaryAt, at(2026, 11, 24, 18, 30))
  assert.equal(t.plan, "weekdays")
})

test("one minute before the start is still day", () => {
  const t = S.targetAt(defaults(), at(2026, 11, 24, 18, 29))
  assert.equal(t.phase, "day")
  assert.equal(t.kelvin, 6500)
})

test("the weekday ramp's midpoint is halfway between neutral and the end warmth", () => {
  const t = S.targetAt(defaults(), at(2026, 11, 24, 19, 0))
  assert.equal(t.phase, "ramp")
  assert.equal(t.kelvin, 5750)
  assert.deepEqual(t.rampEndAt, at(2026, 11, 24, 19, 30))
  assert.deepEqual(t.boundaryAt, at(2026, 11, 25, 7, 0))
})

test("the ramp starts neutral, on the dot", () => {
  const t = S.targetAt(defaults(), at(2026, 11, 24, 18, 30))
  assert.equal(t.phase, "ramp")
  assert.equal(t.kelvin, 6500)
})

test("after the ramp, night holds the end warmth until the morning", () => {
  const t = S.targetAt(defaults(), at(2026, 11, 24, 21, 15))
  assert.equal(t.phase, "night")
  assert.equal(t.kelvin, 5000)
  assert.deepEqual(t.nextChangeAt, at(2026, 11, 25, 7, 0))
})

test("past midnight still belongs to the evening before", () => {
  const t = S.targetAt(defaults(), at(2026, 11, 25, 2, 30))
  assert.equal(t.phase, "night")
  assert.equal(t.kelvin, 5000)
  assert.equal(t.plan, "weekdays")
  assert.deepEqual(t.nextChangeAt, at(2026, 11, 25, 7, 0))
})

test("the morning boundary is instant: neutral on the minute", () => {
  const before = S.targetAt(defaults(), at(2026, 11, 25, 6, 59, 59))
  const after = S.targetAt(defaults(), at(2026, 11, 25, 7, 0))
  assert.equal(before.kelvin, 5000)
  assert.equal(after.phase, "day")
  assert.equal(after.kelvin, 6500)
  assert.deepEqual(after.nextChangeAt, at(2026, 11, 25, 18, 30))
})

test("Friday and Saturday evenings use the weekend plan into the next morning", () => {
  const fri = S.targetAt(defaults(), at(2026, 11, 27, 19, 0))
  assert.equal(fri.phase, "day")
  assert.equal(fri.plan, "weekend")
  assert.deepEqual(fri.nextChangeAt, at(2026, 11, 27, 20, 0))

  const friNight = S.targetAt(defaults(), at(2026, 11, 28, 8, 0))
  assert.equal(friNight.phase, "night")
  assert.equal(friNight.kelvin, 5500)
  assert.deepEqual(friNight.nextChangeAt, at(2026, 11, 28, 9, 0))

  const satRamp = S.targetAt(defaults(), at(2026, 11, 28, 20, 30))
  assert.equal(satRamp.plan, "weekend")
  assert.equal(satRamp.kelvin, 6000)

  const sunMorning = S.targetAt(defaults(), at(2026, 11, 29, 8, 30))
  assert.equal(sunMorning.phase, "night")
  assert.deepEqual(sunMorning.nextChangeAt, at(2026, 11, 29, 9, 0))
})

test("Sunday evening is back on weekdays, with a weekday morning on Monday", () => {
  const sun = S.targetAt(defaults(), at(2026, 11, 29, 18, 45))
  assert.equal(sun.plan, "weekdays")
  assert.equal(sun.phase, "ramp")
  const mon = S.targetAt(defaults(), at(2026, 11, 30, 7, 30))
  assert.equal(mon.phase, "day")
  assert.equal(mon.kelvin, 6500)
})

test("Thursday's day points at Thursday's weekday ramp, Friday's at the weekend one", () => {
  const thu = S.targetAt(defaults(), at(2026, 11, 26, 10, 0))
  assert.equal(thu.nextPlan, "weekdays")
  assert.deepEqual(thu.nextStartAt, at(2026, 11, 26, 18, 30))
  const fri = S.targetAt(defaults(), at(2026, 11, 27, 10, 0))
  assert.equal(fri.nextPlan, "weekend")
  assert.deepEqual(fri.nextStartAt, at(2026, 11, 27, 20, 0))
})

test("vacation runs the weekend plan every day", () => {
  const s = defaults({ vacation: true })
  const tue = S.targetAt(s, at(2026, 11, 24, 19, 0))
  assert.equal(tue.phase, "day")
  assert.equal(tue.plan, "weekend")
  const tueNight = S.targetAt(s, at(2026, 11, 25, 8, 0))
  assert.equal(tueNight.phase, "night")
  assert.equal(tueNight.kelvin, 5500)
})

test("schedule off is neutral with nothing scheduled", () => {
  const t = S.targetAt(defaults({ scheduleEnabled: false }), at(2026, 11, 24, 22, 0))
  assert.equal(t.phase, "day")
  assert.equal(t.kelvin, 6500)
  assert.equal(t.nextChangeAt, null)
  assert.equal(t.boundaryAt, null)
})

test("bad settings clamp to something usable and never throw", () => {
  for (const raw of [null, undefined, 42, "x", [], { weekdays: "no" }, { weekdays: { start: "25:99", rampMinutes: -5, endKelvin: 99999, morning: "13:30" } }]) {
    const t = S.targetAt(raw, at(2026, 11, 24, 21, 0))
    assert.ok(t.kelvin >= 3000 && t.kelvin <= 6500)
  }
  const s = S.normalize({
    scheduleEnabled: "yes",
    weekdays: { start: "25:99", rampMinutes: 999, endKelvin: 100, morning: "13:30" },
    weekend: { start: "09:00", rampMinutes: "90", endKelvin: "4200K", morning: 600 }
  })
  assert.equal(s.scheduleEnabled, true)
  assert.equal(s.weekdays.start, 18 * 60 + 30) // unparseable -> default
  assert.equal(s.weekdays.rampMinutes, 240)
  assert.equal(s.weekdays.endKelvin, 3000)
  assert.equal(s.weekdays.morning, 12 * 60)
  assert.equal(s.weekend.start, 12 * 60) // morning hours are not evenings
  assert.equal(s.weekend.rampMinutes, 90)
  assert.equal(s.weekend.endKelvin, 4200)
  assert.equal(s.weekend.morning, 10 * 60)
})

test("a morning inside the ramp cuts the ramp short", () => {
  const s = defaults({ weekdays: { start: "23:30", rampMinutes: 240, endKelvin: 3000, morning: "01:00" } })
  const mid = S.targetAt(s, at(2026, 11, 25, 0, 30))
  assert.equal(mid.phase, "ramp")
  assert.deepEqual(mid.rampEndAt, at(2026, 11, 25, 1, 0))
  assert.ok(mid.kelvin < 6500 && mid.kelvin > 3000)
  const after = S.targetAt(s, at(2026, 11, 25, 1, 0))
  assert.equal(after.phase, "day")
  assert.equal(after.kelvin, 6500)
})

test("an evening whose morning comes before its start is skipped", () => {
  const s = defaults({ weekdays: { start: "02:00", rampMinutes: 30, endKelvin: 4000, morning: "01:00" } })
  const t = S.targetAt(s, at(2026, 11, 25, 2, 30))
  assert.equal(t.phase, "day")
  assert.equal(t.kelvin, 6500)
})

test("a start after midnight belongs to the evening before", () => {
  const s = defaults({ weekdays: { start: "00:30", rampMinutes: 30, endKelvin: 4000, morning: "07:00" } })
  const t = S.targetAt(s, at(2026, 11, 25, 0, 45)) // Tuesday's evening
  assert.equal(t.phase, "ramp")
  assert.equal(t.kelvin, 5250)
})

test("nextChangeAt steps through the ramp, then jumps to the morning", () => {
  // 1500K over 60 min: 25K a minute, so a step every 60 s.
  const inRamp = S.targetAt(defaults(), at(2026, 11, 24, 19, 0, 20))
  assert.deepEqual(inRamp.nextChangeAt, at(2026, 11, 24, 19, 1))
  const lastStep = S.targetAt(defaults(), at(2026, 11, 24, 19, 29, 30))
  assert.deepEqual(lastStep.nextChangeAt, at(2026, 11, 24, 19, 30))
  const night = S.targetAt(defaults(), at(2026, 11, 24, 19, 30))
  assert.equal(night.phase, "night")
  assert.deepEqual(night.nextChangeAt, at(2026, 11, 25, 7, 0))
})

function walkRamp(settings, from) {
  // Follow nextChangeAt the way the plugin's timer does and collect the steps.
  let t = S.targetAt(settings, from)
  const values = [t.kelvin]
  let guard = 0
  while (t.phase !== "night" && guard++ < 10000) {
    const next = t.nextChangeAt
    t = S.targetAt(settings, next)
    values.push(t.kelvin)
    if (t.phase === "day") break
  }
  return values
}

test("a 10-minute ramp steps every 10 s and never more than 25K", () => {
  const s = defaults({ weekdays: { start: "18:30", rampMinutes: 10, endKelvin: 5000, morning: "07:00" } })
  const t = S.targetAt(s, at(2026, 11, 24, 18, 30, 3))
  assert.deepEqual(t.nextChangeAt, at(2026, 11, 24, 18, 30, 10))
  const values = walkRamp(s, at(2026, 11, 24, 18, 30))
  assert.equal(values[0], 6500)
  assert.equal(values[values.length - 1], 5000)
  for (let i = 1; i < values.length; i++) assert.ok(Math.abs(values[i] - values[i - 1]) <= 25, `step ${i}: ${values[i - 1]} -> ${values[i]}`)
})

test("every default ramp steps by at most 25K", () => {
  for (const day of [24, 27]) {
    const values = walkRamp(defaults(), at(2026, 11, day, 18, 0))
    for (let i = 1; i < values.length; i++) assert.ok(Math.abs(values[i] - values[i - 1]) <= 25)
  }
})

test("a steep ramp is held to one step per 5 s", () => {
  const s = defaults({ weekdays: { start: "18:30", rampMinutes: 1, endKelvin: 3000, morning: "07:00" } })
  const t = S.targetAt(s, at(2026, 11, 24, 18, 30, 1))
  assert.deepEqual(t.nextChangeAt, at(2026, 11, 24, 18, 30, 5))
})

test("a 0-minute ramp switches to the end warmth at the start time", () => {
  const s = defaults({ weekdays: { start: "18:30", rampMinutes: 0, endKelvin: 4800, morning: "07:00" } })
  assert.equal(S.targetAt(s, at(2026, 11, 24, 18, 29, 59)).kelvin, 6500)
  const t = S.targetAt(s, at(2026, 11, 24, 18, 30))
  assert.equal(t.phase, "night")
  assert.equal(t.kelvin, 4800)
  assert.deepEqual(t.nextChangeAt, at(2026, 11, 25, 7, 0))
})

test("a 37-minute ramp from 18:43 lands on the minute", () => {
  const s = defaults({ weekdays: { start: "18:43", rampMinutes: 37, endKelvin: 5000, morning: "06:17" } })
  assert.equal(S.targetAt(s, at(2026, 11, 24, 18, 42, 59)).phase, "day")
  const start = S.targetAt(s, at(2026, 11, 24, 18, 43))
  assert.equal(start.phase, "ramp")
  assert.deepEqual(start.rampEndAt, at(2026, 11, 24, 19, 20))
  const end = S.targetAt(s, at(2026, 11, 24, 19, 20))
  assert.equal(end.phase, "night")
  assert.equal(end.kelvin, 5000)
  assert.deepEqual(end.nextChangeAt, at(2026, 11, 25, 6, 17))
  const values = walkRamp(s, at(2026, 11, 24, 18, 43))
  for (let i = 1; i < values.length; i++) assert.ok(Math.abs(values[i] - values[i - 1]) <= 25)
})

test("DST: the spring-forward night ends at the clock's morning", () => {
  // Europe/Oslo jumps from 02:00 to 03:00 on Sunday 2026-03-29.
  const sat = S.targetAt(defaults(), at(2026, 3, 28, 23, 0))
  assert.equal(sat.phase, "night")
  assert.deepEqual(sat.nextChangeAt, at(2026, 3, 29, 9, 0))
  assert.equal(sat.nextChangeAt.getHours(), 9)
  const sunEvening = S.targetAt(defaults(), at(2026, 3, 29, 12, 0))
  assert.equal(hm(sunEvening.nextChangeAt), "18:30")
})

test("DST: the fall-back night ends at the clock's morning and a ramp across the change stays linear", () => {
  // Europe/Oslo goes from 03:00 back to 02:00 on Sunday 2026-10-25.
  const sat = S.targetAt(defaults(), at(2026, 10, 24, 23, 0))
  assert.equal(hm(sat.nextChangeAt), "09:00")
  const s = defaults({ weekend: { start: "01:30", rampMinutes: 120, endKelvin: 4500, morning: "09:00" } })
  // 01:30 to 03:30 on the wall is three real hours that night; the ramp is two real hours.
  const start = at(2026, 10, 25, 1, 30)
  const mid = S.targetAt(s, new Date(start.getTime() + 60 * 60000))
  assert.equal(mid.phase, "ramp")
  assert.equal(mid.kelvin, 5500)
  assert.equal(mid.rampEndAt.getTime() - start.getTime(), 120 * 60000)
})

test("parsers take typed values and reject garbage", () => {
  assert.equal(S.parseTime("18:43"), 18 * 60 + 43)
  assert.equal(S.parseTime("1843"), 18 * 60 + 43)
  assert.equal(S.parseTime("7"), 7 * 60)
  assert.equal(S.parseTime("24:00"), 0)
  assert.equal(S.parseTime("18:60"), null)
  assert.equal(S.parseTime("<b>"), null)
  assert.equal(S.parseDuration("37"), 37)
  assert.equal(S.parseDuration("1:05"), 65)
  assert.equal(S.parseDuration("1h 5m"), 65)
  assert.equal(S.parseDuration("1.5h"), 90)
  assert.equal(S.parseDuration("soon"), null)
  assert.equal(S.parseKelvin("5200K"), 5200)
  assert.equal(S.parseField("endKelvin", "9000"), 6500)
  assert.equal(S.parseField("rampMinutes", "300"), 240)
  assert.equal(S.parseField("start", "09:00"), 12 * 60)
  assert.equal(S.parseField("start", "03:10"), 3 * 60 + 10)
  assert.equal(S.parseField("morning", "garbage"), null)
})

test("steppers clamp and wrap the evening axis", () => {
  assert.equal(S.stepField("start", 23 * 60 + 50, 15), 5)
  assert.equal(S.stepField("start", 12 * 60, -15), 12 * 60)
  assert.equal(S.stepField("start", 5 * 60 + 50, 15), 5 * 60 + 59)
  assert.equal(S.stepField("morning", 11 * 60 + 50, 15), 12 * 60)
  assert.equal(S.stepField("rampMinutes", 3, -5), 0)
  assert.equal(S.stepField("rampMinutes", 238, 5), 240)
  assert.equal(S.stepField("endKelvin", 3050, -100), 3000)
})

test("serialize round-trips through normalize", () => {
  const s = S.normalize({ weekdays: { start: "18:43", rampMinutes: 37, endKelvin: 5123, morning: "06:17" } })
  const file = S.serialize(s)
  assert.equal(file.weekdays.start, "18:43")
  assert.equal(file.weekdays.morning, "06:17")
  assert.deepEqual(S.normalize(JSON.parse(JSON.stringify(file))), s)
})

test("a left click on a neutral screen turns on the coming evening's warmth", () => {
  assert.equal(S.toggleWarmth(defaults(), at(2026, 11, 24, 12, 0)), 5000)
  assert.equal(S.toggleWarmth(defaults(), at(2026, 11, 27, 12, 0)), 5500)
  assert.equal(S.toggleWarmth(defaults({ scheduleEnabled: false }), at(2026, 11, 27, 12, 0)), 5500)
})
