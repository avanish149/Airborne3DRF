// ===== RF Payload v2: LoRa link analyzer with quality scoring =====
#include <SPI.h>
#include <LoRa.h>

#define ENABLE_SD   0   // 1 = log CSV to SD card
#define PRINT_CSV   1   // 1 = also print CSV rows to Serial
#define USE_FANCY   1   // 1 = color emoji + bar characters, 0 = plain text

#if ENABLE_SD
  #include <SD.h>
  #define SD_SCK  25
  #define SD_MISO 26
  #define SD_MOSI 27
  #define SD_CS   33
  SPIClass sdSPI(HSPI);
  File logFile;
#endif

#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23
#define LORA_NSS    5
#define LORA_RST   22
#define LORA_DIO0   4
#define LED_PIN     2

// --- Must match the beacon exactly ---
const long LORA_FREQ   = 433E6;
const int  LORA_SF     = 7;
const long LORA_BW     = 125E3;
const int  LORA_CR     = 5;
const int  LORA_PREAMB = 8;
const byte LORA_SYNC   = 0xA5;

// --- Link constants (approximate, SX1278 SF7 / 125 kHz) ---
const float SENSITIVITY_DBM = -123.0f;

// --- Quality scoring weights (sum = 1.0) ---
const float W_RSSI = 0.35f, W_SNR = 0.30f, W_PDR = 0.35f;

#define RSSI_WIN 20
#define PDR_WIN  50

// ---------- State ----------
long     lastCounter = -1;
uint32_t lastPktMs = 0, lastEventMs = 0, lastStatMs = 0, lastNoiseUpd = 0;
float    noiseFloor = -110.0f;
int      noiseWinMin = 0;

float rssiBuf[RSSI_WIN]; int rssiN = 0, rssiIdx = 0;
uint8_t pdrBuf[PDR_WIN]; int pdrN = 0, pdrIdx = 0;

// 5-second summary
uint32_t sRx = 0; long sRssiSum = 0; int sRssiMin = 0, sRssiMax = -200; long sScoreSum = 0;

// ---------- Rolling helpers ----------
void pushRssi(float r) {
  rssiBuf[rssiIdx] = r; rssiIdx = (rssiIdx + 1) % RSSI_WIN;
  if (rssiN < RSSI_WIN) rssiN++;
}
void rssiStats(float &mean, float &sd) {
  float s = 0; for (int i = 0; i < rssiN; i++) s += rssiBuf[i];
  mean = s / rssiN;
  float v = 0; for (int i = 0; i < rssiN; i++) { float d = rssiBuf[i] - mean; v += d * d; }
  sd = sqrtf(v / rssiN);
}
void pushOutcome(uint8_t ok) {
  pdrBuf[pdrIdx] = ok; pdrIdx = (pdrIdx + 1) % PDR_WIN;
  if (pdrN < PDR_WIN) pdrN++;
}
float lossPct() {
  if (!pdrN) return 0;
  int miss = 0; for (int i = 0; i < pdrN; i++) if (!pdrBuf[i]) miss++;
  return 100.0f * miss / pdrN;
}

// ---------- Scoring ----------
int lin(float x, float lo, float hi) {
  float t = (x - lo) / (hi - lo);
  if (t < 0) t = 0; if (t > 1) t = 1;
  return (int)(t * 100 + 0.5f);
}
int scoreRSSI(float r)   { return lin(r, -120, -60); }
int scoreSNR(float s)    { return lin(s, -10, 10); }
int scorePDR(float loss) { return lin(100.0f - loss, 50, 100); }

const char* levelName(int s) {
  if (s >= 80) return "EXCELLENT";
  if (s >= 60) return "GOOD";
  if (s >= 40) return "FAIR";
  if (s >= 20) return "POOR";
  return "DEAD ZONE";
}
const char* levelIcon(int s) {
#if USE_FANCY
  if (s >= 80) return "🟢";
  if (s >= 60) return "🟡";
  if (s >= 40) return "🟠";
  if (s >= 20) return "🔴";
  return "⚫";
#else
  if (s >= 80) return "[G]";
  if (s >= 60) return "[Y]";
  if (s >= 40) return "[O]";
  if (s >= 20) return "[R]";
  return "[X]";
#endif
}
void printBar(int score) {
  int n = score / 10;
  Serial.print("[");
  for (int i = 0; i < 10; i++) {
#if USE_FANCY
    Serial.print(i < n ? "█" : "░");
#else
    Serial.print(i < n ? "#" : "-");
#endif
  }
  Serial.print("]");
}

