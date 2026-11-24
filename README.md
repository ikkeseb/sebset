# Sebset

A gentle night light for the [Omarchy](https://omarchy.org) bar, like f.lux. In the evening the
screen warms slowly, in steps too small to notice; in the morning it goes back to neutral.
It drives the `hyprsunset` Omarchy already ships and costs next to nothing to run.

![The Sebset menu](docs/menu.png)

## Install

```bash
omarchy plugin add https://github.com/ikkeseb/sebset.git --enable
```

The icon appears next to the clock.

## Use

- **Left click**: warm ↔ neutral.
- **Scroll**: warmer or cooler. The tooltip shows the value as you go.
- **Right click**: the menu. Set when the evening starts, how long the fade takes, how warm it
  ends and when morning comes. Weekends can use the same plan, sleep in, or get their own times,
  and a vacation switch makes every night a weekend night.

A manual change holds until the schedule's next turn (the next evening or morning).

## Tip: smooth steps

If you see a short hitch when the colour changes, turn off Hyprland's colour fade. In
`~/.config/hypr/looknfeel.lua`:

```lua
hl.config({ render = { ctm_animation = 0 } })
```

## Uninstall

```bash
omarchy plugin remove sebset.nightlight
hyprctl hyprsunset identity
```

Keybindings, the settings file, how the schedule works and what it costs to run:
[docs/details.md](docs/details.md).

## License

MIT
