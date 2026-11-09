"""Reference circuit specs. They double as documentation (``pcb_spec_example``) and as the acceptance tests."""
from __future__ import annotations

import copy

# ----------------------------------------------------------------------------------------------------------
# (a) LED power indicator: 5 V header -> 1k resistor -> LED -> GND
LED_INDICATOR: dict = {
    "name": "led_indicator",
    "outline": {"width_mm": 20, "height_mm": 12, "corner_radius_mm": 1.0},
    "parts": [
        {"ref": "J1", "symbol": "Connector_Generic:Conn_01x02", "footprint": "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical",
         "value": "5V in", "x_mm": 3.5, "y_mm": 4.0, "rotation": 0},
        {"ref": "R1", "symbol": "Device:R", "footprint": "Resistor_SMD:R_0603_1608Metric", "value": "1k",
         "x_mm": 9.0, "y_mm": 4.0, "rotation": 0, "lcsc": "C21190"},
        {"ref": "D1", "symbol": "Device:LED", "footprint": "LED_SMD:LED_0603_1608Metric", "value": "green",
         "x_mm": 14.0, "y_mm": 4.0, "rotation": 180, "lcsc": "C72043"},
    ],
    "nets": [
        {"name": "+5V", "pins": ["J1.1", "R1.1"]},
        {"name": "LED_A", "pins": ["R1.2", "D1.2"]},
        {"name": "GND", "pins": ["J1.2", "D1.1"]},
    ],
    "power_nets": ["+5V"],
    "ground_nets": ["GND"],
}

# ----------------------------------------------------------------------------------------------------------
# (b) NE555 astable LED blinker (~1 Hz): R1=1k, R2=68k, C1=10uF  ->  f = 1.44 / ((R1 + 2*R2) * C1)
NE555_BLINKER: dict = {
    "name": "ne555_blinker",
    "outline": {"width_mm": 34, "height_mm": 22, "corner_radius_mm": 1.5},
    "parts": [
        {"ref": "U1", "symbol": "Timer:NE555D", "footprint": "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", "value": "NE555D",
         "x_mm": 17.0, "y_mm": 11.0, "rotation": 0},
        {"ref": "J1", "symbol": "Connector_Generic:Conn_01x02", "footprint": "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical",
         "value": "5V in", "x_mm": 3.5, "y_mm": 8.0, "rotation": 0},
        {"ref": "R1", "symbol": "Device:R", "footprint": "Resistor_SMD:R_0603_1608Metric", "value": "1k",
         "x_mm": 25.0, "y_mm": 5.5, "rotation": 0},
        {"ref": "R2", "symbol": "Device:R", "footprint": "Resistor_SMD:R_0603_1608Metric", "value": "68k",
         "x_mm": 26.5, "y_mm": 10.0, "rotation": 90},
        {"ref": "C1", "symbol": "Device:C", "footprint": "Capacitor_SMD:C_0805_2012Metric", "value": "10uF",
         "x_mm": 26.5, "y_mm": 16.0, "rotation": 90},
        {"ref": "C2", "symbol": "Device:C", "footprint": "Capacitor_SMD:C_0603_1608Metric", "value": "100nF",
         "x_mm": 17.0, "y_mm": 5.0, "rotation": 0},
        {"ref": "C3", "symbol": "Device:C", "footprint": "Capacitor_SMD:C_0603_1608Metric", "value": "10nF",
         "x_mm": 21.5, "y_mm": 16.5, "rotation": 90},
        {"ref": "R3", "symbol": "Device:R", "footprint": "Resistor_SMD:R_0603_1608Metric", "value": "470",
         "x_mm": 9.5, "y_mm": 15.5, "rotation": 0},
        {"ref": "D1", "symbol": "Device:LED", "footprint": "LED_SMD:LED_0603_1608Metric", "value": "red",
         "x_mm": 9.5, "y_mm": 19.0, "rotation": 0},
    ],
    "nets": [
        {"name": "VCC", "pins": ["J1.1", "U1.8", "U1.4", "R1.1", "C2.1"]},
        {"name": "GND", "pins": ["J1.2", "U1.1", "C1.2", "C2.2", "C3.2", "D1.1"]},
        {"name": "DISCH", "pins": ["U1.7", "R1.2", "R2.1"]},
        {"name": "THR", "pins": ["U1.6", "U1.2", "R2.2", "C1.1"]},
        {"name": "CTRL", "pins": ["U1.5", "C3.1"]},
        {"name": "OUT", "pins": ["U1.3", "R3.1"]},
        {"name": "LED_A", "pins": ["R3.2", "D1.2"]},
    ],
    "power_nets": ["VCC"],
    "ground_nets": ["GND"],
    "mounting_holes": [],
}

