import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "Schedule.js" as Schedule

// Sebset's engine, loaded once by the shell however many bars show the icon.
//
// The schedule in Schedule.js decides the temperature; this file applies it
// through hyprsunset, holds a manual change until the next phase boundary,
// and keeps the settings file. The bar widgets (Panel.qml, one per monitor)
// show its state and call its functions.
//
// Running cost: one single-shot Timer, re-armed for the next change the
// schedule knows about (capped at 15 minutes, which only recomputes in JS).
// A process runs only when the applied temperature actually changes.
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
  // changed again" (the schedule is off). Memory only.
  property var manual: null

  // What the screen shows, as far as this plugin set it.
  property bool appliedKnown: false
  property int appliedKelvin: neutral
  readonly property int shownKelvin: manual ? manual.kelvin : target.kelvin
  readonly property bool warm: shownKelvin < neutral

  // ---- Applying ------------------------------------------------------------

  property bool hasPending: false
  property int pendingKelvin: neutral

  function apply(kelvin) {
    var k = Schedule.clampKelvin(kelvin)
    if (appliedKnown && (k === appliedKelvin || (k >= neutral && appliedKelvin >= neutral))) return
    appliedKnown = true
    appliedKelvin = k
    if (applyProcess.running) {
      pendingKelvin = k
      hasPending = true
      return
    }
    runApply(k)
  }

  function runApply(k) {
    // 6500K still tints, so neutral is the identity matrix. Only numbers reach
    // the command line. hyprsunset is started first when it is not running,
    // the way Omarchy's own night light does it.
    var command = k >= neutral ? "hyprctl hyprsunset identity" : "hyprctl hyprsunset temperature " + Math.round(k)
    applyProcess.command = ["sh", "-c",
      "pgrep -x hyprsunset >/dev/null || { setsid uwsm-app -- hyprsunset >/dev/null 2>&1 & sleep 1; }; "
      + command + " >/dev/null"]
    applyProcess.running = true
  }

  Process {
    id: applyProcess
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        console.warn("sebset: applying the temperature failed, exit code", exitCode)
        // Unknown again, so the next tick tries once more.
        root.appliedKnown = false
      }
      if (root.hasPending) {
        root.hasPending = false
        root.runApply(root.pendingKelvin)
      }
    }
  }

  // ---- Schedule ------------------------------------------------------------

  property double nextTickAt: 0

  function tick() {
    var now = new Date()
    var t = Schedule.targetAt(config, now)
    target = t
    if (manual && manual.until > 0 && now.getTime() >= manual.until) manual = null
    apply(manual ? manual.kelvin : t.kelvin)

    var next = t.nextChangeAt ? t.nextChangeAt.getTime() : Infinity
    if (manual && manual.until > 0) next = Math.min(next, manual.until)
    // A little past the instant, so the tick lands after it, not just before.
    var wait = isFinite(next) ? next - now.getTime() + 50 : maxTimerMs
    scheduleTimer.interval = Math.max(250, Math.min(maxTimerMs, wait))
    nextTickAt = now.getTime() + scheduleTimer.interval
    scheduleTimer.restart()
  }

  Timer {
    id: scheduleTimer
    repeat: false
    onTriggered: root.tick()
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

  // Wheel up warms, the way the menu's slider warms to the right.
  function nudge(steps) {
    setManual(Math.max(warmest, Math.min(neutral, shownKelvin - steps * scrollStep)))
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
    config = Schedule.normalize(raw)
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

  Timer {
    id: saveTimer
    interval: 400
    onTriggered: root.save()
  }

  function save() {
    if (!dirReady) {
      if (!mkdirProcess.running) {
        mkdirProcess.command = ["mkdir", "-p", root.configDir]
        mkdirProcess.running = true
      }
      return
    }
    var text = JSON.stringify(Schedule.serialize(config), null, 2) + "\n"
    configText = text
    settingsFile.setText(text)
  }

  Process {
    id: mkdirProcess
    onExited: function(exitCode) {
      root.dirReady = exitCode === 0
      if (root.dirReady) root.save()
      else console.warn("sebset: cannot create", root.configDir)
    }
  }

  // `omarchy-shell sebset open|close|toggle` comes with Panel; these are extra.
  ShellIpc {
    target: "sebset.nightlight"
    // The bar icon's left click and one wheel notch, for keybindings.
    function toggleWarm(): void { root.toggleWarm() }
    function warmer(): void { root.nudge(1) }
    function cooler(): void { root.nudge(-1) }
    function resume(): void { root.manual = null; root.tick() }
    function toggleSchedule(): void { root.updateConfig(function(c) { c.scheduleEnabled = !c.scheduleEnabled }) }
    function toggleVacation(): void { root.updateConfig(function(c) { c.vacation = !c.vacation }) }
    function status(): string {
      return JSON.stringify({
        kelvin: root.shownKelvin,
        applied: root.appliedKnown ? (root.appliedKelvin >= root.neutral ? "identity" : root.appliedKelvin) : null,
        phase: root.target.phase,
        manual: root.manual !== null,
        manualUntil: root.manual && root.manual.until > 0 ? new Date(root.manual.until).toISOString() : null,
        nextTick: root.nextTickAt > 0 ? new Date(root.nextTickAt).toISOString() : null
      })
    }
  }
}
