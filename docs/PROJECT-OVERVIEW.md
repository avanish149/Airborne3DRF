# Airborne 3D RF Spatial Mapper

**Autonomous aerial platform for 3D RF propagation and signal attenuation mapping.**

An autonomous multirotor flies a 3D grid through a space (warehouse, building, campus) while logging LoRa signal quality from a fixed ground beacon. Every RSSI/SNR reading is tagged with its 3D position, and a web dashboard turns the data into an interactive volumetric heatmap that reveals dead zones, multipath nulls, and obstruction losses that ground-level (2D) testing misses.

| 433 MHz | ±0.5 m (target) | 10 Hz | 3D Heatmap |
|:---:|:---:|:---:|:---:|
| LoRa spectrum | 3D position accuracy | Data logging rate | Primary output |

---

## Table of Contents

- [Why this exists](#why-this-exists)
- [How it works](#how-it-works)
- [Hardware](#hardware)
- [Data format](#data-format)
- [Web dashboard](#web-dashboard)
- [Getting started](#getting-started)
- [Repository structure](#repository-structure)
- [Roadmap](#roadmap)
- [Known limitations and notes](#known-limitations-and-notes)
- [License](#license)

---

## Why this exists

Conventional RF site surveys are done by walking at ground level, which gives incomplete data. Signal quality in 3D space is shaped by:

- **Fresnel zone obstruction**: structures intruding into the ellipsoidal zone between transmitter and receiver (concrete slabs, steel trusses, metal racking).
- **Multipath fading**: reflections that create floating nulls at specific heights and positions.
- **Altitude-dependent behavior**: a spot that is fine at 1.5 m can be a dead zone at 10 m, and vice versa.

This project quantifies all of that systematically and visualizes it in 3D.

## How it works

```
 ┌─────────────────────┐   433 MHz LoRa ping   ┌──────────────────────────┐
 │   Ground Beacon     │ ────────────────────► │   Drone RF Payload       │
 │ ESP32 + Ra-02       │   (known TX power)    │ ESP32 + Ra-02 + MicroSD  │
 └─────────────────────┘                       └────────────┬─────────────┘
                                                            │ MAVLink (UART)
                                                            ▼
                                               ┌──────────────────────────┐
                                               │ Flight Controller        │
                                               │ SpeedyBee F405 V3        │
                                               │ ArduPilot + u-blox M10   │
                                               └──────────────────────────┘

 Payload merges RSSI/SNR + position  ──►  CSV on MicroSD  ──►  Dashboard / MATLAB / Python
```

1. **Ground beacon** transmits continuous calibrated LoRa test packets at a known power.
2. **Drone** flies an autonomous 3D grid mission planned in Mission Planner.
3. **Payload ESP32** reads position from the flight controller over MAVLink, reads RSSI/SNR from the Ra-02 on each received packet, merges them, and writes a CSV row to the MicroSD card.
4. **Post-processing** (the web dashboard, or MATLAB/Python) interpolates the samples into a 3D volume and renders the heatmap.

## Hardware

| Subsystem | Component | Purpose |
|---|---|---|
| Flight control | SpeedyBee SB-F4V3-50-STACK (STM32F405 + 50A BLHeli_S ESC) | Autonomous flight and MAVLink server |
| Navigation | HGLRC M100 PRO GPS (u-blox M10 + QMC5883L compass) | 3D position and heading |
| Airframe | F450 quadcopter frame (450 mm, nylon glass-fiber, integrated PDB) | Structure and power routing |
| Propulsion | 2212 920KV/1000KV motors, 1045 propellers | Lift and stabilization |
| Wiring | 20 AWG silicone extension wires | Motor-to-ESC phase extensions |
| Power filtering | 35V 1000 µF low-ESR capacitor | Suppresses ESC voltage spikes |
| Payload MCU | ESP32 DevKit V1 | Payload logic and MAVLink parser |
| RF transceiver | Ai-Thinker Ra-02 x2 (SX1278, 433 MHz LoRa) | Beacon transmit, RSSI/SNR sampling |
| Storage | MicroSD breakout (SPI, FAT32) | High-speed CSV logging |
| Logic protection | 4-channel bi-directional level shifter (5V to 3.3V) | Protects ESP32 inputs from FC signals |
| Power source | 3S 11.1V 2200-3300 mAh LiPo, 35C | About 12-15 min flight time |

### Why these choices

- **SpeedyBee F405 V3**: built-in Bluetooth for field parameter changes without a laptop, plus an onboard MicroSD slot for flight logs.
- **Ra-02 at 433 MHz**: better obstacle penetration and propagation stability than 2.4 GHz Wi-Fi, with direct RSSI/SNR register access.

## Data format

The payload logs one row per received packet:

```csv
Timestamp_ms,Latitude,Longitude,Altitude_m,RSSI_dBm,SNR_dB,Packet_ID
104820,12.971598,77.594562,14.50,-68,8.25,1024
104920,12.971601,77.594565,14.55,-69,8.00,1025
105020,12.971605,77.594569,14.60,-72,6.75,1026
105120,12.971608,77.594572,14.62,-85,2.50,1027
```

| Column | Description |
|---|---|
| `Timestamp_ms` | Milliseconds since payload boot |
| `Latitude`, `Longitude` | Decimal degrees from the flight controller |
| `Altitude_m` | Altitude in meters |
| `RSSI_dBm` | Received signal strength |
| `SNR_dB` | Signal-to-noise ratio |
| `Packet_ID` | Beacon packet sequence number. Gaps indicate lost packets, a strong dead-zone indicator |

## Web dashboard

A browser-based, no-backend dashboard for visualizing the data.

**Core features**

- Drag-and-drop CSV upload, parsed in the browser
- 3D volumetric RSSI map (voxel/sphere grid) with orbit controls and labeled X/Y/Z axes
- Color scale: green = strong, yellow = fading, orange = multipath dead zone, dark red = obstruction loss or no packets (thresholds adjustable)
- Flight path overlay and timeline replay
- 3D Fresnel zone ellipsoid between beacon and drone
- Altitude slice, RSSI filter, and SNR/RSSI toggle
- Auto-detected dead-zone clusters with fly-to-location
- 2D ground-level vs 3D comparison view
- Charts: RSSI vs time, altitude, and distance (with free-space path loss overlay)
- Export: PNG, interpolated grid CSV, JSON report
- Demo data generator for use before real flights

**Hardware & Firmware tab** (reserved for firmware and live data)

- Code blocks for beacon and payload firmware
- Scaffolded live sources: Web Serial, WebSocket, manual CSV upload
- Radio config fields (TX power, frequency, spreading factor, bandwidth, grid spacing)

### Fresnel zone

The first Fresnel zone radius at a point along the link is:

```
r = sqrt( λ · d1 · d2 / (d1 + d2) )      where λ = c / f
```

At 433 MHz, λ is about 0.69 m, so the zone is considerably wider than at 2.4 GHz. Clearance matters more at this frequency.

## Getting started

### 1. Bench test (Phase 1)

1. Wire the ESP32, Ra-02, and MicroSD module on a breadboard (for both beacon and payload).
2. Flash the beacon firmware to broadcast 433 MHz test pings.
3. Flash the payload firmware, confirm RSSI/SNR readings, and verify dummy CSV logging.

### 2. Run the dashboard

```bash
# Static single-file build
open index.html

# or, if built with React + Vite
npm install
npm run dev
```

Click **Load demo data** to explore the UI, or upload a CSV from your flight.

### 3. Fly and analyze

1. Place the beacon at a known position and note its TX power.
2. Plan a 3D grid mission in Mission Planner and fly it autonomously.
3. Copy the CSV from the MicroSD card and load it into the dashboard (or MATLAB/Python).

## Repository structure

*(Proposed layout, adjust as the project grows.)*

```
.
├── README.md
├── docs/
│   └── Airborne_3D_RF_Spatial_Mapper_Technical_Summary.pdf
├── firmware/
│   ├── beacon/          # ESP32 + Ra-02 transmitter
│   └── payload/         # ESP32 + Ra-02 + MAVLink + SD logger
├── dashboard/           # Web UI
│   └── src/dataSource.js
├── data/
│   └── sample_flight.csv
├── analysis/            # MATLAB / Python scripts
└── hardware/            # Wiring diagrams, pinouts
```

## Roadmap

- [x] **Phase 1: Bench validation** (active): breadboard the electronics, flash beacon, validate RSSI/SNR and CSV logging
- [ ] **Phase 2: Airframe integration**: assemble F450, extend motor leads, mount the FC stack on silicone grommets, add the 1000 µF capacitor, power the payload from 5V
- [ ] **Phase 3: Autonomous mapping**: flash ArduPilot (`SpeedyBeeF405v3`), configure GPS and compass, fly grid missions, render 3D heatmaps
- [ ] **Phase 4: Live telemetry** (optional): stream data to the dashboard in real time

## Known limitations and notes

- **Position accuracy**: the ±0.5 m target is optimistic for a standalone u-blox M10 GNSS, which typically gives roughly 1.5-3 m horizontally. Reaching 0.5 m generally needs RTK or a similar correction source. Choose voxel size accordingly (1-2 m cells are realistic otherwise).
- **Altitude reference**: confirm whether `Altitude_m` is MSL, AGL, or barometric-fused. Relative height above the beacon is what the dashboard needs.
- **Frequency**: this project uses **433 MHz** LoRa. Any diagrams referencing 2.4 GHz are conceptual only.
- **Antenna orientation and drone body** affect RSSI. Keep the payload antenna placement and orientation consistent across flights.
- **Regulations**: verify 433 MHz ISM band rules, TX power limits, and drone flight regulations for your location before flying.
- **Safety**: test props-off on the bench, use a proper LiPo handling routine, and keep a manual RC override ready during autonomous missions.

## License

*TBD, add your license here (e.g. MIT).*
