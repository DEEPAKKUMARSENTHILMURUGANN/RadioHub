import serial
import serial.tools.list_ports
from pynput.keyboard import Controller

keyboard = Controller()
port = None

for candidate in serial.tools.list_ports.comports():
    print(f"Device found: {candidate.device} - {candidate.description}")
    port = candidate.device
    break

if not port:
    print("No Arduino serial device detected. Buzzer bridge is idle.")
    raise SystemExit(0)

ser = serial.Serial(port, baudrate=9600, timeout=1)

while True:
    try:
        response = ser.readline().decode().strip()
        if response == 'h':
            for _ in range(4):
                keyboard.press('a')
                keyboard.release('a')
    except (OSError, serial.SerialException):
        print("Arduino disconnected. Exiting buzzer bridge.")
        raise SystemExit(0)