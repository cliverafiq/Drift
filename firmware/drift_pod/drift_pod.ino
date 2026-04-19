/*
 * Drift — Focus Pod firmware
 * StarkHacks 2026
 *
 * Wiring:
 *   KY-037   VCC -> 3.3V,  GND -> GND,  AO  -> GPIO1
 *            (was on GPIO4; moved so the LED strip can own that pin.)
 *   OLED     VCC -> 3.3V,  GND -> GND,  SDA -> GPIO8,  SCL -> GPIO9
 *   LDR      one leg -> 3.3V, other leg -> GPIO5 AND 10k to GND
 *   BUZZ     + -> GPIO16,    - -> GND   (active piezo buzzer, direct drive)
 *   KY-040   VCC -> 3.3V,  GND -> GND,
 *            CLK -> GPIO10, DT -> GPIO11, SW -> GPIO12 (pulled up internal)
 *            Note: on ESP32-S3-WROOM-1, GPIOs 26-32 are reserved for SPI
 *            flash and NOT routed out of the module, so use 10/11/12.
 *   WS2812B  +5V -> 5V (USB rail), GND -> GND,
 *            DIN -> GPIO4 via 470Ω series resistor.
 *            Keep LED_BRIGHT modest — 8 pixels @ full white ≈ 480 mA and
 *            will brown-out a laptop-powered dev board.
 *
 * Serial protocol:
 *   -> BOOT                    at power up
 *   -> READY                   heartbeat every 5s
 *   -> DATA:<noise>,<light>    every 2s (0..4095 each)
 *   -> MODE_PREVIEW:<name>     while rotating the knob (not yet committed)
 *   -> MODE:<name>             when the knob is pressed (committed)
 *   <- FOCUS:<0..100>          updates the OLED + LED color
 *   <- BUZZ:<ms>               sound the buzzer for ms (clamped 30..2000)
 *   <- PING                    replied with PONG
 */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_NeoPixel.h>

#define SCREEN_WIDTH   128
#define SCREEN_HEIGHT  64
#define OLED_RESET     -1
#define OLED_ADDR      0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
bool oledOK = false;

#define MIC_PIN          1       // KY-037 AO; moved off GPIO4 to free it for the LED strip
#define LDR_PIN          5
#define BUZZ_PIN         16
#define BUZZ_MIN_MS      30
#define BUZZ_MAX_MS      500
#define SAMPLE_INTERVAL  500    // ms between DATA: lines
#define MIC_WINDOW_MS    40      // sample window for peak-to-peak
#define HEARTBEAT_MS     2000    // emit "READY" periodically

// --- WS2812B ambient LED strip ---
// Data in on GPIO4 through a 470Ω series resistor (protects the first pixel
// from ringing on the 3.3V→5V logic edge). Power is from the board's 5V rail.
// We drive the whole strip as one block — fancier per-pixel animations aren't
// worth the loop() budget given we're also running mic peak-to-peak windows.
#define LED_PIN          4
#define LED_COUNT        8       // change this to match your physical strip
#define LED_BRIGHT       60      // 0..255 — keep modest to avoid USB brown-out
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

unsigned long ledModeFlashUntil = 0; // while >0 we're showing a mode color
uint32_t      ledBaseColor      = 0; // last steady (focus) color, restored after flash

// --- KY-040 rotary encoder ---
// ESP32-S3-WROOM-1 reserves GPIOs 26-32 for internal SPI flash, so those
// pads are not on the module. 10/11/12 are general-purpose GPIOs with no
// strapping/USB conflicts, and are free in this firmware.
#define ENC_CLK          10
#define ENC_DT           11
#define ENC_SW           12
#define ENC_DEBOUNCE_MS  2       // min gap between accepted CLK transitions
#define BTN_DEBOUNCE_MS  40      // min hold before press registers
#define MODE_FLASH_MS    1000    // OLED shows mode for this long after change

