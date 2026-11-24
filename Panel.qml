import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Schedule.js" as Schedule

// Sebset's bar icon and menu. A bar on every monitor makes one of these each;
// they all show and drive the one engine in Service.qml, which the shell
// loads once.
//
// Left click toggles warm and neutral, the wheel nudges the warmth (up is
// warmer), right click opens the menu.
Panel {
  id: root
  moduleName: "sebset.nightlight"
  ipcTarget: "sebset"

  // The shared engine. A shell without third-party services gets one of its
  // own, which still works, one engine per bar.
  property var engine: null
  readonly property var nl: engine || (localEngine.item ? localEngine.item : null)
  readonly property bool ready: nl !== null

  // The bar is injected after the widget completes, so the lookup waits for it.
  function findEngine() {
    if (!bar) return
    var found = bar.shell && typeof bar.shell.serviceFor === "function"
      ? bar.shell.serviceFor("sebset.nightlight") : null
    engine = found || null
    localEngine.active = !engine
  }

  onBarChanged: findEngine()

  Loader {
    id: localEngine
    active: false
    source: Qt.resolvedUrl("Service.qml")
  }

  readonly property int neutral: Schedule.NEUTRAL
  readonly property int warmest: Schedule.WARMEST
  readonly property int shownKelvin: ready ? nl.shownKelvin : neutral
  readonly property bool warm: shownKelvin < neutral
  readonly property var config: ready ? nl.config : Schedule.defaults()

  readonly property color foreground: bar ? bar.foreground : Commons.Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  property real wheelAccumulator: 0
  property int editors: 0

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  function clock(date) {
    return date ? Schedule.formatTime(date.getHours() * 60 + date.getMinutes()) : ""
  }

  function kelvinText(k) {
    return k >= neutral ? strings.t("neutral") : Math.round(k) + "K"
  }

  readonly property string statusText: {
    if (!root.ready) return strings.t("title")
    var k = root.shownKelvin
    var manual = root.nl.manual
    var target = root.nl.target
    if (manual) {
      if (manual.until > 0)
        return strings.t("status.held").arg(kelvinText(k)).arg(clock(new Date(manual.until)))
      return strings.t("status.manual").arg(kelvinText(k))
    }
    if (!root.config.scheduleEnabled) return strings.t("status.off")
    if (target.phase === "ramp") return strings.t("status.ramp").arg(kelvinText(k)).arg(clock(target.rampEndAt))
    if (target.phase === "night") return strings.t("status.night").arg(kelvinText(k)).arg(clock(target.morningAt))
    if (target.nextStartAt) return strings.t("status.day").arg(clock(target.nextStartAt))
    return strings.t("neutral")
  }

  function setManual(kelvin) { if (ready) nl.setManual(kelvin) }
  function updateConfig(mutate) { if (ready) nl.updateConfig(mutate) }

  // The slider applies at once, at most every 80 ms while dragging.
  property int sliderKelvin: neutral
  function slideTo(kelvin) {
    sliderKelvin = Math.round(kelvin / 50) * 50
    if (sliderThrottle.running) return
    setManual(sliderKelvin)
    sliderThrottle.start()
  }

  Timer {
    id: sliderThrottle
    interval: 80
    onTriggered: if (root.sliderKelvin !== root.shownKelvin) root.setManual(root.sliderKelvin)
  }

  // ---- Bar icon ------------------------------------------------------------

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰔎"
    active: root.warm
    activeColor: Commons.Color.accent
    tooltipText: root.statusText

    onPressed: function(b) {
      if (b === Qt.RightButton) root.togglePanel()
      else if (b === Qt.LeftButton && root.ready) root.nl.toggleWarm()
    }

    onWheelMoved: function(delta) {
      var wheel = Util.wheelSteps(root.wheelAccumulator, delta)
      root.wheelAccumulator = wheel.remainder
      if (wheel.steps !== 0 && root.ready) root.nl.nudge(wheel.steps)
    }
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  // In the middle of the bar the panel opens centred under it and holds the
  // centre still, as Omarchy's clock and weather panels do.
  property bool centredOnBar: false

  function inMiddleOfBar() {
    var window = root.QsWindow.window
    if (!window) return false
    var vertical = root.bar && root.bar.vertical
    var at = root.mapToItem(null, root.width / 2, root.height / 2)
    var span = vertical ? window.height : window.width
    var middle = vertical ? at.y : at.x
    return span > 0 && middle > span / 3 && middle < span * 2 / 3
  }

  function openPanel() {
    root.centredOnBar = root.inMiddleOfBar()
    root.open()
    if (root.centredOnBar) Qt.callLater(function() {
      if (root.opened && root.bar && typeof root.bar.setCenterHoverRevealSuppressed === "function")
        root.bar.setCenterHoverRevealSuppressed(true)
    })
  }

  function togglePanel() {
    if (root.opened) root.close()
    else root.openPanel()
  }

  onOpenedChanged: {
    if (!opened && centredOnBar && bar && typeof bar.setCenterHoverRevealSuppressed === "function")
      bar.setCenterHoverRevealSuppressed(false)
    if (opened && ready) nl.tick()
  }

  // ---- Menu ----------------------------------------------------------------

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    centerOnBar: root.centredOnBar
    focusTarget: panel.loadedContent
    contentWidth: panel.fittedContentWidth(Style.space(340))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight, Style.space(640))

    content: PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      implicitHeight: menuColumn.implicitHeight
      blocked: root.editors > 0
      onMoveRequested: function(dx, dy) {
        // Left and right move the warmth, like the slider.
        if (dx !== 0 && root.ready) root.nl.nudge(dx)
      }
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        var key = t.toLowerCase()
        if (key === "v") root.updateConfig(function(c) { c.vacation = !c.vacation })
        else if (key === "s") root.updateConfig(function(c) { c.scheduleEnabled = !c.scheduleEnabled })
      }

      Column {
        id: menuColumn
        width: parent.width
        spacing: Style.space(12)

        // Hero: glyph, title, what is happening; the schedule switch.
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, scheduleSwitch.implicitHeight)

          Text {
            id: heroIcon
            textFormat: Text.PlainText
            text: "󰔎"
            color: root.warm ? Commons.Color.accent : root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: scheduleSwitch.left
            anchors.rightMargin: Style.space(12)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              textFormat: Text.PlainText
              text: strings.t("title")
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
              width: parent.width
            }

            Text {
              textFormat: Text.PlainText
              text: root.statusText.toUpperCase()
              color: Qt.darker(root.foreground, 1.4)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
              width: parent.width
            }
          }

          ToggleSwitch {
            id: scheduleSwitch
            checked: root.config.scheduleEnabled
            foreground: root.foreground
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            onToggled: root.updateConfig(function(c) { c.scheduleEnabled = !c.scheduleEnabled })

            PanelToolTip {
              visible: scheduleSwitch.containsMouse
              text: root.config.scheduleEnabled ? strings.t("schedule.turnOff") : strings.t("schedule.turnOn")
              fontFamily: root.fontFamily
            }
          }
        }

        PanelSeparator { foreground: root.foreground }

        // Now: the warmth slider. Right is warmer.
        Column {
          width: parent.width
          spacing: Style.space(6)

          Item {
            width: parent.width
            implicitHeight: Math.max(nowHeader.implicitHeight, nowValue.implicitHeight)

            PanelSectionHeader {
              id: nowHeader
              text: strings.t("now")
              foreground: root.foreground
              fontFamily: root.fontFamily
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
            }

            Text {
              id: nowValue
              textFormat: Text.PlainText
              text: root.kelvinText(warmthSlider.dragging ? root.neutral - warmthSlider.liveValue : root.shownKelvin)
              color: Qt.darker(root.foreground, 1.4)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              anchors.right: parent.right
              anchors.rightMargin: Style.space(6)
              anchors.verticalCenter: parent.verticalCenter
            }
          }

          PanelSlider {
            id: warmthSlider
            bar: root.bar
            width: parent.width
            minimum: 0
            maximum: root.neutral - root.warmest
            step: 250
            value: root.neutral - root.shownKelvin
            fillColor: Commons.Color.accent
            onMoved: function(v) { root.slideTo(root.neutral - v) }
            onReleased: function(v) { root.setManual(Math.round((root.neutral - v) / 50) * 50) }
          }
        }

        PanelSeparator { foreground: root.foreground }

        PlanSection {
          planKey: "weekdays"
          title: strings.t("weekdays")
          caption: root.config.vacation ? strings.t("weekdays.paused") : strings.t("weekdays.caption")
          dimmed: root.config.vacation || !root.config.scheduleEnabled
        }

        PanelSeparator { foreground: root.foreground }

        PlanSection {
          planKey: "weekend"
          title: strings.t("weekend")
          caption: root.config.vacation ? strings.t("weekend.vacation") : strings.t("weekend.caption")
          dimmed: !root.config.scheduleEnabled
        }

        PanelSeparator { foreground: root.foreground }

        Toggle {
          width: parent.width
          label: strings.t("vacation")
          description: strings.t("vacation.description")
          checked: root.config.vacation
          foreground: root.foreground
          fontFamily: root.fontFamily
          onClicked: root.updateConfig(function(c) { c.vacation = !c.vacation })
        }
      }
    }
  }

  component PlanSection: Column {
    id: planSection
    property string planKey: ""
    property string title: ""
    property string caption: ""
    property bool dimmed: false
    readonly property var plan: root.config[planKey]

    width: parent ? parent.width : implicitWidth
    spacing: Style.space(4)
    opacity: dimmed ? 0.55 : 1

    Item {
      width: parent.width
      implicitHeight: Math.max(sectionHeader.implicitHeight, sectionCaption.implicitHeight) + Style.space(2)

      PanelSectionHeader {
        id: sectionHeader
        text: planSection.title
        foreground: root.foreground
        fontFamily: root.fontFamily
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
      }

      Text {
        id: sectionCaption
        textFormat: Text.PlainText
        text: planSection.caption
        color: Qt.darker(root.foreground, 1.4)
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        anchors.right: parent.right
        anchors.rightMargin: Style.space(6)
        anchors.verticalCenter: parent.verticalCenter
      }
    }

    PlanStepper { host: planSection; field: "start"; label: strings.t("field.start"); step: 15; fineStep: 1; hint: strings.t("hint.time") }
    PlanStepper { host: planSection; field: "rampMinutes"; label: strings.t("field.ramp"); step: 5; fineStep: 1; hint: strings.t("hint.ramp") }
    PlanStepper { host: planSection; field: "endKelvin"; label: strings.t("field.warmth"); step: 100; fineStep: 10; hint: strings.t("hint.kelvin") }
    PlanStepper { host: planSection; field: "morning"; label: strings.t("field.morning"); step: 15; fineStep: 1; hint: strings.t("hint.time") }
  }

  component PlanStepper: Stepper {
    property var host: null
    width: host ? host.width : implicitWidth
    value: host && host.plan ? host.plan[field] : 0
    foreground: root.foreground
    fontFamily: root.fontFamily
    focusReturn: panel.loadedContent
    onEditingChanged: root.editors = Math.max(0, root.editors + (editing ? 1 : -1))
    onEdited: function(v) { if (host && root.ready) root.nl.setPlanField(host.planKey, field, v) }
  }
}
