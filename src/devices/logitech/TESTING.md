# Logitech hardware test checklist

Test in Chrome or Edge over HTTPS. Close Logitech G HUB and Logitech Gaming
Software first — they hold the same vendor interface open and the mouse will
stop answering. Select the vendor collection (`usagePage 0xff00`, `usage
0x0001`), not the plain pointer collection.

Supported identifiers:

- `046d:c54d`, `046d:c547` — Lightspeed receivers
- `046d:c539` — HERO-era Lightspeed receiver
- `046d:c548` — Logi Bolt receiver (MX Master 3S and other Bolt mice)
- `046d:c0a8` — PRO X 2 Superstrike (USB)
- `046d:c07e` — G402 / G402 Hyperion Fury (wired)
- `046d:c08f` — G403 HERO (wired)

For Logi Bolt, authorize **both** HID++ collections when the picker offers them
(`usagePage 0xff00`, `usage 0x0001` and `usage 0x0002`). Device feature traffic
uses the long-report collection (`usage 0x0002`). Close Logi Options+ first —
it holds the same vendor interface.

## Receiver-attached and Superstrike devices

1. Confirm the model, battery, connection type, DPI, polling rate, and
   lift-off distance are read correctly.
2. Change one setting at a time and confirm each write, then reload and confirm
   it persisted.

## G402 (direct-connect, HID++ device index `0xFF`)

The G402 is addressed as the mouse itself rather than a receiver slot, and it
exposes only the legacy feature set: Adjustable DPI `0x2201` and Report Rate
`0x8060`. It has no lift-off, gaming-surface, battery, or hall-effect controls,
so those cards stay hidden.

1. Confirm the sidebar and title show the mouse, and that the connection reads
   **Wired**.
2. Confirm the firmware list and the HID++ device details section populate.
3. Confirm the DPI presets offer 420 / 840 / 1596 / 3192 — the nearest steps on
   the G402's 84-DPI grid — and that the reported DPI matches what Logitech
   Gaming Software shows, allowing for its rounding (2436 is shown as "2400").
4. Stage a DPI change and flash it. The driver writes `0x2201` function 3 as a
   short request and re-reads the value; a mismatch is reported as an error
   rather than being assumed to have worked.
5. Confirm the sensor card (lift-off distance) is hidden — the G402 has no
   `0x2202` feature to drive it.
6. Confirm the polling-rate buttons show the active rate but are **disabled**,
   with the note explaining the rate lives in the onboard profile.
7. Confirm the mouse stays in onboard mode: its own DPI-stage buttons must keep
   working after OpenMouse writes a DPI value. The driver deliberately does not
   switch the G402 into host-control mode.
8. Reload the page and confirm the DPI written in step 4 is still reported.

## G403 HERO (direct-connect, HID++ device index `0xFF`)

The G403 HERO reports HID++ 4.2 and takes the same direct-connect path as the
G402: legacy Adjustable DPI `0x2201` and legacy Report Rate `0x8060`, no
`0x2202`, so the lift-off/sensor card stays hidden. Its sensor range is much
wider (100–25,600 DPI in steps of 50) and its onboard profile uses format `2`
with seven 256-byte sectors, so none of the G402's profile offsets apply to it.

1. Confirm the sidebar and title show the mouse and the connection reads
   **Wired**.
2. Confirm the firmware list and the HID++ device details section populate.
3. Confirm the DPI presets offer 400 / 800 / 1600 / 3200 / 6400 / 8000 — all
   exact multiples on the 50-DPI grid — and that the reported DPI matches G HUB.
4. Stage a DPI change and flash it. The driver writes `0x2201` function 3 as a
   short request and re-reads the value; a mismatch is reported as an error.
5. Confirm the polling-rate buttons show the active rate but are **disabled**.
   The reference trace shows `0x8060` advertising 125/250/500/1000 Hz, and its
   function 2 is not a verified setter on this generation.
6. Confirm the mouse stays in onboard mode: its own DPI-stage button must keep
   working after OpenMouse writes a DPI value.
7. Reload the page and confirm the DPI written in step 4 is still reported.

RGB lighting (`0x8070`, logo and wheel zones) is deliberately not implemented —
the write packet is unverified and the panel has no Logitech lighting controls.

Persistent polling-rate and DPI-stage changes need a CRC-checked rewrite of the
1024-byte profile sector and are intentionally not implemented. Record the
device identifier, protocol version, and any failing setting in the issue or
pull request. Do not use factory reset during initial testing.

## G309 LIGHTSPEED (receiver-attached, Model ID `B03C40B10000`)

The G309 exposes Extended Adjustable DPI `0x2202` and Mode Status `0x8090`, but
only the power-mode half of Mode Status is meaningful: the status1 byte that
would carry the gaming-surface and LightForce fields is reserved and reads 0.
The `0x2202` sensor likewise reports lift-off level 0, the feature's "no
lift-off control" value. OpenMouse treats both as absent, so those cards stay
hidden.

1. Confirm the model, battery, connection type, DPI, and polling rate are read
   correctly.
2. Confirm the sensor card (lift-off distance), the gaming-surface card, and
   the LightForce switch are all hidden.
3. Change the DPI and polling rate and confirm each write persists after a
   reload.

## MX Master 3S (Logi Bolt `046d:c548`, WPID `B034`)

The MX Master 3S pairs to a Logi Bolt receiver. HID++ 2.0 feature calls use
**long** reports on pairing slot 1–6 (often slot 2), not device index `0xFF`.
It exposes Adjustable DPI `0x2201` and Unified Battery `0x1004`, and has no
`0x8060`/`0x8061` report-rate feature and no lift-off / onboard-profile path.

1. Close Logi Options+. Authorize both Bolt HID++ collections if offered.
2. Confirm the sidebar shows the Bolt receiver / MX Master 3S, connection
   **Wireless**, battery percentage, and DPI.
3. Confirm the sensor (lift-off) card and polling-rate buttons stay inactive /
   noted as unavailable — this mouse has no HID++ polling control.
4. Stage a DPI change and flash it. Confirm read-back matches and the value
   persists after a reload.
5. If connect fails with "invalid command", the short collection alone was
   selected — reconnect and include usage `0x0002`.
