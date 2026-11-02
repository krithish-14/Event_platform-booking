"""Issued PDF tickets keep the designer's alignment, weight, wrapping and rotation."""
import re
import unittest

from Services.ticket_pdf import _draw_text_box, build_mticket_pdf_bytes, text_width

TM = re.compile(r"1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm \((.*)\) Tj")


def placed(ops):
    font, size = "/F2", 10.0
    out = []
    for op in ops:
        m = re.match(r"(/F\d) ([\d.]+) Tf", op)
        if m:
            font, size = m.group(1), float(m.group(2))
        t = TM.match(op)
        if t:
            out.append((float(t.group(1)), t.group(3), font, size))
    return out


class TicketPdfAlignment(unittest.TestCase):
    def test_centered_text_is_centered_with_real_widths(self):
        ops = []
        _draw_text_box(ops, "CENTER aligned WIDE MMMM", 100, 50, 300, 40, 16, "0 0 0", "center", "/F2")
        (lx, text, font, size), = placed(ops)
        width = text_width(text, size, font)
        self.assertAlmostEqual(lx - 100, 400 - (lx + width), delta=0.6)

    def test_right_text_ends_at_the_box_edge(self):
        ops = []
        _draw_text_box(ops, "RIGHT aligned text", 100, 50, 300, 40, 16, "0 0 0", "right", "/F1")
        (lx, text, font, size), = placed(ops)
        self.assertAlmostEqual(lx + text_width(text, size, font), 399.0, delta=0.6)

    def test_wrapping_keeps_words_whole(self):
        ops = []
        _draw_text_box(ops, "Rotary District 3234 Shaurya Samman", 0, 0, 120, 60, 16, "0 0 0", "left", "/F2")
        lines = [p[1] for p in placed(ops)]
        self.assertGreater(len(lines), 1)
        self.assertEqual(" ".join(lines), "Rotary District 3234 Shaurya Samman")

    def test_custom_text_weight_rotation_and_rows(self):
        layout = {
            "canvas_mode": "custom", "orientation": "landscape", "layout_version": 11, "frame": "edited",
            "show_jod_logo": False, "show_qr": False,
            "canvas_elements": [
                {"id": "text_a", "type": "text", "x": 10, "y": 10, "w": 50, "h": 14, "text": "Regular words", "align": "left"},
                {"id": "text_b", "type": "text", "x": 10, "y": 30, "w": 50, "h": 14, "text": "Bold words", "fontWeight": "700"},
                {"id": "text_c", "type": "text", "x": 66, "y": 20, "w": 30, "h": 12, "text": "Turned", "rotation": 90},
                {"id": "name", "type": "name", "x": 10, "y": 60, "w": 60, "h": 10},
            ],
        }
        pdf = build_mticket_pdf_bytes(booking_id="x1", event_name="Align", ticket_layout=layout,
                                      include_qr=False, attendee_name="Ravi Kumar").decode("latin-1")
        self.assertRegex(pdf, r"/F2 [\d.]+ Tf[^\n]*\n1 0 0 1 [\d.]+ [\d.]+ Tm \(Regular words\)")
        self.assertRegex(pdf, r"/F1 [\d.]+ Tf[^\n]*\n1 0 0 1 [\d.]+ [\d.]+ Tm \(Bold words\)")
        self.assertRegex(pdf, r"q -?0\.0+ -1\.0+ 1\.0+ -?0\.0+ [-\d.]+ [-\d.]+ cm\nBT")
        name_x = float(re.search(r"1 0 0 1 ([\d.]+) [\d.]+ Tm \(Ravi Kumar\)", pdf).group(1))
        size = float(re.findall(r"/F1 ([\d.]+) Tf[^\n]*\n1 0 0 1 [\d.]+ [\d.]+ Tm \(Ravi Kumar\)", pdf)[0])
        box_right = 760.0 * 0.70
        self.assertAlmostEqual(name_x + text_width("Ravi Kumar", size, "/F1"), box_right - 1.0, delta=0.8)
        self.assertIn("(Name) Tj", pdf)


if __name__ == "__main__":
    unittest.main()
