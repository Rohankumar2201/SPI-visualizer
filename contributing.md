# Contributing to SPI Visualizer

Thanks for helping. This is a small learning tool for SPI timing, so the goal is a project that stays easy to read for an ECE student. Bug reports, timing corrections, tests and documentation fixes are all welcome.

## Ground rules

- Keep it vanilla HTML, CSS and JavaScript. No framework, build step, backend or runtime dependency.
- Keep changes small and focused. One fix or feature per pull request.
- Prefer clear, direct code over abstractions. Avoid decorative features and unrelated refactoring.
- SPI timing correctness comes first, then accurate waveforms, then usability, then looks.

## Project layout

| File | Purpose |
| --- | --- |
| `spi-core.js` | Timing engine, input parsing and validation, CSV and summary text. No DOM access. |
| `app.js` | Rendering, controls and events. |
| `index.html`, `style.css` | Layout and theme. |
| `tests/spi-core.test.js` | Unit tests for the core, using Node's built-in test runner. |
| `tests/browser-smoke.py` | Optional headless-browser check of the UI. |

If a change affects timing, parsing, validation or exports, it belongs in `spi-core.js` so it can be tested without a browser. `app.js` should only draw and wire up what the core returns.

## Setup

You need Node.js 18 or newer. Nothing else is required to work on the app.

```
git clone https://github.com/<your-username>/spi-visualizer.git
cd spi-visualizer
npm test
```

To use the app, open `index.html` in a browser, or run `python -m http.server 8000` and visit `http://localhost:8000`.

## Running the tests

Unit tests (required for every change):

```
npm test
node --check spi-core.js
node --check app.js
```

Browser check (run it when you change `app.js`, `index.html` or `style.css`):

```
python -m pip install playwright
python -m playwright install chromium
python tests/browser-smoke.py
```

On macOS and Linux, use `python3` instead of `python`. Report only what you actually ran. If you could not run the browser check, say so in your pull request.

## Reporting a bug

Open an issue with:

- The configuration: mode, clock, width, bit order, word count, delay, CS polarity, and the TX values.
- What you expected, and what you saw. For timing bugs, include the expected edge times and say which datasheet or SPI rule you used.
- Your browser and version.
- Any console error text.

## Changing timing behavior

The timing rules are documented in the README under "SPI modes" and "Timing assumptions". If you change one:

1. Update the README in the same pull request.
2. Write the expected values by hand from the SPI rules, not by copying the output of the code. Tests that only repeat the implementation do not catch bugs.
3. Check all four modes, both bit orders, both CS polarities, and a multiword case with and without delay.

## Tests

- Every bug fix needs a regression test that fails without the fix.
- Every new validation rule needs tests for a value that is accepted and a value that is rejected, including the boundary values.
- Keep tests deterministic. No timers, randomness or network.
- Use known values in the tests, such as `0xA5` on MOSI and `0x3C` on MISO at 1 MHz.

## Code style

- Match the existing style: short, direct functions and meaningful names.
- Comments only where the reason is not obvious from the code.
- Do not truncate user input silently. Show a clear validation message instead.
- Keep the dark and light themes working. Colors come from the CSS variables.

## Pull request checklist

- [ ] `npm test` passes
- [ ] `node --check` passes on the JavaScript files you changed
- [ ] Browser check run, or the PR says it was not
- [ ] Regression test added for any fix
- [ ] README updated if behavior, input formats or assumptions changed
- [ ] No unrelated changes or new dependencies
- [ ] Waveform still correct in all four modes if you touched drawing or timing

In the pull request, describe what changed and why, and list the checks you ran with their results. Do not claim hardware or external simulator validation unless you actually did it.

## License

By contributing you agree that your contribution is released under the project's license. Add a `LICENSE` file to the repository root and mention it here.