const char* MODE_NAMES[] = { "STUDY", "READING", "PRESENT" };
const int   MODE_COUNT   = 3;

int  pendingMode   = 0;             // what the knob is pointing at (previewed)
int  committedMode = 0;             // what's actually in effect
int  lastClk       = HIGH;          // for edge detect on CLK
unsigned long lastEncMs    = 0;     // encoder debounce timestamp
int  lastBtn       = HIGH;          // for edge detect on SW
unsigned long btnDownAt    = 0;     // millis when SW went LOW
bool btnLatched    = false;         // true while we wait for release
unsigned long modeFlashUntil = 0;   // OLED returns to score at this millis

unsigned long lastSample    = 0;
unsigned long lastHeartbeat = 0;
unsigned long buzzUntil     = 0;     // millis() deadline to silence buzzer
bool buzzActive      = false;
int  lastFocusScore  = 0;
bool hasScore        = false;

void showSplash();
void showScore(int score);
void showMode(const char* name, bool committed);
void setupEncoder();
void readEncoder(unsigned long now);
int  readMicPeakToPeak();
void     setupLeds();
void     ledsFill(uint32_t color);
uint32_t focusColor(int score);
uint32_t modeColor(int modeIdx);
void     showFocusLeds(int score);
void     flashModeLeds(int modeIdx, unsigned long now);

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

  setupEncoder();
  setupLeds();
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
        // Don't clobber the mode-flash screen while it's up.
        if (oledOK && modeFlashUntil == 0) showScore(lastFocusScore);
        // LEDs: showFocusLeds() updates ledBaseColor and only paints the
        // strip if a mode flash isn't currently latched.
        showFocusLeds(lastFocusScore);
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

  // --- Encoder (non-blocking; can run every loop tick) ---
  readEncoder(now);

  // --- OLED flash auto-clear: return to score once the mode flash expires ---
  if (modeFlashUntil != 0 && (long)(now - modeFlashUntil) >= 0) {
    modeFlashUntil = 0;
    if (oledOK) {
      if (hasScore) showScore(lastFocusScore);
      else          showSplash();
    }
  }

  // --- LED flash auto-clear: repaint the steady focus color when done ---
  if (ledModeFlashUntil != 0 && (long)(now - ledModeFlashUntil) >= 0) {
    ledModeFlashUntil = 0;
    ledsFill(ledBaseColor);
  }

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

// ─────────────────────────────────────────────────────────
// Rotary encoder — KY-040 on CLK/DT/SW
//
// Rotation previews a mode (emits MODE_PREVIEW:<name>).
// Pressing the knob commits it (emits MODE:<name>).
// Everything is non-blocking: the main loop keeps servicing
// mic sampling, buzzer timeout, and inbound serial.
// ─────────────────────────────────────────────────────────
void setupEncoder() {
  pinMode(ENC_CLK, INPUT);
  pinMode(ENC_DT,  INPUT);
  pinMode(ENC_SW,  INPUT_PULLUP);
  lastClk = digitalRead(ENC_CLK);
  lastBtn = digitalRead(ENC_SW);
}

