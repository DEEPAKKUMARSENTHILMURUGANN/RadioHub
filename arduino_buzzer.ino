/*
  Arduino Nano Physical Buzzer Code for RJ Hunt Spinning Wheel
  ============================================================
  
  Wiring:
    - Pushbutton / Big Arcade Buzzer Switch:
        Pin 1 -> Connected to Arduino Nano Digital Pin D2
        Pin 2 -> Connected to Arduino Nano GND
    - (Uses internal pull-up resistor: no external resistor required!)
    - Optional: LED on Pin D13 (built-in) illuminates when buzzer is pressed!

  Communication:
    - Baud Rate: 9600 baud
    - Sends 'h' when pressed, which python script reads and translates to 'a' key.
*/

const int BUZZER_PIN = 2;   // Pushbutton connected to D2 and GND
const int LED_PIN = 13;     // Built-in LED on Nano

int lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long DEBOUNCE_DELAY = 150; // ms

void setup() {
  Serial.begin(9600);
  pinMode(BUZZER_PIN, INPUT_PULLUP); // Active LOW
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
}

void loop() {
  int reading = digitalRead(BUZZER_PIN);

  // Check if button state transitioned from HIGH to LOW (pressed)
  if (reading == LOW && lastButtonState == HIGH) {
    if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
      digitalWrite(LED_PIN, HIGH);
      
      // Send trigger signal 'h' over serial to laptop
      Serial.println("h");
      
      lastDebounceTime = millis();
      delay(80);
      digitalWrite(LED_PIN, LOW);
    }
  }

  lastButtonState = reading;
}
