# Payload/beacon dashboard — current phase

The current project is `C:\Users\avanish\Downloads\project_drone`. The flight controller has not been purchased. Flight-controller wiring, MAVLink position integration, and autonomous-flight work belong to the next project phase.

## Run

Use `Start Dashboard.cmd` and open http://127.0.0.1:4174. Refresh an already-open dashboard after these changes. This local version includes the latest work and automatic project CSV logging; the older hosted URL does not include the local filesystem service.

## Completed dashboard features

- CSV import for the original survey format, payload v2 captures, and saved project captures; demo survey generation.
- Instanced 3D RF voxels, beacon-relative XY coordinates, flight path and replay, hover inspection, resolution, signal thresholds, opacity, point size, RSSI/SNR coloring, lower/upper altitude bounds, and RSSI min/max filters.
- Collapsible survey inspector; received-only signal statistics, timeout counts, inferred packet-ID gaps, BLE delivery gaps, worst measured location, connected dead-zone components, and estimated supported-cell volume.
- Analysis charts: RSSI against time, altitude, and beacon distance, with an editable ideal free-space baseline. Chart.js 4.4.7 is bundled locally. The TX baseline defaults to a stated assumption or uses payload TX power when available; it is not a trained model.
- A six-connected dead-zone table with centroid, cell count, minimum RSSI, estimated volume, and smooth camera focus.
- Flight-altitude heatmaps compared with strictly measured ground-band observations. Missing cells are hatched and never treated as good signal. Ground height uses the same altitude reference as the CSV.
- First Fresnel-zone wireframe between the configured beacon antenna and a selected/replayed sample, using the configured frequency and physical wavelength. A decorative, editable warehouse layer does not alter the RF estimates.
- Exports: annotated 3D PNG, interpolated voxel CSV, and JSON summary/configuration/cluster report. These exports use browser downloads; the automatic raw capture logger separately writes to project_drone/data.
- Hardware/firmware tab, ESP32 DevKit V1 BLE variant, serial and WebSocket adapters, BLE framing/checksum/gap detection, and automatic CSV logging.

## Data interpretation

The payload still uses simulated serpentine coordinates at 10 m altitude. BLE does not add GPS. Planar captures do not establish 3D survey volume; the UI reports volume as unavailable. A demo is explicitly labeled synthetic. Interpolated cells and detected regions are estimates, and should not be used as raw measurement ground truth for ML. Signal strength alone cannot prove that a region is caused by multipath or an obstruction.

Packet-ID gaps describe missing observed beacon counters. BLE loss can also create such gaps; its sequence-based delivery gaps are reported separately. Timeout rows preserve their raw sentinels in CSV, but do not enter measured RSSI/SNR statistics or voxel interpolation. The logger saves reports that reach the browser and are acknowledged by the local filesystem service; it cannot save reports during hardware/browser disconnection. Onboard SD is an independent optional backup.

## Validation

Passed JavaScript syntax checks and automated tests for analysis/clusters/planar guards/Fresnel and free-space physics, CSV/JSON export content, original and payload CSV schemas, BLE fragmented notifications and integrity checks, and local CSV persistence/retry/restart behavior. Synthetic test files are kept outside the real capture directory.

Visual/browser interaction testing of the latest analysis views could not be completed because the browser-control connector failed and its native fallback timed out. PNG download, interactive charts, and responsive layouts therefore still need a manual browser pass. ESP32 compilation, flashing, physical BLE reception/throughput, onboard SD operation, and actual beacon interoperability also remain unverified.

## Remaining bench work

1. Compile and flash the BLE sketch following BLUETOOTH-SETUP.md; keep BleTelemetry.h alongside it.
2. Confirm beacon/payload LoRa settings and message format match the real beacon firmware.
3. Connect RF-Payload-V2 from the local dashboard, verify reports, and check the confirmed CSV path and row count. Compare against USB/SD where available to establish capture completeness.
4. Collect repeatable bench measurements with clearly documented conditions. Keep simulated positions explicitly labeled until real position hardware is integrated.

No ML model has been trained, and no real flight-controller integration is claimed.
