#!/usr/bin/env python3
"""Frame furniture: header chips, the repro panel, subtitles and cards."""

from __future__ import annotations

import dataclasses

from dv_core import H, REPRO_PANEL_LIMIT, W, find_font

SUBTITLE_Y = 1008
CARD_TITLE_SIZE = 84
CARD_MARGIN = 160
CARD_LINE_GAP = 28


@dataclasses.dataclass
class Fonts:
    subtitle: object
    label: object
    case: object
    panel: object
    panel_head: object
    card: object


def load_fonts() -> Fonts:
    return Fonts(find_font(48), find_font(32), find_font(30), find_font(24), find_font(18),
                 find_font(CARD_TITLE_SIZE))


def header(draw, fonts: Fonts, severity: tuple, case: str, label: str) -> None:
    """Top-left chips: severity (feedback), case or phase, then the free label."""
    x = 82
    if severity[1] is not None:
        right = 56 + draw.textlength(severity[0], font=fonts.case) + 28
        draw.rounded_rectangle((56, 12, right, 56), radius=8, fill=severity[1])
        draw.text((70, 34), severity[0], font=fonts.case, fill="white", anchor="lm")
        x = right + 12
    if case:
        right = x + draw.textlength(case, font=fonts.case) + 28
        draw.rounded_rectangle((x - 4, 12, right, 56), radius=8, fill=(37, 99, 235))
        draw.text((x + 10, 34), case, font=fonts.case, fill="white", anchor="lm")
        x = right + 12
    draw.text((x, 34), label, font=fonts.label, fill=(190, 206, 230), anchor="lm")


def fit_text(draw, text: str, font, max_width: int) -> str:
    """Cut a line to a pixel width; a cut line ends with an ellipsis."""
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + "…", font=font) > max_width:
        text = text[:-1]
    return text + "…"


def repro_panel(draw, fonts: Fonts, steps: list) -> None:
    visible = steps[:REPRO_PANEL_LIMIT]
    omitted = len(steps) - len(visible)
    width, line_h = 520, 34
    height = 62 + line_h * len(visible) + (line_h if omitted else 0) + 10
    right, top = W - 56, 92
    left = right - width
    draw.rounded_rectangle((left, top, right, top + height), radius=10, fill=(16, 26, 46))
    draw.text((left + 18, top + 22), "REPRO STEPS", font=fonts.panel_head,
              fill=(150, 176, 214), anchor="lm")
    y = top + 52
    for index, step in enumerate(visible):
        text = fit_text(draw, f"{index + 1}. {step}", fonts.panel, width - 36)
        draw.text((left + 18, y), text, font=fonts.panel, fill=(236, 242, 250), anchor="lm")
        y += line_h
    if omitted:
        draw.text((left + 18, y), f"+{omitted} more", font=fonts.panel_head,
                  fill=(150, 176, 214), anchor="lm")


SPOKEN = (255, 255, 255)
UNSAID = (150, 166, 190)


def subtitle(draw, fonts: Fonts, line: list, layout: str, spoken: int) -> None:
    """Bottom subtitle, karaoke style: the first `spoken` chars are lit, the rest wait in grey."""
    head = "".join(char["char"] for char in line[:spoken])
    tail = "".join(char["char"] for char in line[spoken:])
    left = (W - draw.textlength(head + tail, font=fonts.subtitle)) / 2
    if layout == "fullbleed":
        right = W - left
        draw.rounded_rectangle((left - 26, SUBTITLE_Y - 34, right + 26, SUBTITLE_Y + 34),
                               radius=12, fill=(16, 24, 43))
    if head:
        draw.text((left, SUBTITLE_Y), head, font=fonts.subtitle, fill=SPOKEN, anchor="lm")
    if tail:
        draw.text((left + draw.textlength(head, font=fonts.subtitle), SUBTITLE_Y), tail,
                  font=fonts.subtitle, fill=UNSAID, anchor="lm")


NO_LINE_START = set("、。，；：！？）》」』】…·%,.;:!?)")
NO_LINE_END = set("（《「『【(")


def is_word_char(char: str) -> bool:
    return char.isascii() and char.isalnum()


def wrap_text(text: str, font, max_width: int) -> list[str]:
    """Greedy wrap by measured width. A Latin word moves to the next line whole
    (it overflows only when wider than a line by itself); CJK punctuation never
    opens a line and an opening bracket never ends one."""
    lines, current = [], ""
    for char in text:
        if not current or font.getlength(current + char) <= max_width:
            current += char
            continue
        if not is_word_char(char) or not is_word_char(current[-1]):
            if char in NO_LINE_START:
                current += char
                continue
            cut = len(current)
            while cut and current[cut - 1] in NO_LINE_END:
                cut -= 1
        else:
            cut = len(current)
            while cut and is_word_char(current[cut - 1]):
                cut -= 1
            if cut == 0:
                current += char
                continue
        lines.append(current[:cut].rstrip())
        current = current[cut:].strip() + char
    if current.strip():
        lines.append(current.strip())
    return lines


def card_frame(fonts: Fonts, title: str, severity: tuple, case: str, label: str):
    """A static title card: accent bar above the wrapped title, chips top-left."""
    from PIL import Image, ImageDraw
    frame = Image.new("RGB", (W, H), (16, 24, 43))
    draw = ImageDraw.Draw(frame)
    header(draw, fonts, severity, case, label)
    lines = wrap_text(title, fonts.card, W - 2 * CARD_MARGIN)
    line_h = CARD_TITLE_SIZE + CARD_LINE_GAP
    top = 540 - line_h * len(lines) // 2 + 40
    draw.rounded_rectangle((CARD_MARGIN, top - 60, CARD_MARGIN + 56, top - 54), radius=3,
                           fill=(59, 130, 246))
    for index, line in enumerate(lines):
        draw.text((CARD_MARGIN, top + index * line_h), line, font=fonts.card,
                  fill=(255, 255, 255))
    return frame