// ---------- Simulated GPS (until MAVLink is added) ----------
const double BASE_LAT = 10.000000, BASE_LON = 77.000000, M_PER_DEG_LAT = 111320.0;
void simulateGPS(uint32_t step, double &lat, double &lon, float &alt) {
  const int ROW_LEN = 20;
  int row = (step / ROW_LEN) % 10;
  int col = step % ROW_LEN;
  if (row % 2) col = ROW_LEN - 1 - col;
  lat = BASE_LAT + (row * 2.0) / M_PER_DEG_LAT;
  lon = BASE_LON + (col * 1.0) / (M_PER_DEG_LAT * cos(BASE_LAT * DEG_TO_RAD));
  alt = 10.0f;
}

const char* CSV_HEADER =
  "ms,rx_ok,beacon_ctr,tx_dbm,rssi_dbm,rssi_avg,rssi_std,snr_db,noise_floor_dbm,"
  "freq_err_hz,fade_margin_db,path_loss_db,gap_ms,lost,loss_pct,"
  "score_rssi,score_snr,score_pdr,score,level,lat,lon,alt_m";

void fatal(const char* msg) {
  Serial.println(msg);
  while (true) { digitalWrite(LED_PIN, !digitalRead(LED_PIN)); delay(100); }
}

// ---------- One report = print + CSV row. Returns total score ----------
int report(bool rxOk, long ctr, int tx, int rssi, float avg, float sd,
           float snr, long ferr, uint32_t gap, long lost) {
  float loss = rxOk ? lossPct() : 100.0f;
  int sR = rxOk ? scoreRSSI(rssi) : 0;
  int sS = rxOk ? scoreSNR(snr)   : 0;
  int sP = scorePDR(loss);
  int score = rxOk ? (int)(W_RSSI * sR + W_SNR * sS + W_PDR * sP + 0.5f) : 0;
  float fade = rssi - SENSITIVITY_DBM;
  float pathLoss = rxOk ? (float)(tx - rssi) : 0;

  static uint32_t step = 0;
  double lat, lon; float alt;
  simulateGPS(step++, lat, lon, alt);

  if (rxOk) {
    Serial.printf("%s #%ld | RSSI %d dBm (avg %.1f, sd %.1f) | SNR %.1f dB | Noise %.0f dBm | FreqErr %ld Hz\n",
                  levelIcon(score), ctr, rssi, avg, sd, snr, noiseFloor, ferr);
    Serial.printf("   Loss %.1f%% | Fade margin %.0f dB | Path loss %.0f dB | Gap %lu ms\n",
                  loss, fade, pathLoss, (unsigned long)gap);
    Serial.printf("   Scores: RSSI %d | SNR %d | PDR %d  =>  %d/100 %s ",
                  sR, sS, sP, score, levelName(score));
    printBar(score);
    Serial.println();
  } else {
    Serial.printf("%s NO SIGNAL | %lu ms since last packet | Noise floor %.0f dBm | 0/100 DEAD ZONE\n",
                  levelIcon(0), (unsigned long)gap, noiseFloor);
  }

  char line[256];
  snprintf(line, sizeof(line),
           "%lu,%d,%ld,%d,%d,%.1f,%.2f,%.2f,%.1f,%ld,%.1f,%.1f,%lu,%ld,%.1f,%d,%d,%d,%d,%s,%.7f,%.7f,%.1f",
           (unsigned long)millis(), rxOk ? 1 : 0, ctr, tx, rssi, avg, sd, snr, noiseFloor,
           ferr, fade, pathLoss, (unsigned long)gap, lost, loss, sR, sS, sP, score,
           levelName(score), lat, lon, alt);
#if PRINT_CSV
  Serial.println(line);
#endif
#if ENABLE_SD
  logFile.println(line);
  logFile.flush();
#endif
  return score;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("\n=== RF PAYLOAD v2: LINK ANALYZER ===");

#if ENABLE_SD
  sdSPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (!SD.begin(SD_CS, sdSPI, 4000000)) fatal("SD init FAILED - check wiring/VCC/FAT32");
  char name[20];
  for (int i = 1; i < 1000; i++) {
    snprintf(name, sizeof(name), "/rf_%03d.csv", i);
    if (!SD.exists(name)) break;
  }
  logFile = SD.open(name, FILE_WRITE);
  if (!logFile) fatal("Cannot create log file");
  logFile.println(CSV_HEADER);
  logFile.flush();
  Serial.printf("SD logging to %s\n", name);
#else
  Serial.println("SD disabled - Serial output only");
#endif
#if PRINT_CSV
  Serial.println(CSV_HEADER);
#endif

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) fatal("LoRa init FAILED - check wiring, 3.3V, NSS/RST");

  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setCodingRate4(LORA_CR);
  LoRa.setPreambleLength(LORA_PREAMB);
  LoRa.setSyncWord(LORA_SYNC);
  LoRa.enableCrc();

  Serial.println("LoRa init OK - listening for beacon...");
  lastEventMs = lastStatMs = lastNoiseUpd = millis();
}