void readEncoder(unsigned long now) {
  // --- Rotation (CLK edge-detect, DT gives direction) ---
  int clk = digitalRead(ENC_CLK);
  if (clk != lastClk) {
    // Falling edge is the "detent" on most KY-040 clones.
    if (clk == LOW && (now - lastEncMs) >= ENC_DEBOUNCE_MS) {
      int dt = digitalRead(ENC_DT);
      if (dt == HIGH) pendingMode = (pendingMode + 1) % MODE_COUNT;
      else            pendingMode = (pendingMode + MODE_COUNT - 1) % MODE_COUNT;

      Serial.print("MODE_PREVIEW:");
      Serial.println(MODE_NAMES[pendingMode]);

      if (oledOK) showMode(MODE_NAMES[pendingMode], false);
      modeFlashUntil = now + MODE_FLASH_MS;
      lastEncMs = now;
    }
    lastClk = clk;
  }

  // --- Button (active-low with pull-up; press = LOW) ---
  int btn = digitalRead(ENC_SW);
  if (btn == LOW && lastBtn == HIGH) {
    btnDownAt  = now;
    btnLatched = false;
  }
  if (btn == LOW && !btnLatched && (now - btnDownAt) >= BTN_DEBOUNCE_MS) {
    // Commit the previewed mode.
    committedMode = pendingMode;
    Serial.print("MODE:");
    Serial.println(MODE_NAMES[committedMode]);

    if (oledOK) showMode(MODE_NAMES[committedMode], true);
    modeFlashUntil = now + MODE_FLASH_MS;
    flashModeLeds(committedMode, now);
    btnLatched = true;
  }
  if (btn == HIGH) {
    btnLatched = false;
  }
  lastBtn = btn;
}

void showMode(const char* name, bool committed) {
  if (!oledOK) return;
  display.clearDisplay();

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(committed ? "Mode locked" : "Mode preview");
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);

  display.setTextSize(2);
  int len = 0;
  for (const char* p = name; *p; p++) len++;
  int px = (128 - len * 12) / 2;
  if (px < 0) px = 0;
  display.setCursor(px, 20);
  display.print(name);

  display.setTextSize(1);
  display.setCursor(0, 54);
  display.print(committed ? "click-confirmed" : "click to confirm");

  display.display();
}

// ─────────────────────────────────────────────────────────
// WS2812B ambient strip
//
// The strip acts as an at-a-glance focus indicator so you don't have to be
// looking at your screen to know the pod is watching. Color comes from the
// last FOCUS: value the browser pushed us:
//   ≥70  green        "on track"
//   40-69 amber       "drifting, not gone"
//   <40   red         "take a break / refocus"
//
// On a mode commit we briefly overwrite the color with a mode-specific tint
// (STUDY=blue, READING=warm, PRESENT=magenta) for MODE_FLASH_MS, then the
// base focus color is restored — same cadence as the OLED.
// ─────────────────────────────────────────────────────────
void setupLeds() {
  strip.begin();
  strip.setBrightness(LED_BRIGHT);
  strip.clear();
  strip.show();
  ledBaseColor = strip.Color(40, 40, 60); // dim blue "booted, no data yet"
  ledsFill(ledBaseColor);
}

void ledsFill(uint32_t color) {
  for (int i = 0; i < LED_COUNT; i++) strip.setPixelColor(i, color);
  strip.show();
}

uint32_t focusColor(int score) {
  // Smooth gradient: red (score 0) → amber (~50) → green (100).
  // 16-bit hue: 0 = red, ~21845 = green. Mapping 0..100 onto that range
  // sweeps through the warm colors naturally, so even a 2–3 point focus
  // delta produces a visible color shift instead of a bucket flip.
  if (score < 0)   score = 0;
  if (score > 100) score = 100;
  uint16_t hue = (uint32_t)score * 21845 / 100;
  return strip.gamma32(strip.ColorHSV(hue, 255, 255));
}

uint32_t modeColor(int modeIdx) {
  // STUDY / READING / PRESENT
  switch (modeIdx) {
    case 0:  return strip.Color(30,  80,  220); // STUDY — blue
    case 1:  return strip.Color(220, 120, 30);  // READING — warm amber
    case 2:  return strip.Color(180, 30,  180); // PRESENT — magenta
    default: return strip.Color(80,  80,  80);
  }
}

void showFocusLeds(int score) {
  ledBaseColor = focusColor(score);
  // Don't clobber an active mode flash.
  if (ledModeFlashUntil == 0) ledsFill(ledBaseColor);
}

void flashModeLeds(int modeIdx, unsigned long now) {
  ledsFill(modeColor(modeIdx));
  ledModeFlashUntil = now + MODE_FLASH_MS;
}
