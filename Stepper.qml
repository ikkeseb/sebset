import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Schedule.js" as Schedule

// One plan field: a label, then − value +. The buttons take coarse steps; the
// value takes a typed exact entry (click it, type, Enter) and the mouse wheel
// over it takes fine steps, so every minute and kelvin is reachable.
Item {
  id: root

  property string label: ""
  property string field: ""
  property int value: 0
  property int step: 15
  property int fineStep: 1
  property string hint: ""
  property color foreground: Commons.Color.foreground
  property color accent: Commons.Color.accent
  property string fontFamily: Style.font.family
  // Where keyboard focus goes back to when an entry ends.
  property Item focusReturn: null
  readonly property bool editing: input.activeFocus

  signal edited(int value)

  implicitWidth: Style.space(300)
  implicitHeight: Style.spacing.controlHeight

  property real wheelAccumulator: 0

  function commitTyped() {
    var parsed = Schedule.parseField(root.field, input.text)
    if (parsed !== null && parsed !== root.value) root.edited(parsed)
    input.text = Schedule.formatField(root.field, root.value)
  }

  function endEditing() {
    if (root.focusReturn) root.focusReturn.forceActiveFocus()
    else input.focus = false
  }

  Text {
    textFormat: Text.PlainText
    text: root.label
    color: Qt.darker(root.foreground, 1.15)
    font.family: root.fontFamily
    font.pixelSize: Style.font.body
    anchors.left: parent.left
    anchors.leftMargin: Style.space(6)
    anchors.verticalCenter: parent.verticalCenter
  }

  Row {
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(4)

    Button {
      text: "−"
      foreground: root.foreground
      fontFamily: root.fontFamily
      horizontalPadding: Style.space(8)
      verticalPadding: Style.space(2)
      anchors.verticalCenter: parent.verticalCenter
      onClicked: root.edited(Schedule.stepField(root.field, root.value, -root.step))
    }

    BorderSurface {
      id: box
      width: Style.space(84)
      height: Style.spacing.controlHeight
      radius: Style.cornerRadius
      anchors.verticalCenter: parent.verticalCenter
      readonly property bool hot: boxMouse.containsMouse || input.activeFocus
      color: input.activeFocus ? Style.focusFillFor(root.foreground, root.accent)
        : (boxMouse.containsMouse ? Style.hoverFillFor(root.foreground, root.accent) : "transparent")
      borderSpec: Border.controlSpec(input.activeFocus ? "focus" : (hot ? "hover-cursor" : "normal"), root.foreground, root.accent)

      TextInput {
        id: input
        anchors.fill: parent
        anchors.leftMargin: Style.space(4)
        anchors.rightMargin: Style.space(4)
        horizontalAlignment: TextInput.AlignHCenter
        verticalAlignment: TextInput.AlignVCenter
        color: root.foreground
        selectionColor: Style.selectionFillFor(root.foreground, root.accent)
        selectedTextColor: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        font.bold: true
        maximumLength: 12
        selectByMouse: true
        clip: true
        text: Schedule.formatField(root.field, root.value)

        onActiveFocusChanged: {
          if (activeFocus) {
            text = Schedule.formatField(root.field, root.value).replace(/[^0-9:]/g, "")
            selectAll()
          } else {
            root.commitTyped()
          }
        }
        onAccepted: root.endEditing()
        Keys.onEscapePressed: function(event) {
          text = Schedule.formatField(root.field, root.value)
          root.endEditing()
          event.accepted = true
        }
      }

      Connections {
        target: root
        function onValueChanged() {
          if (!input.activeFocus) input.text = Schedule.formatField(root.field, root.value)
        }
      }

      MouseArea {
        id: boxMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.IBeamCursor
        // Clicks fall through to the TextInput; this only takes the wheel.
        acceptedButtons: Qt.NoButton
        onWheel: function(wheel) {
          var steps = Util.wheelSteps(root.wheelAccumulator, wheel.angleDelta.y)
          root.wheelAccumulator = steps.remainder
          if (steps.steps !== 0)
            root.edited(Schedule.stepField(root.field, root.value, steps.steps * root.fineStep))
        }
      }

      PanelToolTip {
        visible: boxMouse.containsMouse && !input.activeFocus && root.hint !== ""
        text: root.hint
        fontFamily: root.fontFamily
      }
    }

    Button {
      text: "+"
      foreground: root.foreground
      fontFamily: root.fontFamily
      horizontalPadding: Style.space(8)
      verticalPadding: Style.space(2)
      anchors.verticalCenter: parent.verticalCenter
      onClicked: root.edited(Schedule.stepField(root.field, root.value, root.step))
    }
  }
}
