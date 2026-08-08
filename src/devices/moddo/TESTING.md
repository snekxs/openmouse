# moddoMOUSE hardware test checklist

Test in Chrome or Edge over HTTPS. Select only the vendor configuration
collection (`usagePage 0xff`, `usage 0x01`; older firmware answers on
`usage 0x02`) when the browser lists multiple HID interfaces.

Supported identifiers:

- VID `2fe3` — moddo.io
- `2fe3:0001` — 2.4 GHz dongle (wireless)
- `2fe3:0002` — wired

The driver only reads and writes documented settings (DPI, report rate, and
lift-off distance) from the packed config feature report `0x02`; it never flashes
firmware, pairs the receiver, or remaps buttons. Report layout follows the
moddoHUB-Web reference (`js/main.js`, `js/battery.js`, `js/firmware.js`).

1. Connect the device and confirm the wired/wireless state, battery (wireless
   only), firmware version(s), DPI, and polling rate are correct.
2. Change one setting at a time: DPI (50–26,000 in 50-DPI steps, per axis),
   polling rate (125 / 250 / 500 / 1000 Hz), and lift-off distance
   (1 mm = Medium, 2 mm = High — Low is not offered).
3. Reload after each write and confirm the value persisted on the mouse. Writes
   are fire-and-forget, so the driver settles and re-reads before reporting; a
   value that will not stick surfaces an explicit error rather than a silent
   revert.
4. Confirm a sleeping wireless mouse shows "settings not ready" rather than
   0 DPI / 0 Hz, then wakes and reads correctly.
5. Record the device identifier, firmware version, and any failing setting in
   the issue or pull request.
