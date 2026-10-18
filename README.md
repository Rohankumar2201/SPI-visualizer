# SPI Visualizer

A small browser tool for learning SPI timing. Configure a transaction, enter the master and slave data, and see SCLK, MOSI, MISO and CS drawn on a shared time axis, with the sampling edge of every bit marked. Everything is plain HTML, CSS and JavaScript. No build step, no backend, no runtime dependencies.

## Features

- All four SPI modes (CPOL/CPHA), set directly or by mode number
- Clock presets from 100 kHz to 10 MHz, or a custom frequency
- 8, 16 or 32-bit words, MSB-first or LSB-first, 1 to 16 words, inter-word delay, active-low or active-high CS
- Full duplex: the master RX is built from the bits the slave drives on MISO, and the slave RX from MOSI
- Time cursor with live signal values, play / pause / step-edge / reset, zoom and fit
- Bit table, bit inspector, event list and transaction summary, all generated from the same timeline
- Seven presets, dark and light themes, PNG and CSV export, local save of the configuration

## Run it

Open `index.html` in a browser. Or serve the folder:

```
python3 -m http.server 8000
```

## Tests

Unit tests use the Node.js built-in test runner (Node 18 or newer), nothing to install:

```
npm test
```

An optional real-browser check (headless Chromium via Playwright for Python) covers the UI: validation and stale state, presets, cursor, playback, zoom, exports, saved configuration, themes and small screens:

```
pip install playwright
playwright install chromium
python3 tests/browser-smoke.py
```

The tests check the timing against SPI rules written out by hand (edge times, idle levels, sample edges, RX words). They are a software check only. This project has not been compared against hardware or an external simulator.

## Files

- `spi-core.js`: timing engine, input parsing and validation, CSV and summary text. No DOM access.
- `app.js`: rendering, controls and events.
- `index.html`, `style.css`: layout and theme.
- `tests/`: unit tests and the optional browser check.

## Input formats and limits

| Setting | Accepted |
| --- | --- |
| Data values | `0x` hex or `0b` binary, separated by commas, spaces or semicolons. Plain decimal is rejected. |
| Number of values | Must equal the number of words. |
| Data width | 8, 16 or 32 bits. A value that does not fit is an error; it is never truncated. |
| Words | Integer 1 to 16 |
| Clock | 1 kHz to 50 MHz (custom field is in kHz) |
| Inter-word delay | 0 to 1000 clock periods (decimals allowed) |

While the configuration is invalid the waveform, tables and summary are cleared, the controls and exports are disabled, and the errors are listed. They come back as soon as the input is valid. A saved configuration that is unreadable or invalid is ignored and defaults are loaded.

## SPI modes

| Mode | CPOL | CPHA | SCLK idles | Data is shifted out on | Data is sampled on |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | low | falling (trailing) edge | rising (leading) edge |
| 1 | 0 | 1 | low | rising (leading) edge | falling (trailing) edge |
| 2 | 1 | 0 | high | rising (trailing) edge | falling (leading) edge |
| 3 | 1 | 1 | high | falling (leading) edge | rising (trailing) edge |

The leading edge is the first edge away from the idle level, the trailing edge is the return to idle.

## Timing assumptions

These are choices made for teaching clarity, not requirements of any device.

- One bit period is one clock period. SCLK pulses once per bit.
- CS asserts one clock period after the start of the capture. The first bit window starts half a clock period after CS asserts, so CS setup is half a period.
- CS deasserts half a period after the last bit window. CS hold is half a period.
- In mode 0 and 2 the first bit is valid from CS assertion. In mode 1 and 3 the first bit appears on the first leading edge, so the data lines are undriven before it.
- Every bit is stable for at least half a period before and after its sampling edge.
- Between words, CS stays asserted, SCLK idles, and MOSI/MISO are drawn as undriven (dashed). A real master may hold the last bit instead.
- In modes 0 and 2 the last trailing edge of a word is listed as a shift edge even though no further bit follows.
- One slave and one CS line. No minimum CS-high time between transactions, no clock stretching, no multi-slave or daisy-chain behavior.

## Exports

- **CSV**: one row per event: `time_ns,SCLK,MOSI,MISO,CS,event,word,bit`. Times are in nanoseconds. Levels are the values just after the event. MOSI and MISO are empty when the line is undriven.
- **PNG**: the current waveform at 2x scale in the current theme. If the view is zoomed too wide for a PNG, the button asks you to zoom out first.
- **Copy summary**: the transaction summary as plain text.
- **Save config**: stored in this browser's localStorage. Export and save are disabled while the configuration is invalid.

## Known limitations

- Zoom is capped so the drawing stays under about 400,000 px wide.
- Resizing the window re-fits the waveform and resets manual zoom.
- Time labels switch from ns to µs but not to ms, so slow, long transactions show large µs values.
- Behavior was checked in headless Chromium only.
