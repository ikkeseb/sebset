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
// The stage-1 shape most cases were written for: a weekend plan of its own.
function own(overrides) {
  return defaults(Object.assign({ weekendMode: "own" }, overrides || {}))
}

test("daytime is neutral and waits for the weekday ramp", () => {
  const t = S.targetAt(defaults(), at(2026, 11, 24, 12, 0))
  assert.equal(t.phase, "day")
  assert.equal(t.kelvin, 6500)
  assert.deepEqual(t.nextChangeAt, at(2026, 11, 24, 18, 30))
  assert.deepEqual(t.boundaryAt, at(2026, 11, 24, 18, 30))
  assert.equal(t.plan, "evenings")
})

test("one minute before the start is still day", () => {
  const t = S.targetAt(defaults(), at(2026, 11, 24, 18, 29))
  assert.equal(t.phase, "day")
  assert.equal(t.kelvin, 6500)
})

test("the weekday ramp's midpoint is a band near halfway between neutral and the end warmth", () => {
  // 15 bands over 60 min: a step every 4 min; at 30 min seven steps are done.
  const t = S.targetAt(defaults(), at(2026, 11, 24, 19, 0))
  assert.equal(t.phase, "ramp")
  assert.equal(t.kelvin, 5800)
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
  assert.equal(t.plan, "evenings")
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

test("own times: Friday and Saturday evenings use the weekend plan into the next morning", () => {
  const fri = S.targetAt(own(), at(2026, 11, 27, 19, 0))
  assert.equal(fri.phase, "day")
  assert.equal(fri.plan, "weekend")
  assert.deepEqual(fri.nextChangeAt, at(2026, 11, 27, 20, 0))

  const friNight = S.targetAt(own(), at(2026, 11, 28, 8, 0))
  assert.equal(friNight.phase, "night")
  assert.equal(friNight.kelvin, 5500)
  assert.deepEqual(friNight.nextChangeAt, at(2026, 11, 28, 9, 0))

  const satRamp = S.targetAt(own(), at(2026, 11, 28, 20, 30))
  assert.equal(satRamp.plan, "weekend")
  assert.equal(satRamp.kelvin, 6000)

  const sunMorning = S.targetAt(own(), at(2026, 11, 29, 8, 30))
  assert.equal(sunMorning.phase, "night")
  assert.deepEqual(sunMorning.nextChangeAt, at(2026, 11, 29, 9, 0))
})

test("own times: Sunday evening is back on the evening plan, with its morning on Monday", () => {
  const sun = S.targetAt(own(), at(2026, 11, 29, 18, 45))
  assert.equal(sun.plan, "evenings")
  assert.equal(sun.phase, "ramp")
  const mon = S.targetAt(own(), at(2026, 11, 30, 7, 30))
  assert.equal(mon.phase, "day")
  assert.equal(mon.kelvin, 6500)
})

test("own times: Thursday's day points at Thursday's ramp, Friday's at the weekend one", () => {
  const thu = S.targetAt(own(), at(2026, 11, 26, 10, 0))
  assert.equal(thu.nextPlan, "evenings")
  assert.deepEqual(thu.nextStartAt, at(2026, 11, 26, 18, 30))
  const fri = S.targetAt(own(), at(2026, 11, 27, 10, 0))
  assert.equal(fri.nextPlan, "weekend")
  assert.deepEqual(fri.nextStartAt, at(2026, 11, 27, 20, 0))
})

test("own times with vacation runs the weekend plan every day", () => {
  const s = own({ vacation: true })
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
  for (const raw of [null, undefined, 42, "x", [], { evenings: "no" }, { weekendMode: "bogus" }, { evenings: { start: "25:99", rampMinutes: -5, endKelvin: 99999, morning: "15:30" } }]) {
    const t = S.targetAt(raw, at(2026, 11, 24, 21, 0))
    assert.ok(t.kelvin >= 3000 && t.kelvin <= 6500)
  }
  const s = S.normalize({
    scheduleEnabled: "yes",
    weekendMode: "sometimes",
    weekendMorning: "16:00",
    evenings: { start: "25:99", rampMinutes: 999, endKelvin: 100, morning: "15:30" },
    weekend: { start: "09:00", rampMinutes: "90", endKelvin: "4250K", morning: 600 }
  })
  assert.equal(s.scheduleEnabled, true)
  assert.equal(s.weekendMode, "same")
  assert.equal(s.weekendMorning, 14 * 60)
  assert.equal(s.evenings.start, 18 * 60 + 30) // unparseable -> default
  assert.equal(s.evenings.rampMinutes, 240)
  assert.equal(s.evenings.endKelvin, 3000)
  assert.equal(s.evenings.morning, 14 * 60)
  assert.equal(s.weekend.start, 12 * 60) // morning hours are not evenings
  assert.equal(s.weekend.rampMinutes, 90)
  assert.equal(s.weekend.endKelvin, 4300)
  assert.equal(s.weekend.morning, 10 * 60)
})

test("a morning inside the ramp cuts the ramp short", () => {
  const s = defaults({ evenings: { start: "23:30", rampMinutes: 240, endKelvin: 3000, morning: "01:00" } })
  const mid = S.targetAt(s, at(2026, 11, 25, 0, 30))
  assert.equal(mid.phase, "ramp")
  assert.deepEqual(mid.rampEndAt, at(2026, 11, 25, 1, 0))
  assert.ok(mid.kelvin < 6500 && mid.kelvin > 3000)
  assert.equal(mid.kelvin % 100, 0)
  const after = S.targetAt(s, at(2026, 11, 25, 1, 0))
  assert.equal(after.phase, "day")
  assert.equal(after.kelvin, 6500)
})

test("an evening whose morning comes before its start is skipped", () => {
  const s = defaults({ evenings: { start: "02:00", rampMinutes: 30, endKelvin: 4000, morning: "01:00" } })
  const t = S.targetAt(s, at(2026, 11, 25, 2, 30))
  assert.equal(t.phase, "day")
  assert.equal(t.kelvin, 6500)
})

test("a start after midnight belongs to the evening before", () => {
  const s = defaults({ evenings: { start: "00:30", rampMinutes: 30, endKelvin: 4000, morning: "07:00" } })
  const t = S.targetAt(s, at(2026, 11, 25, 0, 45)) // Tuesday's evening
  assert.equal(t.phase, "ramp")
  // 25 bands over 30 min, 72 s each: 12 done after 15 min.
  assert.equal(t.kelvin, 5300)
})

test("nextChangeAt steps through the ramp, then jumps to the morning", () => {
  // 1500K over 60 min: 15 bands, a step every 4 minutes.
  const inRamp = S.targetAt(defaults(), at(2026, 11, 24, 19, 0, 20))
  assert.deepEqual(inRamp.nextChangeAt, at(2026, 11, 24, 19, 2))
  const lastStep = S.targetAt(defaults(), at(2026, 11, 24, 19, 27, 30))
  assert.equal(lastStep.kelvin, 5100)
  assert.deepEqual(lastStep.nextChangeAt, at(2026, 11, 24, 19, 30))
  const night = S.targetAt(defaults(), at(2026, 11, 24, 19, 30))
  assert.equal(night.phase, "night")
  assert.deepEqual(night.nextChangeAt, at(2026, 11, 25, 7, 0))
})

function walkRamp(settings, from) {
  // Follow nextChangeAt the way the plugin's timer does and collect each
  // step as { at, kelvin }.
  let t = S.targetAt(settings, from)
  const steps = [{ at: from.getTime(), kelvin: t.kelvin }]
  let guard = 0
  while (t.phase !== "night" && guard++ < 10000) {
    const next = t.nextChangeAt
    t = S.targetAt(settings, next)
    steps.push({ at: next.getTime(), kelvin: t.kelvin })
    if (t.phase === "day") break
  }
  return steps
}

function assertBandSteps(steps, intervalMs) {
  for (const s of steps) assert.equal(s.kelvin % 100, 0, `${s.kelvin} is not on a band`)
  for (let i = 1; i < steps.length; i++) {
    assert.equal(steps[i - 1].kelvin - steps[i].kelvin, 100, `step ${i}: ${steps[i - 1].kelvin} -> ${steps[i].kelvin}`)
    const gap = steps[i].at - steps[i - 1].at
    assert.ok(gap >= 5000, `step ${i} comes ${gap} ms after the last`)
    if (intervalMs) assert.ok(Math.abs(gap - intervalMs) <= 1, `step ${i}: ${gap} ms, not ${intervalMs}`)
  }
}

test("a 60-minute ramp from 6500K to 5000K takes 15 band steps, 4 minutes apart", () => {
  const steps = walkRamp(defaults(), at(2026, 11, 24, 18, 30))
  assert.equal(steps[0].kelvin, 6500)
  assert.equal(steps[1].kelvin, 6400)
  assert.equal(steps.length - 1, 15)
  assert.equal(steps[steps.length - 1].kelvin, 5000)
  assert.equal(steps[steps.length - 1].at, at(2026, 11, 24, 19, 30).getTime())
  assertBandSteps(steps, 4 * 60000)
})

test("a 1-minute ramp to 3000K takes 35 steps of 5 s and ends late", () => {
  const s = defaults({ evenings: { start: "18:30", rampMinutes: 1, endKelvin: 3000, morning: "07:00" } })
  const steps = walkRamp(s, at(2026, 11, 24, 18, 30))
  assert.equal(steps.length - 1, 35)
  assert.equal(steps[steps.length - 1].kelvin, 3000)
  assert.equal(steps[steps.length - 1].at - steps[0].at, 35 * 5000)
  assertBandSteps(steps, 5000)
  const t = S.targetAt(s, at(2026, 11, 24, 18, 31))
  assert.equal(t.phase, "ramp")
  assert.deepEqual(t.rampEndAt, at(2026, 11, 24, 18, 32, 55))
})

test("a 3-minute ramp to 6000K takes 5 steps, 36 s apart", () => {
  const s = defaults({ evenings: { start: "18:30", rampMinutes: 3, endKelvin: 6000, morning: "07:00" } })
  const steps = walkRamp(s, at(2026, 11, 24, 18, 30))
  assert.deepEqual(steps.map((x) => x.kelvin), [6500, 6400, 6300, 6200, 6100, 6000])
  assertBandSteps(steps, 36000)
})

test("every ramp steps one band at a time, never sooner than 5 s, with no short last step", () => {
  for (const rampMinutes of [1, 2, 7, 10, 37, 60, 61, 99, 240]) {
    for (const endKelvin of [3000, 3700, 4500, 5000, 5900, 6400]) {
      const s = defaults({ evenings: { start: "18:43", rampMinutes, endKelvin, morning: "07:00" } })
      const steps = walkRamp(s, at(2026, 11, 24, 18, 43))
      const bands = (6500 - endKelvin) / 100
      assert.equal(steps.length - 1, bands, `${rampMinutes} min to ${endKelvin}K`)
      const interval = Math.max(5000, rampMinutes * 60000 / bands)
      assertBandSteps(steps, interval)
    }
  }
})

test("a timer that fires late still lands on a band, one step at a time", () => {
  const t = S.targetAt(defaults(), at(2026, 11, 24, 18, 41, 59))
  assert.equal(t.kelvin, 6300)
  assert.deepEqual(t.nextChangeAt, at(2026, 11, 24, 18, 42))
})

test("a 0-minute ramp switches to the end warmth at the start time", () => {
  const s = defaults({ evenings: { start: "18:30", rampMinutes: 0, endKelvin: 4800, morning: "07:00" } })
  assert.equal(S.targetAt(s, at(2026, 11, 24, 18, 29, 59)).kelvin, 6500)
  const t = S.targetAt(s, at(2026, 11, 24, 18, 30))
  assert.equal(t.phase, "night")
  assert.equal(t.kelvin, 4800)
  assert.deepEqual(t.nextChangeAt, at(2026, 11, 25, 7, 0))
})

test("a 37-minute ramp from 18:43 lands on the minute", () => {
  const s = defaults({ evenings: { start: "18:43", rampMinutes: 37, endKelvin: 5000, morning: "06:17" } })
  assert.equal(S.targetAt(s, at(2026, 11, 24, 18, 42, 59)).phase, "day")
  const start = S.targetAt(s, at(2026, 11, 24, 18, 43))
  assert.equal(start.phase, "ramp")
  assert.deepEqual(start.rampEndAt, at(2026, 11, 24, 19, 20))
  const end = S.targetAt(s, at(2026, 11, 24, 19, 20))
  assert.equal(end.phase, "night")
  assert.equal(end.kelvin, 5000)
  assert.deepEqual(end.nextChangeAt, at(2026, 11, 25, 6, 17))
  assertBandSteps(walkRamp(s, at(2026, 11, 24, 18, 43)), 37 * 60000 / 15)
})

test("DST: the spring-forward night ends at the clock's morning", () => {
  // Europe/Oslo jumps from 02:00 to 03:00 on Sunday 2026-03-29.
  const sat = S.targetAt(own(), at(2026, 3, 28, 23, 0))
  assert.equal(sat.phase, "night")
  assert.deepEqual(sat.nextChangeAt, at(2026, 3, 29, 9, 0))
  assert.equal(sat.nextChangeAt.getHours(), 9)
  const sunEvening = S.targetAt(own(), at(2026, 3, 29, 12, 0))
  assert.equal(hm(sunEvening.nextChangeAt), "18:30")
})

test("DST: the fall-back night ends at the clock's morning and a ramp across the change stays linear", () => {
  // Europe/Oslo goes from 03:00 back to 02:00 on Sunday 2026-10-25.
  const sat = S.targetAt(own(), at(2026, 10, 24, 23, 0))
  assert.equal(hm(sat.nextChangeAt), "09:00")
  const s = own({ weekend: { start: "01:30", rampMinutes: 120, endKelvin: 4500, morning: "09:00" } })
  // 01:30 to 03:30 on the wall is three real hours that night; the ramp is two real hours.
  const start = at(2026, 10, 25, 1, 30)
  const mid = S.targetAt(s, new Date(start.getTime() + 60 * 60000))
  assert.equal(mid.phase, "ramp")
  // 20 bands over two real hours: ten done after one.
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
  assert.equal(S.parseField("endKelvin", "5150"), 5200)
  assert.equal(S.parseField("endKelvin", "5149"), 5100)
  assert.equal(S.parseField("rampMinutes", "300"), 240)
  assert.equal(S.parseField("start", "09:00"), 12 * 60)
  assert.equal(S.parseField("start", "03:10"), 3 * 60 + 10)
  assert.equal(S.parseField("morning", "garbage"), null)
  assert.equal(S.parseField("morning", "14:00"), 14 * 60)
  assert.equal(S.parseField("morning", "14:01"), 14 * 60)
  assert.equal(S.parseField("morning", "00:00"), 0)
})

test("steppers clamp and wrap the evening axis", () => {
  assert.equal(S.stepField("start", 23 * 60 + 50, 15), 5)
  assert.equal(S.stepField("start", 12 * 60, -15), 12 * 60)
  assert.equal(S.stepField("start", 5 * 60 + 50, 15), 5 * 60 + 59)
  assert.equal(S.stepField("morning", 11 * 60 + 50, 15), 12 * 60 + 5)
  assert.equal(S.stepField("morning", 13 * 60 + 50, 15), 14 * 60)
  assert.equal(S.stepField("rampMinutes", 3, -5), 0)
  assert.equal(S.stepField("rampMinutes", 238, 5), 240)
  assert.equal(S.stepField("endKelvin", 3100, -100), 3000)
  assert.equal(S.stepField("endKelvin", 5000, 100), 5100)
})

test("serialize round-trips through normalize", () => {
  const s = S.normalize({ weekendMode: "sleepIn", weekendMorning: "10:30", evenings: { start: "18:43", rampMinutes: 37, endKelvin: 5123, morning: "06:17" } })
  const file = S.serialize(s)
  assert.equal(file.evenings.start, "18:43")
  assert.equal(file.evenings.morning, "06:17")
  assert.equal(file.evenings.endKelvin, 5100)
  assert.equal(file.weekendMode, "sleepIn")
  assert.equal(file.weekendMorning, "10:30")
  assert.deepEqual(S.normalize(JSON.parse(JSON.stringify(file))), s)
})

test("a left click on a neutral screen turns on the coming evening's warmth", () => {
  assert.equal(S.toggleWarmth(defaults(), at(2026, 11, 24, 12, 0)), 5000)
  assert.equal(S.toggleWarmth(defaults(), at(2026, 11, 27, 12, 0)), 5000)
  assert.equal(S.toggleWarmth(own(), at(2026, 11, 27, 12, 0)), 5500)
  assert.equal(S.toggleWarmth(own({ scheduleEnabled: false }), at(2026, 11, 27, 12, 0)), 5500)
})

// ---- Weekend modes -------------------------------------------------------
// Friday 2026-11-27 and Tuesday 2026-11-24, each at 08:00 the next morning:
// past the evening plan's 07:00, before the weekend's 09:00.

test("weekends the same: Friday night ends at the evening plan's morning, like Tuesday", () => {
  const s = defaults()
  assert.equal(S.targetAt(s, at(2026, 11, 27, 20, 0)).plan, "evenings")
  assert.equal(S.targetAt(s, at(2026, 11, 28, 8, 0)).phase, "day")
  assert.equal(S.targetAt(s, at(2026, 11, 25, 8, 0)).phase, "day")
  assert.equal(S.targetAt(s, at(2026, 11, 27, 22, 0)).kelvin, 5000)
})

test("sleep in: Friday night runs the evening plan into the weekend morning, Tuesday does not", () => {
  const s = defaults({ weekendMode: "sleepIn", weekendMorning: "09:00" })
  const friRamp = S.targetAt(s, at(2026, 11, 27, 19, 0))
  assert.equal(friRamp.plan, "weekend")
  assert.equal(friRamp.phase, "ramp") // the evening plan's 18:30 start
  const friNight = S.targetAt(s, at(2026, 11, 28, 8, 0))
  assert.equal(friNight.phase, "night")
  assert.equal(friNight.kelvin, 5000) // the evening plan's warmth
  assert.deepEqual(friNight.nextChangeAt, at(2026, 11, 28, 9, 0))
  const tueMorning = S.targetAt(s, at(2026, 11, 25, 8, 0))
  assert.equal(tueMorning.phase, "day")
})

test("own times: Friday night runs the weekend plan, Tuesday the evening plan", () => {
  const s = own()
  const fri = S.targetAt(s, at(2026, 11, 28, 8, 0))
  assert.equal(fri.phase, "night")
  assert.equal(fri.kelvin, 5500)
  assert.equal(S.targetAt(s, at(2026, 11, 27, 19, 0)).phase, "day") // the weekend starts 20:00
  assert.equal(S.targetAt(s, at(2026, 11, 25, 8, 0)).phase, "day")
  assert.equal(S.targetAt(s, at(2026, 11, 24, 22, 0)).kelvin, 5000)
})

test("vacation with sleep in: every night sleeps in; vacation alone changes nothing", () => {
  const s = defaults({ weekendMode: "sleepIn", weekendMorning: "10:00", vacation: true })
  const tue = S.targetAt(s, at(2026, 11, 25, 9, 30))
  assert.equal(tue.phase, "night")
  assert.equal(tue.plan, "weekend")
  assert.equal(tue.kelvin, 5000)
  assert.deepEqual(tue.nextChangeAt, at(2026, 11, 25, 10, 0))
  const same = defaults({ vacation: true })
  assert.equal(S.targetAt(same, at(2026, 11, 25, 8, 0)).phase, "day")
})

test("switching modes keeps the weekend plan's values", () => {
  const s = S.normalize({ weekendMode: "same", weekend: { start: "19:45", rampMinutes: 30, endKelvin: 5600, morning: "10:00" } })
  assert.equal(S.serialize(s).weekend.start, "19:45")
  assert.equal(S.serialize(s).weekend.endKelvin, 5600)
})

test("a file from before weekend modes still reads its evening plan", () => {
  const s = S.normalize({ weekdays: { start: "19:10", rampMinutes: 45, endKelvin: 4800, morning: "06:30" } })
  assert.equal(s.evenings.start, 19 * 60 + 10)
  assert.equal(s.evenings.endKelvin, 4800)
  assert.equal(s.weekendMode, "same")
})

test("a late morning after an early start hands over to the new evening", () => {
  // Morning 14:00, start 12:30: each evening would run into the next one.
  const s = defaults({ evenings: { start: "12:30", rampMinutes: 10, endKelvin: 6000, morning: "14:00" } })
  const t = S.targetAt(s, at(2026, 11, 25, 12, 40))
  assert.equal(t.phase, "night")
  assert.equal(t.kelvin, 6000)
  assert.deepEqual(t.morningAt, at(2026, 11, 26, 12, 30))
  const handover = S.targetAt(s, at(2026, 11, 25, 12, 29))
  assert.equal(handover.phase, "night")
  assert.deepEqual(handover.nextChangeAt, at(2026, 11, 25, 12, 30))
})
