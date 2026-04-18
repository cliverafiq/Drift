# Drift

Passive cognitive focus tracker for study and work sessions. Fuses typing patterns, webcam attention, and ambient noise into live Focus and Fatigue scores.

Built for **StarkHacks 2026** (Microsoft AI & Automation track + Espressif Smart Home track).

## Quick start

### 1. Web app

Requires Node 18+ and **Chrome or Edge** (WebSerial is Chromium-only).

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome.

### 2. Firmware

Open `firmware/drift_pod/drift_pod.ino` in Arduino IDE.

1. Install the ESP32 board package: File → Preferences → add
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
2. Tools → Board → ESP32 Dev Module
3. Library Manager → install `Adafruit SSD1306`
4. Select the port, upload.

### 3. Wiring

```
KY-037   VCC → 3.3V,  GND → GND,  AO  → GPIO34
OLED     VCC → 3.3V,  GND → GND,  SDA → GPIO21,  SCL → GPIO22
LDR      one leg → 3.3V,  other leg → GPIO35 AND 10kΩ to GND
```

### 4. Connect

With the app running, click **Connect pod** and pick the ESP32's serial port. The OLED should switch to showing a live Focus score within a few seconds.

## Structure

```
src/
  App.jsx                      – top-level wiring
  hooks/
    useTypingTelemetry.js      – WPM, pause rate, backspace rate, idle detection
    useWebcamAttention.js      – MediaPipe gaze + EAR blink detection
    useSerialPod.js            – WebSerial client with EMA smoothing
    useScoreFusion.js          – weighted multimodal fusion, idle-aware
    useCalibration.js          – 30s baseline WPM capture, localStorage
    useFallbackPod.js          – demo-insurance simulated pod
  components/
    Dashboard.jsx              – score cards, signal pills, timeline
    SessionSummary.jsx         – post-session insights + suggestion
    CalibrationModal.jsx       – 30s modal during calibration
firmware/
  drift_pod/drift_pod.ino      – ESP32 sensor + OLED firmware
```

## Serial protocol

| Direction | Message              | Meaning                                |
|-----------|----------------------|----------------------------------------|
| ESP → PC  | `BOOT`               | pod started                            |
| ESP → PC  | `READY`              | heartbeat, every 5s                    |
| ESP → PC  | `DATA:<n>,<l>`       | noise (0–4095) and light (0–4095), 2s  |
| PC → ESP  | `FOCUS:<0..100>`     | render focus score on OLED             |
| PC → ESP  | `PING`               | ESP replies `PONG`                     |

## Notes for judges

All signal processing runs in-browser. No server, no cloud, no WiFi. Webcam frames never leave your machine. MediaPipe loads from CDN once at startup.
