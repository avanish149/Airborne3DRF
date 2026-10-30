# RF Payload v2 integration

Working project: `C:\Users\avanish\Downloads\project_drone`.

## Layout

- `dashboard/dist/`: browser dashboard, CSV adapters, serial/WebSocket reader and firmware downloads.
- `firmware/payload/payload-original.ino`: exact supplied source.
- `firmware/payload/payload-dashboard/payload-dashboard.ino`: Arduino sketch with only `PRINT_CSV` changed from 0 to 1.
- `dashboard/payload-v2-example.csv`: synthetic protocol fixture, including counter reset, duplicate, gap and no-signal cases.
- `dashboard/tests/payload.test.mjs`: integration tests (`node tests/payload.test.mjs`).

## Use

Serve `dashboard/dist` over HTTP (for example `npx serve dashboard/dist`). Internet is required for pinned Three.js and font dependencies. PapaParse 5.4.1 is bundled locally. Open Hardware & firmware. Compile/flash the dashboard sketch using your existing ESP32 Arduino environment and LoRa library; select the ESP32 board and serial port. Firmware has not been compiled or flashed by this integration.

For a USB session, use a browser with Web Serial support on HTTPS or localhost, click Connect USB serial, and select the ESP32. Close Arduino Serial Monitor first so it releases the port. The dashboard reads 115200-baud CSV lines and ignores human-readable diagnostics. Browser permissions or an embedded browser may block serial; use Chrome/Edge directly or import a captured CSV. The button is disabled when Web Serial is unavailable.

Alternatively enable `ENABLE_SD=1`, wire SD as in the hardware tab and upload the generated CSV. The original sketch has both CSV and SD output disabled; the dashboard variant only enables serial CSV. A secure WebSocket endpoint may send complete CSV lines or newline-framed text chunks. A bridge/server is not included.

New live sessions start a separate survey on their first report. The map updates every two seconds with up to 30,000 reports. Uploading another CSV or loading demo data disconnects the stream. Losing the connection retains the collected survey. Firmware score, rolling loss, fade margin and last reception state are shown separately from whole-survey statistics.

## Data semantics

The adapter accepts the original exact 7-column schema and the supplied 23-column payload header, including captured diagnostics around CSV lines. It preserves all payload fields and normalizes timestamp, coordinates, RSSI/SNR and counter for the map. Legacy CSV samples represent received packets.

`rx_ok=0` rows are timeouts, not receptions. Their raw −130/−20 sentinel values are preserved for inspection, but normalized RSSI/SNR are null. Timeout markers are red wireframe diamonds and excluded from interpolation and average RSSI. No precise lost-packet count is inferred from their duration. Whole-survey packet loss counts forward counter gaps, ignores consecutive duplicates and timeout rows, and restarts gap tracking after a counter decrease. Initial and trailing missing packets cannot be inferred. Firmware `loss_pct` uses its own rolling window and is displayed separately.

The supplied firmware uses simulated GPS and a fixed altitude of 10 m. All v2 captures are conservatively labeled simulated until the data protocol gains position provenance and MAVLink is implemented. The planar data cannot establish a measured 3D volume. Beacon TX power is read from received records; beacon source was not supplied, so the dashboard shows the expected `BCN,<counter>,<tx_dbm>` protocol without inventing a transmitter sketch.

## Validation and limits

Automated tests cover both schemas, quality preservation, malformed row rejection, timeout exclusion, all-timeout datasets, counter gaps/resets/duplicates, and partial serial chunk framing. JavaScript syntax checks pass. Physical RF hardware, Arduino compilation, browser device permissions, live transport connections, and interactive rendering have not been verified here. Existing stage 2 analysis/chart work remains pending.
