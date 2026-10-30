# Airborne 3D RF Spatial Mapper

A local dashboard and ESP32 payload firmware for visualizing 433 MHz LoRa reception as an interactive spatial RF map, collecting bench measurements, and preparing raw datasets for a future ML model.

**Current phase:** ESP32 DevKit V1 payload + ground beacon bench testing. A flight controller has not been purchased. Payload coordinates are currently **simulated at a fixed 10 m altitude**. Real GPS/MAVLink integration and autonomous flight are next-phase work.

## Run the dashboard

Requires Node.js 20 or newer and an internet connection for the pinned Three.js modules and fonts. Chart.js and PapaParse are bundled locally; no npm dependency installation is needed.

```sh
git clone https://github.com/avanish149/Airborne3DRF.git
cd Airborne3DRF
npm start
```

Open **http://127.0.0.1:4174**. On Windows, `Start Dashboard.cmd` also starts the local dashboard. Keep the server and browser open while collecting data. If port 4174 is already in use, use the existing instance or stop it first. `RF_LOGGER_PORT` can select another port.

Use **Load demo survey** to explore the full 3D volume, or upload a payload CSV. Demo and uploaded surveys are archived in separate, explicitly labeled CSV sessions when the local logger is running.

## Features

- Original 7-column survey CSV, 23-column payload v2 CSV, and saved-project CSV import with validation.
- Synthetic demo data, local metric XY coordinates, IDW voxel interpolation, instanced 3D spheres, adjustable signal thresholds, altitude and RSSI filters, flight path, replay, and hover inspection.
- Analysis statistics, six-connected weak-signal clusters, camera focus, RSSI/time/altitude/distance charts, and an editable ideal free-space baseline.
- Flight-altitude vs measured ground-band heatmaps; unknown cells remain visibly unknown.
- First Fresnel-zone overlay and optional decorative warehouse geometry.
- PNG, estimated-grid CSV, and JSON summary exports.
- Hardware/firmware view, ESP32 DevKit V1 BLE transport, USB serial, and CSV-text WebSocket input.
- Automatic local CSV logging with write acknowledgements, retry deduplication, and capture recovery after server restart.

## Connect the ESP32 over BLE

1. Open `firmware/payload/payload-ble/payload-ble.ino` in Arduino IDE with `BleTelemetry.h` alongside it.
2. Target the original ESP32 DevKit V1 / **ESP32 Dev Module**. The firmware targets **Arduino-ESP32 3.3.0** and uses the **LoRa library by Sandeep Mistry**, plus the ESP32 core's built-in BLE library.
3. Compile, flash over USB, reset, and confirm LoRa and BLE initialization in Serial Monitor at 115200 baud.
4. Open the local dashboard in a browser supporting Web Bluetooth, select **Hardware & firmware → Connect Bluetooth · ESP32**, and choose **RF-Payload-V2**.

The browser must allow Bluetooth access. The embedded browser may not support it; use Chrome/Edge directly if needed. The beacon must match the payload's radio settings and emit `BCN,<counter>,<tx_dbm>`. Beacon firmware was not supplied and has not been invented here.

See [Bluetooth setup](BLUETOOTH-SETUP.md) for the BLE protocol, UUIDs, framing, and limitations. The original firmware is preserved at `firmware/payload/payload-original.ino`; a USB CSV variant is also included.

## Automatic CSV logging and future ML data

Validated reports reaching the local dashboard automatically append to:

```text
data/survey_<session-id>.csv
```

Coordinates and RF measurements are saved **together in the same row**, alongside session ID, receive timestamp, source, position provenance, transport, BLE sequence/delivery gaps, reception status, and quality fields. Real captures are ignored by Git. Files are created on the first report; the directory may initially be empty.

Timeout sentinel values are preserved in raw fields but excluded from measured RSSI/SNR statistics and interpolation. A fixed-altitude capture is identified as planar, with 3D volume unavailable. The 30,000-row visualization limit does not truncate an already-written capture CSV.

Use the **raw measured CSV** as the future ML source, not the interpolated voxel export. Simulated coordinates are explicitly labeled and cannot establish a real spatial RF model. Packet-counter gaps can reflect both RF and telemetry loss; BLE delivery gaps are recorded separately.

Saving confirms reports received by the browser and acknowledged by the local file service. It cannot record while the browser/device is disconnected or closed. SD logging is an optional independent backup and remains disabled by default. The hosted static dashboard cannot directly write to a local project folder.

See [CSV logging](CSV-LOGGING.md) and [current-phase status](PHASE-1-STATUS.md).

## Project layout

```text
dashboard/
  dist/                    Browser UI and bundled dependencies
  local-server.mjs         Local static server and CSV append API
  tests/                   Analysis, CSV, BLE and persistence tests
  demo-survey.csv           Synthetic volume fixture
  payload-v2-example.csv    Synthetic payload-protocol fixture
firmware/payload/
  payload-original.ino     Exact supplied source
  payload-dashboard/       USB CSV-enabled sketch
  payload-ble/             BLE sketch and BleTelemetry.h
data/                      Local captures, excluded from Git
docs/                      Original project overview and technical PDF
```

The original empty `BackEnd`, `FrontEnd`, and `Hardware` placeholder files remain to preserve the existing repository contents.

## Verify

```sh
npm test
```

Tests cover interpolation-related analysis, connected clusters, planar-volume guards, Fresnel/free-space calculations, CSV/JSON export content, CSV schemas, BLE notification fragmentation/checksums/gaps, and CSV persistence/retry/restart behavior. Test captures use temporary directories rather than `data/`.

**Verification limits:** BLE tests use a simulated GATT device. Firmware has not been compiled or flashed here, and physical BLE/RF/SD behavior and throughput require bench tests. The latest analysis views, responsive layouts and PNG downloads still require a manual visual check because browser automation was unavailable. No ML model has been trained.

## Next phase

After bench validation: select the flight controller, integrate timestamp-aligned real position data over MAVLink, validate altitude references and position quality, and collect real spatial surveys. The [original project overview](docs/PROJECT-OVERVIEW.md) includes broader goals and proposed hardware; it is a roadmap, not a statement that those components are already integrated.

## Licensing

The project owner has not selected a license for original project code. Bundled third-party notices remain in their source files. Chart.js and PapaParse are third-party libraries; Three.js and fonts load from their respective providers.
