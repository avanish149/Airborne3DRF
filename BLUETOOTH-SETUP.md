# ESP32 DevKit V1 — BLE telemetry

## Flash the payload

Open `firmware\payload\payload-ble\payload-ble.ino` in Arduino IDE. Keep `BleTelemetry.h` in that same sketch folder. Target: **ESP32 Dev Module** (original ESP32 / DevKit V1), using **Arduino-ESP32 3.3.0** and the **LoRa library by Sandeep Mistry**. BLE headers ship with the ESP32 core; no separate BluetoothSerial library is used. If the build exceeds the default application partition, choose an application partition large enough for the built binary; this sketch does not require OTA.

Flash over USB, then reset the board. The existing LoRa pinout and 433 MHz settings remain the same. Serial Monitor at 115200 should show `BLE ready: RF-Payload-V2`. LoRa initialization must succeed before BLE starts. The original source and USB-only sketch are preserved. This BLE variant has not been compiled or flashed in this environment because an ESP32 Arduino toolchain and board are unavailable.

## Connect and save

1. Start `Start Dashboard.cmd` in project_drone if the local logger is not running.
2. Open http://127.0.0.1:4174 in Chrome or Edge with the computer's Bluetooth enabled.
3. Open **Hardware & firmware**, click **Connect Bluetooth · ESP32**, and select **RF-Payload-V2** in the browser's device chooser. The browser must support Web Bluetooth and allow device access; the embedded browser may not.
4. Reports update the map and automatically append to `project_drone\data\survey_<session-id>.csv`. Wait for the confirmed saved-row count before closing the page. The CSV includes transport `bluetooth`, BLE sequence and delivery-gap fields, the RF measurements, and coordinates in the same row.
5. Disconnect ends the BLE subscription. Reconnect manually to start another session. No historical reports are replayed from the board.

## Protocol and collection limits

Device name: `RF-Payload-V2`. Nordic UART service UUID: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`. Notify characteristic: `6e400003-b5a3-f393-e0a9-e50e24dcca9e`. It is a telemetry-only service, with no radio-control writes.

Each report is `@<uint32-sequence>:<8-digit-FNV1a32>:<23-column-CSV>\n`. The browser assembles ATT fragments, verifies the checksum, ignores repeated BLE sequence numbers, and records forward delivery gaps. FNV is an integrity check, not authentication. No custom pairing security is configured by this sketch.

A 32-frame FreeRTOS queue keeps BLE pacing out of the LoRa receive loop. Requested MTU is 247; actual chunks use the peer's negotiated MTU, with 20-byte fallback. Reports are not stored for an absent/unsubscribed client. Queue overflow is reported on USB serial, and later BLE sequence gaps expose missing reports. Bluetooth throughput/range and notifications are not guaranteed: compare BLE captures with onboard SD logs before relying on it for complete ML collection. Enable and wire SD separately for independent recording. Saving to CSV confirms received rows on the computer, not every measurement produced by disconnected hardware.

Current coordinates are still **simulated**, with altitude fixed at 10 m. BLE does not add GPS or MAVLink. These provenance labels remain in the CSV; real position integration is required before training a real spatial RF model. Whole-survey packet-ID gaps may include RF loss and telemetry delivery loss, so inspect BLE gaps separately.

## Verification

`cd dashboard` then run `node tests\bluetooth.test.mjs`, `node tests\logger.test.mjs`, and `node tests\payload.test.mjs`. BLE tests use a simulated GATT device and exercise fragmented notifications through actual CSV persistence in a temporary directory. Physical pairing, RF throughput, board compilation and onboard SD operation still require bench tests.