# ----------------------------------------------------------------------------------------------------------
# (c) 3.3 V LDO breakout: AP2112K-3.3 (SOT-23-5), 1 uF in/out (0805), 4-pin header VIN GND 3V3 GND
LDO_BREAKOUT: dict = {
    "name": "ldo_3v3_breakout",
    "outline": {"width_mm": 22, "height_mm": 16, "corner_radius_mm": 1.0},
    "parts": [
        {"ref": "U1", "symbol": "Regulator_Linear:AP2112K-3.3", "footprint": "Package_TO_SOT_SMD:SOT-23-5", "value": "AP2112K-3.3",
         "x_mm": 11.0, "y_mm": 8.0, "rotation": 0},
        {"ref": "C1", "symbol": "Device:C", "footprint": "Capacitor_SMD:C_0805_2012Metric", "value": "1uF",
         "x_mm": 7.0, "y_mm": 8.0, "rotation": 90},
        {"ref": "C2", "symbol": "Device:C", "footprint": "Capacitor_SMD:C_0805_2012Metric", "value": "1uF",
         "x_mm": 15.5, "y_mm": 8.0, "rotation": 90},
        {"ref": "J1", "symbol": "Connector_Generic:Conn_01x04", "footprint": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
         "value": "VIN GND 3V3 GND", "x_mm": 19.0, "y_mm": 4.2, "rotation": 0},
    ],
    "nets": [
        {"name": "VIN", "pins": ["J1.1", "U1.1", "U1.3", "C1.1"]},
        {"name": "GND", "pins": ["J1.2", "J1.4", "U1.2", "C1.2", "C2.2"]},
        {"name": "+3V3", "pins": ["J1.3", "U1.5", "C2.1"]},
    ],
    "power_nets": ["VIN", "+3V3"],
    "ground_nets": ["GND"],
}

# ----------------------------------------------------------------------------------------------------------
# (d) 74HC595 + 8 LEDs: 21 nets, SOIC-16 fan-out; used as a router regression/stress board
def _shift_register_leds() -> dict:
    parts = [
        {"ref": "U1", "symbol": "74xx:74HC595", "footprint": "Package_SO:SOIC-16_3.9x9.9mm_P1.27mm", "value": "74HC595", "x_mm": 23, "y_mm": 16},
        {"ref": "C1", "symbol": "Device:C", "footprint": "Capacitor_SMD:C_0603_1608Metric", "value": "100nF", "x_mm": 29, "y_mm": 6},
        {"ref": "J1", "symbol": "Connector_Generic:Conn_01x06", "footprint": "Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical",
         "value": "VCC GND SER SRCLK RCLK QH'", "x_mm": 43, "y_mm": 8},
    ]
    nets = {"VCC": ["J1.1", "U1.16", "U1.10", "C1.1"], "GND": ["J1.2", "U1.8", "U1.13", "C1.2"], "SER": ["J1.3", "U1.14"],
            "SRCLK": ["J1.4", "U1.11"], "RCLK": ["J1.5", "U1.12"], "QHP": ["J1.6", "U1.9"]}
    for k, (pin, q) in enumerate([("U1.1", "QB"), ("U1.2", "QC"), ("U1.3", "QD"), ("U1.4", "QE"), ("U1.5", "QF"), ("U1.6", "QG"), ("U1.7", "QH")]):
        y = 5.0 + 2.4 * k
        r, d = f"R{k + 1}", f"D{k + 1}"
        parts.append({"ref": r, "symbol": "Device:R", "footprint": "Resistor_SMD:R_0603_1608Metric", "value": "470", "x_mm": 13.5, "y_mm": y})
        parts.append({"ref": d, "symbol": "Device:LED", "footprint": "LED_SMD:LED_0603_1608Metric", "value": "green", "x_mm": 8.0, "y_mm": y})
        nets[q] = [pin, f"{r}.2"]
        nets[f"L{k + 1}"] = [f"{r}.1", f"{d}.2"]
        nets["GND"].append(f"{d}.1")
    parts.append({"ref": "R8", "symbol": "Device:R", "footprint": "Resistor_SMD:R_0603_1608Metric", "value": "470", "x_mm": 31, "y_mm": 24})
    parts.append({"ref": "D8", "symbol": "Device:LED", "footprint": "LED_SMD:LED_0603_1608Metric", "value": "green", "x_mm": 36.5, "y_mm": 24})
    nets["QA"] = ["U1.15", "R8.1"]
    nets["L8"] = ["R8.2", "D8.2"]
    nets["GND"].append("D8.1")
    return {"name": "shift_register_leds", "outline": {"width_mm": 48, "height_mm": 32, "corner_radius_mm": 1.5}, "parts": parts,
            "nets": [{"name": k, "pins": v} for k, v in nets.items()], "power_nets": ["VCC"], "ground_nets": ["GND"]}


SHIFT_REGISTER_LEDS: dict = _shift_register_leds()

EXAMPLES = {
    "led_indicator": LED_INDICATOR,
    "ne555_blinker": NE555_BLINKER,
    "ldo_3v3_breakout": LDO_BREAKOUT,
    "shift_register_leds": SHIFT_REGISTER_LEDS,
}


def example(name: str = "led_indicator") -> dict:
    return copy.deepcopy(EXAMPLES[name])
