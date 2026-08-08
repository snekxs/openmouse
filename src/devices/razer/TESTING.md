# Razer hardware test checklist

Test in Chrome or Edge over HTTPS. Quit Razer Synapse first — it holds the
control interface open and reads then time out.

Identifiers verified on hardware:

- `1532:00a5` — Viper V2 Pro, wired
- `1532:00a6` — Viper V2 Pro, Stock receiver
- `1532:00c0` — Viper V3 Pro, wired
- `1532:00c1` — Viper V3 Pro, HyperSpeed receiver
- `1532:008a` — Viper Mini, wired
- `1532:006e` — DeathAdder Essential, wired
- `1532:0071` — DeathAdder Essential White Edition, wired
- `1532:0098` — DeathAdder Essential (2021), wired

A further 100 products are claimed from the OpenRazer reference and have never
been connected — see [Untested models](#untested-models) before testing one.

Razer does not declare its control channel in the HID descriptor, so no
interface advertises a feature report. The exchange still works because WebHID
does not check report IDs against the descriptor. The interface that answers is
the one whose **only** collection is Generic Desktop Mouse (`usagePage 0x01`,
`usage 0x02`).

The mouse presents four interfaces on each connection. The vendor filter
narrows the picker to one of them when wired, and to two on the receiver, where
a second interface carries a mouse collection alongside others. Both are named
`Razer Viper V3 Pro` and cannot be told apart in the picker, so on the receiver
the first choice may be the interface that never answers. It is then skipped in
the device list; add the device again and choose the other entry.

The cable and the receiver are separate devices with separate product IDs, so
each needs its own browser permission. Granting one does not grant the other,
and switching between them the first time means adding the device again.

DPI, polling rate, idle sleep and the low power threshold can be written. Every
other control is withheld because no command for it has been confirmed.

1. Connect the mouse over the cable and confirm the model, wired state, battery,
   charging state, DPI, and polling rate are correct.
2. Repeat on the receiver. Battery should read a plausible level, charging
   should read false, and the polling rate should match Synapse.
3. Confirm the reported polling rate tracks a change made in Synapse on both
   connections, including an 8000 Hz setting on the receiver.
4. Change the DPI and confirm the pointer speed changes with it, then reload and
   confirm the new value persisted.
5. Change the polling rate on each connection and confirm it persists. The cable
   offers 125/500/1000 and the receiver adds 2000/4000/8000; no other rate
   should appear.
6. On the receiver, confirm the lift-off card supports both Single and
   Asymmetric modes; on the cable, confirm it stays hidden if class `0x0b` is
   unsupported. Confirm no sensor processing card or receiver signal card appears.
7. Change the auto sleep timeout **on the cable and again on the receiver**,
   reloading each time to confirm the new value persisted. Unlike polling, both
   transports answer `0x07`/`0x83`, so the card belongs on both.
8. Set an off-list timeout in Synapse (7 minutes, say) and confirm the dropdown
   offers and selects it rather than falling back to a value the mouse is not
   holding. Values outside 30 s–15 min are not added to the list, because the
   driver would refuse to write them back.
9. Confirm the low power percentage matches what Synapse shows **before**
   changing it — the read is what proves the 0–255 scale is being decoded
   correctly. Then change it, reload, and confirm it persisted. At 2000 Hz and
   above the dropdown should be disabled with a note, not hidden.
10. Leave the panel open for a few minutes and confirm the background refresh
    keeps reporting without stalling or throwing.
11. Record the device identifier, firmware version, and any failing setting in
    the issue or pull request.

## Untested models

`devices.ts` claims 100 further products taken from OpenRazer's supported-device
table. They reuse the commands verified above; what the table records per model
is which of those commands are valid, which transaction id the mouse answers on,
and what its sensor and radio can do. **None has been connected**, so each is a
prediction until someone reports otherwise. The panel says so: the connection
card reads `… · untested model`.

Testing one is worth doing and is low-risk, because every failure mode here is
loud rather than silent:

| If this is wrong | What happens |
| --- | --- |
| Transaction id | The mouse never replies. The status read fails on firmware and the panel reports a connection failure. Nothing is written. |
| Interface choice | Same — the wrong interface never answers. Add the device again and pick another entry. |
| A capability flag | The command is not sent at all. The control is missing, not broken. |
| DPI or rate ceiling | The write is refused, or fails its read-back and reports what the mouse kept. |

What is deliberately **not** attempted on an untested model:

- The asymmetric lift-off mode probe, which is a *write*. It stays off unless
  `asymmetricLiftOff` is set, which only the four Viper V2/V3 Pro ids have. An
  untested mouse that answers class `0x0b` still gets the plain three-stop
  tracking control, which costs reads only.
- Lighting, button mapping and macros, none of which this driver implements for
  any model.

To promote a model to verified:

1. Work through the numbered checklist above for it.
2. Confirm the model name, connection type and firmware read at all — that alone
   proves the transaction id and the interface.
3. Check DPI and polling **against Synapse before writing anything**, then
   change each, reload, and confirm it persisted.
4. Correct the model's row in `devices.ts`, set `verified: true`, add its id to
   the verified list at the top of this file and to `VERIFIED` in
   `devices.test.ts`, and record the firmware version in the pull request.

Three groups from the OpenRazer list are excluded on purpose, and adding them
needs new transport work rather than a table row:

- **`legacy/old`** — Orochi 2011 `0x0013`, DeathAdder 3.5G `0x0016` and `0x0029`.
  These predate the 90-byte report and use direct USB control writes, so this
  driver could only ever time out on them.
- **Orochi V2 Bluetooth `0x0095`** — a Bluetooth HID path is not the USB control
  channel and must not be assumed to take the same reports.
- **HyperPolling Wireless Dongle `0x00b3`** — a receiver rather than a mouse.
  Reaching the mouse paired to it needs dongle-specific commands.

The `index3` models (Naga X `0x0096`, Basilisk V3 `0x0099`, Basilisk V3 35K
`0x00cb`) are the least certain of those that *are* claimed: OpenRazer reaches
them through USB control-transfer index 3, and WebHID cannot select a `wIndex`.
The picker offers every interface instead, so the right one has to be found by
trying them. If none answers, that is worth recording — it would mean these need
a native helper rather than a driver fix.

## DeathAdder Essential — not yet hardware-tested

This model shares the 90-byte protocol above, so it reuses the same commands.
Three things differ, and each is the kind of thing that fails loudly rather
than quietly:

| Difference | Value | Why |
| --- | --- | --- |
| Transaction id | `0x3f`, not `0x1f` | OpenRazer uses the older id for this family. A wrong id means the mouse never replies at all, so this shows up as a timeout, not as a wrong setting. |
| DPI ceiling | 6,400 | Officially published. Anything above is rejected before it reaches the mouse. |
| Battery | none | The battery commands are skipped rather than sent and caught, because an unsupported reply would abort the whole status read. |

The control interface is also less certain than on the Viper. That one always
answers on the interface whose only collection is Generic Desktop Mouse; this
family splits pointer and configuration across separate interfaces and the
revisions disagree about which usage page carries the configuration one, so the
driver accepts a vendor-defined collection as well. The picker will therefore
offer more than one entry. If the first never answers, add the device again and
choose another — the same situation as the Viper receiver.

1. Confirm the picker offers the mouse at all. If Chrome grants only a single
   Generic Desktop Mouse collection and the firmware read times out on every
   entry, this platform does not expose the configuration interface and no
   browser-side control is possible. Stop and record that.
2. Confirm the model name, **Wired**, and a firmware version appear.
3. Confirm no battery row appears.
4. Confirm the DPI presets offer 400 / 800 / 1600 / 3200 / 6400, and no 8000.
5. Confirm the polling buttons offer only 125 / 500 / 1000.
6. Read DPI and compare against Synapse **before** writing anything.
7. Change DPI, confirm the pointer speed changes, then reload and confirm it
   persisted. Settings on this model may be volatile — if the value reverts
   after a replug, that is a device trait, not a driver bug.
8. Change the polling rate and verify it externally.
9. Confirm no lift-off buttons and no sensor processing card appear.

If step 6 returns an implausible DPI, the storage byte is the first thing to
try: this driver uses `VARSTORE` (`0x01`) for both the read and the write,
matching OpenRazer's generic path, but some older models expect `NOSTORE`
(`0x00`). Change `RAZER_STORAGE` only after confirming it against a capture.

Lighting is not implemented. The hardware is fixed-colour (green on the black
edition, white on the white one), the panel has no Razer lighting controls, and
the effect packets are unverified. Device mode (`0x00`/`0x04`) is never sent —
driver mode changes button behaviour and would need restoring on disconnect.

## Verified against firmware 1.12

| Read | Class / ID | Notes |
| --- | --- | --- |
| Firmware | `0x00` / `0x81` | |
| Serial | `0x00` / `0x82` | ASCII, null terminated |
| Battery | `0x07` / `0x80` | level out of 255 |
| Charging | `0x07` / `0x84` | |
| Idle sleep | `0x07` / `0x83` | seconds, big-endian |
| Low power | `0x07` / `0x81` | level out of 255 in the **first** byte, so 77 is 30% |
| DPI | `0x04` / `0x85` | big-endian X and Y |
| DPI stages | `0x04` / `0x86` | seven-byte records; decoded but not yet shown |
| Polling, legacy | `0x00` / `0x85` | divisor of 1000; **wired only** |
| Polling, extended | `0x00` / `0xc0` | divisor of 8000; **receiver only** |

Each write clears the high bit of the matching read.

| Write | Class / ID | Notes |
| --- | --- | --- |
| DPI | `0x04` / `0x05` | storage byte, then big-endian X and Y |
| Polling, legacy | `0x00` / `0x05` | divisor of 1000; **wired only** |
| Polling, extended | `0x00` / `0x40` | leading `0x00`, then divisor of 8000 |
| Idle sleep | `0x07` / `0x03` | seconds, big-endian |
| Low power | `0x07` / `0x01` | level out of 255, then trailing `0x00` |

Transaction ID `0x1f` answered every command on both connections. Writes were
confirmed by effect, not only by read-back: a DPI change altered pointer speed,
and a 500 Hz write measured 499 Hz through `pointerrawupdate`.

The cable is limited to 1000 Hz on this model, which is also the ceiling the
legacy encoding can express, so no HyperPolling command is missing there.

## Idle sleep range

Synapse slides from **1 to 15 minutes** in whole minutes, so the dropdown offers
one entry per minute across that range and nothing is interpolated.

The firmware is looser than the vendor software: 30 seconds round-tripped
exactly, with status `0x02`, which is below even the 60 s floor OpenRazer
documents. Neither bound describes what the mouse enforces. The driver follows
Synapse anyway, because a value nothing else offers has no way to be checked
against the vendor behaviour.

A timeout outside 1–15 minutes — set by a sweep script, say — cannot be shown as
a selected option without either rendering the dropdown blank or offering a
value the driver would refuse to write. The card is hidden in that case rather
than displaying a value the mouse is not holding.

## Low power mode

Synapse slides this from **5 to 100 percent**, so the dropdown offers every
fifth percent across that range.

The threshold is stored on the battery level's **0–255 scale, not as a
percentage**: the mouse held `0x4d` — 77 out of 255 — while Synapse displayed
30%. Reading it as a percentage is wrong by a factor of two and a half.

It also answers in the **first** argument byte. Battery (`00 eb`), charging
(`00 00`) and sleep (`00 78`) all pad with a leading zero and answer in the
second, so this command is the exception in its own class — the captured reply
is `4d 00`. Decoding it like its neighbours yields a constant zero, which then
falls below the 5% floor and hides the card rather than showing a wrong number.
Both facts are pinned in `protocol.test.ts`.

The
scale is coarser than whole percent, so every offered value is checked in
`protocol.test.ts` to survive the round trip; one that did not would fail its
read-back and reject a setting the panel had just offered.

Synapse also states that **low power mode is unavailable at 2000 Hz and above**
and greys the slider out there. The threshold still reads at any rate, so the
driver disables the control and explains why rather than hiding it.

The disabled control is not what enforces that rule. The panel repaints from a
status that already includes staged changes, so staging a jump to 4000 Hz greys
the dropdown while a threshold staged a moment earlier still sits in the queue.
`setLowPowerThreshold` therefore reads the rate back from the mouse and refuses
there, where a repaint cannot reach it.

The write mirrors that payload — level first, then a trailing zero — and is
confirmed on hardware: writing 85% left the mouse holding `d9 00`, which
survived a reload and agreed with Synapse. `0xd9` is 217, and 85% encodes to 217
only because 216.75 rounds up, so that capture pins the rounding in both
directions rather than only the byte order.

## Lift-off distance

Not found. Class `0x0b` answers at `0x80`, `0x85`, `0x8b`, `0x8e`, `0x90`–`0x92`,
`0x94`, `0x95` and `0xa4`, and class `0x04` holds only DPI commands, but none
carries the values the vendor software shows. `0x0b`/`0x85` tracks the
asymmetric cut-off toggle in its third byte: `01` symmetric, `02` asymmetric.

The vendor software exposes lift-off as a continuous slider, and asymmetric mode
splits it into separate lift-off and landing values where landing cannot exceed
lift-off. That does not fit the three-value `liftOffDistance` field, so this
needs a richer type before it can be exposed even once the command is found.

## Unresolved

- No lift-off distance command has been found, so no lift-off control is
  offered and `supportedLiftOffDistances` stays empty.
- No sensor processing commands (motion sync, angle snapping, ripple control)
  have been found, so that card stays hidden. The vendor software does not
  expose them for this model either, so they are more likely absent from the
  mouse than missing from this driver.
- No command reports link quality, so the signal-strength card is hidden through
  `ui.hideSignalCard` rather than left rendering its placeholder. This matters
  because it shares a section with the sleep card, which this driver opens.
- The sleep read is answered on both transports, unlike polling. A transport
  that ever stops answering reports no timeout, and the card is hidden for that
  connection instead of failing the whole status read.
- The 35000 DPI ceiling comes from the published sensor specification, not from
  the mouse; the stages read only proves the 400–6400 ladder. A write past the
  real ceiling fails its read-back and reports a mismatch rather than silently
  misreporting, but the ceiling itself is still unconfirmed.
- DPI step granularity is assumed to be 50. Values off that grid are rejected
  before they reach the mouse, so a finer or coarser real step would only mean
  the control offers the wrong choices.
- The DPI stage table (`0x04`/`0x06`) is decoded and tested but never written.
  A wrong length there is the one realistic way to corrupt stored settings.

## Viper Mini (verified on hardware)

The Viper Mini shares the 90-byte report and command ids above, but belongs to
openrazer's legacy transaction group: every command is answered with transaction
id `0xff` rather than `0x1f`, and the DPI read uses the no-store byte (`0x00`)
where the V3 Pro reads with the storage byte. The transaction id and the command
table below were confirmed on hardware (`1532:008a`):

1. The model and wired state appear, with no battery column (wired-only; the
   mouse answers no battery query).
2. DPI reads back correctly and the control offers 100–8500 DPI.
3. A DPI change alters pointer speed and persists after reload, confirming the
   write-with-storage (`0x01`) / read-with-no-store (`0x00`) pairing.
4. Polling rate reads 125/500/1000 Hz, a 1000 Hz write round-trips with status
   `0x02`, and the rate persists.
5. No lift-off distance buttons and no sensor processing card appear.

| Read | Class / ID | Notes |
| --- | --- | --- |
| Firmware | `0x00` / `0x81` | transaction id `0xff` |
| Serial | `0x00` / `0x82` | ASCII, null terminated; transaction id `0xff` |
| DPI | `0x04` / `0x85` | no-store byte `0x00`, then big-endian X and Y |
| Polling | `0x00` / `0x85` | divisor of 1000; wired only |

| Write | Class / ID | Notes |
| --- | --- | --- |
| DPI | `0x04` / `0x05` | storage byte `0x01`, then big-endian X and Y |
| Polling | `0x00` / `0x05` | divisor of 1000 |

The 8500 DPI ceiling comes from the openrazer daemon class. The DPI step
granularity is assumed to be whole values, matching the V3 Pro driver.
