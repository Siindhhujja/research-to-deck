"""
Builds a branded .pptx deck from a synthesis JSON payload produced by
lib/synthesize.ts. Invoked by the Node worker as a subprocess because
python-pptx has no Node/JS equivalent.

Usage:
    python build_deck.py <synthesis.json> <theme.json> <output.pptx>

Synthesis JSON shape:
{
  "deckTitle": str,
  "slides": [{"title": str, "bullets": [{"text": str, "paperId": str}], "speakerNotes": str}],
  "references": [{"paperId": str, "title": str, "authors": [str], "year": int|None, "url": str|None}]
}
"""

import json
import sys

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE


def hex_to_rgb(hex_str: str) -> RGBColor:
    return RGBColor.from_string(hex_str)


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def format_reference(ref: dict, number: int) -> str:
    authors = ref.get("authors") or []
    author_str = ", ".join(authors[:3]) + (" et al." if len(authors) > 3 else "")
    year = ref.get("year")
    year_str = f" ({year})" if year else ""
    url = ref.get("url")
    url_str = f" — {url}" if url else ""
    return f"[{number}] {author_str}{year_str}. {ref['title']}.{url_str}"


def build_deck(synthesis: dict, theme: dict, output_path: str) -> None:
    colors = theme["colors"]
    fonts = theme["fonts"]
    primary = hex_to_rgb(colors["primary"])
    accent = hex_to_rgb(colors["accent"])
    text_color = hex_to_rgb(colors["text"])
    muted = hex_to_rgb(colors["muted"])

    references = synthesis.get("references", [])
    paper_id_to_number = {ref["paperId"]: i + 1 for i, ref in enumerate(references)}

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # --- Title slide ---
    slide = prs.slides.add_slide(blank_layout)
    title_box = slide.shapes.add_textbox(Inches(0.8), Inches(2.6), Inches(11.7), Inches(1.5))
    tf = title_box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = synthesis["deckTitle"]
    p.font.size = Pt(40)
    p.font.bold = True
    p.font.color.rgb = primary
    p.font.name = fonts["title"]

    subtitle_box = slide.shapes.add_textbox(Inches(0.8), Inches(4.1), Inches(11.7), Inches(0.6))
    sp = subtitle_box.text_frame.paragraphs[0]
    sp.text = f"{theme['brandName']} · {len(references)} sources synthesized"
    sp.font.size = Pt(16)
    sp.font.color.rgb = muted
    sp.font.name = fonts["body"]

    # --- Content slides ---
    for slide_data in synthesis["slides"]:
        s = prs.slides.add_slide(blank_layout)

        title_box = s.shapes.add_textbox(Inches(0.6), Inches(0.4), Inches(12.1), Inches(0.9))
        tp = title_box.text_frame.paragraphs[0]
        tp.text = slide_data["title"]
        tp.font.size = Pt(28)
        tp.font.bold = True
        tp.font.color.rgb = primary
        tp.font.name = fonts["title"]

        accent_line = s.shapes.add_shape(
            MSO_SHAPE.RECTANGLE, Inches(0.6), Inches(1.25), Inches(2.0), Pt(3)
        )
        accent_line.fill.solid()
        accent_line.fill.fore_color.rgb = accent
        accent_line.line.fill.background()

        body_box = s.shapes.add_textbox(Inches(0.6), Inches(1.6), Inches(12.1), Inches(5.3))
        body_tf = body_box.text_frame
        body_tf.word_wrap = True

        for i, bullet in enumerate(slide_data["bullets"]):
            para = body_tf.paragraphs[0] if i == 0 else body_tf.add_paragraph()
            citation_num = paper_id_to_number.get(bullet["paperId"])
            citation_marker = f" [{citation_num}]" if citation_num else ""
            para.text = f"•  {bullet['text']}{citation_marker}"
            para.font.size = Pt(18)
            para.font.color.rgb = text_color
            para.font.name = fonts["body"]
            para.space_after = Pt(12)

        notes = s.notes_slide
        notes.notes_text_frame.text = slide_data.get("speakerNotes", "")

    # --- References slide ---
    ref_slide = prs.slides.add_slide(blank_layout)
    ref_title_box = ref_slide.shapes.add_textbox(Inches(0.6), Inches(0.4), Inches(12.1), Inches(0.9))
    rp = ref_title_box.text_frame.paragraphs[0]
    rp.text = "References"
    rp.font.size = Pt(28)
    rp.font.bold = True
    rp.font.color.rgb = primary
    rp.font.name = fonts["title"]

    ref_body_box = ref_slide.shapes.add_textbox(Inches(0.6), Inches(1.4), Inches(12.1), Inches(5.6))
    ref_tf = ref_body_box.text_frame
    ref_tf.word_wrap = True
    for i, ref in enumerate(references):
        para = ref_tf.paragraphs[0] if i == 0 else ref_tf.add_paragraph()
        para.text = format_reference(ref, i + 1)
        para.font.size = Pt(12)
        para.font.color.rgb = text_color
        para.font.name = fonts["body"]
        para.space_after = Pt(6)

    prs.save(output_path)


def main() -> None:
    if len(sys.argv) != 4:
        print("Usage: python build_deck.py <synthesis.json> <theme.json> <output.pptx>", file=sys.stderr)
        sys.exit(1)

    synthesis_path, theme_path, output_path = sys.argv[1], sys.argv[2], sys.argv[3]
    synthesis = load_json(synthesis_path)
    theme = load_json(theme_path)
    build_deck(synthesis, theme, output_path)
    print(output_path)


if __name__ == "__main__":
    main()
