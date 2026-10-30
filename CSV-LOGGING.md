# Automatic project CSV logging

Double-click `Start Dashboard.cmd` in `C:\Users\avanish\Downloads\project_drone`. Keep its window open while collecting. It starts the local dashboard at http://127.0.0.1:4174 and uses Node.js, with no extra packages to install. Close the server window to stop logging. If the port is occupied, stop the earlier instance first.

Each live session is appended automatically to `project_drone\data\survey_<session-id>.csv`. Files are created on the first validated report. CSV uploads and demos also produce separate, labeled session files. Each row includes the original RF fields and coordinates together, plus session ID, sequential row ID, computer receive timestamp (UTC), data source, transport, and position provenance. Timeout rows keep the raw firmware sentinels while normalized RSSI/SNR columns remain blank. The firmware's coordinates are still simulated, explicitly marked as such in the saved CSV.

The automatic logger is independent of the map's 30,000-row display cap. It saves batches of at most 250 reports and acknowledges after the file is synced. Retries use sequential row IDs to avoid writing the same acknowledged batch twice. Files can be reopened by the server after restart to recover the next row ID. CSV rows are appended in arrival order, including explicit timeout events and repeated hardware packet IDs; the logger does not discard observations for ML. Only validated reports are saved; serial diagnostic messages are ignored.

Hardware & firmware shows the file path and confirmed saved-row count. Errors are visible and unacknowledged rows stay queued in browser memory for retries. Wait for the saved count to catch up before closing the page. This is not guaranteed capture while the browser is closed, suspended, out of memory, or disconnected from the device. Queued rows are not durable until the CSV write is confirmed. Onboard SD logging remains useful as an independent backup.

The hosted HTTPS dashboard cannot write directly into the project folder. Use the local dashboard for automatic file writing. It listens only on 127.0.0.1 and rejects cross-origin writes. Serial and WebSocket data use the shared row events; a future BLE transport will feed that same logging sink. This change does not add BLE firmware or a Bluetooth connection.

Tests: `cd dashboard` then `node tests\logger.test.mjs`. Tests write synthetic fixtures to a separate temporary directory, never into the real `data` directory.
