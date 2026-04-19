/*
 * Drift — Focus Pod firmware
 * StarkHacks 2026
 *
 * Wiring:
 *   KY-037   VCC -> 3.3V,  GND -> GND,  AO  -> GPIO4
 *   OLED     VCC -> 3.3V,  GND -> GND,  SDA -> GPIO8,  SCL -> GPIO9
 *   LDR      one leg -> 3.3V, other leg -> GPIO5 AND 10k to GND
 *   BUZZ     + -> GPIO15,    - -> GND   (active piezo buzzer, direct drive)
 *
 * Serial protocol:
 *   -> BOOT                    at power up
 *   -> READY                   heartbeat every 5s
 *   -> DATA:<noise>,<light>    every 2s (0..4095 each)
 *   <- FOCUS:<0..100>          updates the OLED
 *   <- BUZZ:<ms>               sound the buzzer for ms (clamped 30..2000)
 *   <- PING                    replied with PONG
 */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH   128
#define SCREEN_HEIGHT  64
#define OLED_RESET     -1
#define OLED_ADDR      0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
bool oledOK = false;

#define MIC_PIN          4
#define LDR_PIN          5
#define BUZZ_PIN         16
#define BUZZ_MIN_MS      30
#define BUZZ_MAX_MS      500
#define SAMPLE_INTERVAL  500    // ms between DATA: lines
#define MIC_WINDOW_MS    40      // sample window for peak-to-peak
#define HEARTBEAT_MS     2000    // emit "READY" periodically

unsigned long lastSample    = 0;
unsigned long lastHeartbeat = 0;
unsigned long buzzUntil     = 0;     // millis() deadline to silence buzzer
bool buzzActive      = false;
int  lastFocusScore  = 0;
bool hasScore        = false;

void showSplash();
void showScore(int score);
int  readMicPeakToPeak();

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("BOOT");

  pinMode(BUZZ_PIN, OUTPUT);
  digitalWrite(BUZZ_PIN, LOW);

  Wire.begin(8, 9);
  if (display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    oledOK = true;
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    showSplash();
  } else {
    Serial.println("WARN:OLED_INIT_FAIL");
    // Do NOT hang — keep streaming sensor data.
  }
}

void loop() {
  // --- Inbound: focus score from browser ---
  while (Serial.available()) {
    String incoming = Serial.readStringUntil('\n');
    incoming.trim();
    if (incoming.length() == 0 || incoming.length() > 64) continue;
    if (incoming.startsWith("FOCUS:")) {
      int v = incoming.substring(6).toInt();
      if (v >= 0 && v <= 100) {
        lastFocusScore = v;
        hasScore = true;
        if (oledOK) showScore(lastFocusScore);
      }
    } else if (incoming.startsWith("BUZZ:")) {
      int ms = incoming.substring(5).toInt();
      if (ms < BUZZ_MIN_MS) ms = BUZZ_MIN_MS;
      if (ms > BUZZ_MAX_MS) ms = BUZZ_MAX_MS;
      digitalWrite(BUZZ_PIN, HIGH);
      buzzActive = true;
      buzzUntil  = millis() + (unsigned long)ms;
    } else if (incoming == "PING") {
      Serial.println("PONG");
    }
  }

  unsigned long now = millis();

  // --- Buzzer auto-off (non-blocking) ---
  if (buzzActive && (long)(now - buzzUntil) >= 0) {
    digitalWrite(BUZZ_PIN, LOW);
    buzzActive = false;
  }

  // --- Outbound: sensor data ---
  if (now - lastSample >= SAMPLE_INTERVAL) {
    lastSample = now;

    int noiseLevel = readMicPeakToPeak();   // 0..4095
    int lightLevel = analogRead(LDR_PIN);   // 0..4095

    Serial.print("DATA:");
    Serial.print(noiseLevel);
    Serial.print(",");
    Serial.println(lightLevel);
  }

  // --- Heartbeat ---
  if (now - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = now;
    Serial.println("READY");
  }
}

// Peak-to-peak captures speech and claps.
// Averaging raw samples just returns the mic's DC bias and looks flat.
int readMicPeakToPeak() {
  unsigned long start = millis();
  int maxV = 0;
  int minV = 4095;
  while (millis() - start < MIC_WINDOW_MS) {
    int v = analogRead(MIC_PIN);
    if (v > maxV) maxV = v;
    if (v < minV) minV = v;
  }
  int p2p = maxV - minV;
  if (p2p < 0)    p2p = 0;
  if (p2p > 4095) p2p = 4095;
  return p2p;
}

void showSplash() {
  if (!oledOK) return;
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(20, 10);
  display.println("DRIFT");
  display.setTextSize(1);
  display.setCursor(4, 40);
  display.println("Open Chrome to");
  display.setCursor(4, 52);
  display.println("connect...");
  display.display();
}

void showScore(int score) {
  if (!oledOK) return;
  display.clearDisplay();

  // Title
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("DRIFT  Focus Pod");
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);

  // Big score
  display.setTextSize(3);
  display.setCursor(10, 16);
  display.print(score);
  display.setTextSize(2);
  display.print("%");

  // Progress bar — scaled to 128px
  int barWidth = (score * 128) / 100;
  if (barWidth < 0)   barWidth = 0;
  if (barWidth > 128) barWidth = 128;
  display.drawRect(0, 42, 128, 6, SSD1306_WHITE);
  display.fillRect(0, 42, barWidth, 6, SSD1306_WHITE);

  // Status line
  display.setTextSize(1);
  display.setCursor(0, 54);
  if (score >= 70)      display.print("On track");
  else if (score >= 40) display.print("Drifting...");
  else                  display.print("Take a break");

  display.display();
}
