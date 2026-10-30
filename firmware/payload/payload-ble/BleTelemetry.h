#pragma once
// ESP32 DevKit V1 / Arduino-ESP32 3.3.0 Bluedroid BLE API.
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <inttypes.h>

static const char *RF_BLE_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
static const char *RF_BLE_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
struct RfBleFrame { uint32_t epoch; char bytes[320]; };
static BLEServer *rfBleServer = nullptr;
static BLECharacteristic *rfBleTx = nullptr;
static BLE2902 *rfBleSubscription = nullptr;
static QueueHandle_t rfBleQueue = nullptr;
static volatile bool rfBleConnected = false, rfBleAdvertiseAgain = false;
static volatile uint32_t rfBleEpoch = 0;
static uint32_t rfBleSequence = 0, rfBleDropped = 0;

class RfBleCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { rfBleConnected = true; }
  void onDisconnect(BLEServer *) override {
    rfBleConnected = false;
    ++rfBleEpoch;
    rfBleAdvertiseAgain = true;
  }
};
static uint32_t rfBleChecksum(const char *text) {
  uint32_t hash = 0x811c9dc5u;
  while (*text) { hash ^= static_cast<uint8_t>(*text++); hash *= 0x01000193u; }
  return hash;
}
static void rfBleWorker(void *) {
  RfBleFrame frame;
  for (;;) {
    if (xQueueReceive(rfBleQueue, &frame, portMAX_DELAY) != pdTRUE) continue;
    if (!rfBleConnected || frame.epoch != rfBleEpoch || !rfBleSubscription->getNotifications()) continue;
    size_t length = strlen(frame.bytes);
    for (size_t offset = 0; offset < length;) {
      if (!rfBleConnected || frame.epoch != rfBleEpoch || !rfBleSubscription->getNotifications()) break;
      uint16_t mtu = rfBleServer->getPeerMTU(rfBleServer->getConnId());
      size_t chunk = mtu > 23 ? static_cast<size_t>(mtu - 3) : 20;
      if (chunk > 244) chunk = 244;
      if (chunk > length - offset) chunk = length - offset;
      rfBleTx->setValue(reinterpret_cast<uint8_t *>(frame.bytes + offset), chunk);
      rfBleTx->notify();
      offset += chunk;
      vTaskDelay(pdMS_TO_TICKS(5) + 1); // Pace notifications without blocking LoRa reception.
    }
  }
}
static bool rfBleBegin() {
  rfBleQueue = xQueueCreate(32, sizeof(RfBleFrame));
  if (!rfBleQueue) return false;
  BLEDevice::init("RF-Payload-V2");
  BLEDevice::setMTU(247); // Peer may negotiate less; worker falls back to 20-byte chunks.
  rfBleServer = BLEDevice::createServer();
  rfBleServer->setCallbacks(new RfBleCallbacks());
  BLEService *service = rfBleServer->createService(RF_BLE_SERVICE);
  rfBleTx = service->createCharacteristic(RF_BLE_TX, BLECharacteristic::PROPERTY_NOTIFY);
  rfBleSubscription = new BLE2902();
  rfBleTx->addDescriptor(rfBleSubscription);
  service->start();
  BLEAdvertising *advertising = rfBleServer->getAdvertising();
  advertising->addServiceUUID(RF_BLE_SERVICE);
  advertising->setScanResponse(true);
  if (xTaskCreate(rfBleWorker, "rf-ble-tx", 4096, nullptr, 1, nullptr) != pdPASS) return false;
  advertising->start();
  Serial.println("BLE ready: RF-Payload-V2 (connect from the local dashboard)");
  return true;
}
static void rfBlePoll() {
  if (rfBleAdvertiseAgain) {
    rfBleAdvertiseAgain = false;
    if (!rfBleConnected) rfBleServer->startAdvertising();
  }
}
static void rfBleReport(const char *csv) {
  uint32_t seq = rfBleSequence++;
  if (!rfBleConnected || !rfBleSubscription->getNotifications()) return;
  RfBleFrame frame;
  frame.epoch = rfBleEpoch;
  int size = snprintf(frame.bytes, sizeof(frame.bytes), "@%" PRIu32 ":%08" PRIx32 ":%s\n", seq, rfBleChecksum(csv), csv);
  if (size < 0 || size >= static_cast<int>(sizeof(frame.bytes)) || xQueueSend(rfBleQueue, &frame, 0) != pdTRUE) {
    ++rfBleDropped;
    Serial.printf("BLE queue overflow: %" PRIu32 " reports dropped; SD logging is unaffected\n", rfBleDropped);
  }
}
