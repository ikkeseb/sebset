import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import "Schedule.js" as Schedule

// Sebset's engine, loaded once by the shell however many bars show the icon.
//
// The schedule in Schedule.js decides the temperature; this file applies it
// through hyprsunset, holds a manual change until the next phase boundary,
// and keeps the settings file. The bar widgets (Panel.qml, one per monitor)
// show its state and call its functions.
//
// Running cost: one single-shot Timer, re-armed for the next change the
// schedule knows about, capped at 15 minutes. A process runs when the applied
// 100K band changes, and once per capped tick to re-assert the band (anything
// else may have moved hyprsunset meanwhile: its own profiles, a restart,
// Omarchy's stock toggle).
Item {
  id: root

  // Injected by omarchy-shell.
  property var shell: null

  readonly property int neutral: Schedule.NEUTRAL
  readonly property int warmest: Schedule.WARMEST
  readonly property int scrollStep: 250
  readonly property int maxTimerMs: 15 * 60 * 1000

  readonly property string configDir: {
    var xdg = Quickshell.env("XDG_CONFIG_HOME")
    var base = xdg && String(xdg).charAt(0) === "/" ? String(xdg) : Quickshell.env("HOME") + "/.config"
    return base + "/sebset"
  }
  readonly property string settingsPath: configDir + "/settings.json"

  property var config: Schedule.defaults()
  property string configText: ""
  // The schedule's answer for now, refreshed on every tick.
  property var target: Schedule.targetAt(config, new Date())
  // A manual change: { kelvin, until } with until in epoch ms, 0 for "until
  // changed again" (the schedule is off). Memory only. The kelvin keeps the
  // wheel's 250K steps; what is applied and shown is its 100K band.
  property var manual: null

  // What the screen shows, as far as this plugin set it: always a band.
  property bool appliedKnown: false
  property int appliedKelvin: neutral
  readonly property int shownKelvin: Schedule.band(manual ? manual.kelvin : target.kelvin)
  readonly property bool warm: shownKelvin < neutral

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // ---- Applying ------------------------------------------------------------

  // hyprsunset shows 100K bands, and 6500K and up is the identity matrix here.
  function sameBand(a, b) {
    return a === b || (a >= neutral && b >= neutral)
  }

  property bool hasPending: false
  property int pendingKelvin: neutral
  property int inFlightKelvin: neutral
  // A failed apply tries once more after 5 s, then waits for the next tick.
  property bool retried: false

  // `force` re-asserts a band the cache says is already on the screen.
  function apply(kelvin, force) {
    var k = Schedule.band(kelvin)
    if (!force && appliedKnown && sameBand(k, appliedKelvin)) return
    appliedKnown = true
    appliedKelvin = k
    if (applyProcess.running) {
      // The value in flight lands anyway; queue only something different.
      hasPending = !sameBand(k, inFlightKelvin)
      pendingKelvin = k
      return
    }
    runApply(k)
  }

  function runApply(k) {
    // 6500K still tints, so neutral is the identity matrix. Only numbers reach
    // the command line. When hyprsunset is not running it is started the way
    // Omarchy's own night light does it, then given up to 5 s to answer.
    // `timeout` keeps a stalled hyprsunset from holding the apply queue.
    var command = k >= neutral ? "timeout 5 hyprctl hyprsunset identity" : "timeout 5 hyprctl hyprsunset temperature " + Math.round(k)
    inFlightKelvin = k
    applyProcess.command = ["sh", "-c",
      "if ! pgrep -x hyprsunset >/dev/null; then "
      + "setsid uwsm-app -- hyprsunset >/dev/null 2>&1 & "
      + "i=0; until timeout 1 hyprctl hyprsunset temperature >/dev/null 2>&1 || [ $i -ge 20 ]; do sleep 0.25; i=$((i+1)); done; "
      + "fi; " + command + " >/dev/null"]
    applyProcess.running = true
  }

  Process {
    id: applyProcess
    onExited: function(exitCode) {
      if (root.hasPending) {
        root.hasPending = false
        root.runApply(root.pendingKelvin)
        return
      }
      if (exitCode === 0) {
        root.retried = false
        return
      }
      console.warn("sebset: applying the temperature failed, exit code", exitCode)
      // Unknown again, so a later tick applies whatever it wants.
      root.appliedKnown = false
      if (!root.retried) {
        root.retried = true
        retryTimer.restart()
      }
    }
  }

  Timer {
    id: retryTimer
    interval: 5000
    onTriggered: root.apply(root.shownKelvin, true)
  }

  // ---- Schedule ------------------------------------------------------------

  property double nextTickAt: 0
  // Whether the armed tick is the 15-minute cap rather than a change.
  property bool capped: false

  function tick(reassert) {
    var now = new Date()
    var t = Schedule.targetAt(config, now)
    target = t
    if (manual && manual.until > 0 && now.getTime() >= manual.until) manual = null
    retried = false
    apply(manual ? manual.kelvin : t.kelvin, reassert === true)

    var next = t.nextChangeAt ? t.nextChangeAt.getTime() : Infinity
    if (manual && manual.until > 0) next = Math.min(next, manual.until)
    // A little past the instant, so the tick lands after it, not just before.
    var wait = isFinite(next) ? next - now.getTime() + 50 : Infinity
    capped = wait >= maxTimerMs
    scheduleTimer.interval = Math.max(250, Math.min(maxTimerMs, wait))
    nextTickAt = now.getTime() + scheduleTimer.interval
    scheduleTimer.restart()
  }

  Timer {
    id: scheduleTimer
    repeat: false
    onTriggered: root.tick(root.capped)
  }

  // A manual change holds until the next ramp start or morning.
  function setManual(kelvin) {
    var now = new Date()
    var t = Schedule.targetAt(config, now)
    var until = config.scheduleEnabled && t.boundaryAt ? t.boundaryAt.getTime() : 0
    manual = { kelvin: Schedule.clampKelvin(kelvin), until: until }
    tick()
  }

  function toggleWarm() {
    if (warm) setManual(neutral)
    else setManual(Schedule.toggleWarmth(config, new Date()))
  }

  // Wheel up warms, the way the menu's slider warms to the right. The steps
  // stay 250K from the last wheel value, whatever band that showed.
  function nudge(steps) {
    var from = manual ? manual.kelvin : shownKelvin
    setManual(Math.max(warmest, Math.min(neutral, from - steps * scrollStep)))
  }

  // ---- Feedback ------------------------------------------------------------

  // Omarchy's OSD with the value just set: the glyph, "5300K" or "Neutral",
  // and a bar that fills as it warms (empty at neutral, full at 3000K). A
  // third-party plugin may not summon the OSD in-process, so this goes
  // through the shell's IPC. Only the IPC commands below use it: from a
  // keybinding there is no tooltip under the pointer to show the value.
  property string pendingOsd: ""

  function showOsd() {
    var k = shownKelvin
    var payload = JSON.stringify({
      icon: "󰔎",
      value: neutral - k,
      max: neutral - warmest,
      progressText: k >= neutral ? strings.t("neutral") : k + "K"
    })
    if (osdProcess.running) {
      pendingOsd = payload
      return
    }
    osdProcess.command = ["omarchy-shell", "-q", "osd", "show", payload]
    osdProcess.running = true
  }

  Process {
    id: osdProcess
    onExited: {
      if (root.pendingOsd === "") return
      var payload = root.pendingOsd
      root.pendingOsd = ""
      osdProcess.command = ["omarchy-shell", "-q", "osd", "show", payload]
      osdProcess.running = true
    }
  }

  // ---- Settings ------------------------------------------------------------

  // A change from the menu is what the user wants from now on, so it also
  // ends a manual hold.
  function updateConfig(mutate) {
    var next = JSON.parse(JSON.stringify(config))
    mutate(next)
    config = Schedule.normalize(next)
    manual = null
    saveTimer.restart()
    tick()
  }

  function setPlanField(planKey, field, value) {
    updateConfig(function(c) { c[planKey][field] = value })
  }

  function readSettings(text) {
    var raw = null
    try {
      raw = String(text || "").trim() === "" ? null : JSON.parse(text)
    } catch (e) {
      console.warn("sebset: ignoring unreadable settings file", settingsPath)
    }
    var next = Schedule.normalize(raw)
    // A file that says something new is a settings change: it ends a hold.
    if (JSON.stringify(next) !== JSON.stringify(config)) manual = null
    config = next
    tick()
  }

  FileView {
    id: settingsFile
    path: root.settingsPath
    watchChanges: true
    // An atomic write swaps the file for a new inode, which the watch on the
    // old one never sees; a hand edit after the menu's first save would go
    // unnoticed. The file is small enough to write in place.
    atomicWrites: false
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      var text = settingsFile.text()
      // Our own write comes back here too; the same text changes nothing.
      if (root.settingsRead && text === root.configText) return
      root.settingsRead = true
      root.configText = text
      root.readSettings(text)
    }
    onLoadFailed: function() {
      root.settingsRead = true
      root.configText = ""
      root.readSettings("")
    }
  }

  // The first tick waits for the settings, so startup applies once.
  property bool settingsRead: false
  property bool dirReady: false
  property bool saveWanted: false

  Timer {
    id: saveTimer
    interval: 400
    onTriggered: root.save()
  }

  function save() {
    if (!dirReady) {
      saveWanted = true
      return
    }
    saveWanted = false
    var text = JSON.stringify(Schedule.serialize(config), null, 2) + "\n"
    configText = text
    settingsFile.setText(text)
  }

  // The folder exists from the start, so a settings file made by hand later
  // is seen; a missing file still means the defaults. Runs once.
  Component.onCompleted: {
    mkdirProcess.command = ["mkdir", "-p", root.configDir]
    mkdirProcess.running = true
  }

  Process {
    id: mkdirProcess
    onExited: function(exitCode) {
      root.dirReady = exitCode === 0
      // The FileView may have looked before the folder existed; point it at
      // the path again so a settings file made by hand later is watched.
      if (root.dirReady) { settingsFile.path = ""; settingsFile.path = root.settingsPath }
      if (!root.dirReady) console.warn("sebset: cannot create", root.configDir)
      else if (root.saveWanted) root.save()
    }
  }

  // `omarchy-shell sebset open|close|toggle` comes with Panel; these are extra.
  ShellIpc {
    target: "sebset.nightlight"
    // The bar icon's left click and one wheel notch, for keybindings.
    function toggleWarm(): void { root.toggleWarm(); root.showOsd() }
    function warmer(): void { root.nudge(1); root.showOsd() }
    function cooler(): void { root.nudge(-1); root.showOsd() }
    function resume(): void { root.manual = null; root.tick() }
    function toggleSchedule(): void { root.updateConfig(function(c) { c.scheduleEnabled = !c.scheduleEnabled }) }
    function toggleVacation(): void { root.updateConfig(function(c) { c.vacation = !c.vacation }) }
    function status(): string {
      return JSON.stringify({
        kelvin: root.shownKelvin,
        applied: root.appliedKnown ? (root.appliedKelvin >= root.neutral ? "identity" : root.appliedKelvin) : null,
        weekendMode: root.config.weekendMode,
        phase: root.target.phase,
        manual: root.manual !== null,
        manualUntil: root.manual && root.manual.until > 0 ? new Date(root.manual.until).toISOString() : null,
        nextTick: root.nextTickAt > 0 ? new Date(root.nextTickAt).toISOString() : null
      })
    }
  }
}