void loop() {
  int pktSize = LoRa.parsePacket();

  if (pktSize) {
    String msg;
    while (LoRa.available()) msg += (char)LoRa.read();
    int   rssi = LoRa.packetRssi();
    float snr  = LoRa.packetSnr();
    long  ferr = LoRa.packetFrequencyError();

    if (msg.startsWith("BCN,")) {
      long ctr = 0; int tx = 0;
      sscanf(msg.c_str(), "BCN,%ld,%d", &ctr, &tx);

      uint32_t now = millis();
      uint32_t gap = lastPktMs ? now - lastPktMs : 0;
      long lost = 0;
      if (lastCounter >= 0) {
        if (ctr > lastCounter) lost = ctr - lastCounter - 1;
        else Serial.println("(beacon restarted)");
      }
      lastCounter = ctr; lastPktMs = now; lastEventMs = now;

      int k = lost > PDR_WIN ? PDR_WIN : (int)lost;
      for (int i = 0; i < k; i++) pushOutcome(0);
      pushOutcome(1);

      pushRssi(rssi);
      float avg, sd; rssiStats(avg, sd);

      int score = report(true, ctr, tx, rssi, avg, sd, snr, ferr, gap, lost);

      sRx++; sRssiSum += rssi; sScoreSum += score;
      if (rssi < sRssiMin) sRssiMin = rssi;
      if (rssi > sRssiMax) sRssiMax = rssi;

      digitalWrite(LED_PIN, HIGH); delay(5); digitalWrite(LED_PIN, LOW);
    } else {
      Serial.printf("Unknown packet (%d bytes): %s\n", pktSize, msg.c_str());
    }
  } else {
    // Sample background noise between packets (ignore invalid readings)
    static uint32_t lastN = 0;
    if (millis() - lastN >= 20) {
      lastN = millis();
      int r = LoRa.rssi();
      if (r > -140 && r < noiseWinMin) noiseWinMin = r;
    }
  }

  if (millis() - lastNoiseUpd >= 2000) {
    lastNoiseUpd = millis();
    if (noiseWinMin < 0) noiseFloor = noiseWinMin;
    noiseWinMin = 0;
  }

  // No packet for 1 s -> log a dead-zone row
  if (millis() - lastEventMs >= 1000) {
    lastEventMs = millis();
    report(false, lastCounter, 0, -130, -130, 0, -20, 0, millis() - lastPktMs, 0);
  }

  // 5-second summary
  if (millis() - lastStatMs >= 5000) {
    lastStatMs = millis();
    if (sRx > 0) {
      Serial.printf("==== 5s SUMMARY: rx=%lu | loss %.1f%% | RSSI avg %.1f (min %d, max %d) dBm | noise %.0f dBm | avg score %ld/100 ====\n",
                    (unsigned long)sRx, lossPct(), (float)sRssiSum / sRx, sRssiMin, sRssiMax,
                    noiseFloor, sScoreSum / (long)sRx);
    } else {
      Serial.println("==== 5s SUMMARY: NO PACKETS - beacon on? antennas? settings match? ====");
    }
    sRx = 0; sRssiSum = 0; sRssiMin = 0; sRssiMax = -200; sScoreSum = 0;
  }
}