"""One-page reports from an immutable, already audited result; no image/PHI inputs."""
from __future__ import annotations
from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from xml.sax.saxutils import escape
from .assessment import model


def eye_pdf(result: dict) -> bytes:
    case, prediction = result["case"], result["prediction"]
    if not prediction:
        raise ValueError("A held assessment cannot produce a scored report.")
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=30, bottomMargin=28,
                            leftMargin=36, rightMargin=36, title="NKPI research assessment")
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle("Purple", parent=styles["Title"], fontSize=19, leading=23,
                              textColor=colors.HexColor("#4E2A84")))
    styles.add(ParagraphStyle("Fine", parent=styles["BodyText"], fontSize=8, leading=10))
    styles.add(ParagraphStyle("Small", parent=styles["BodyText"], fontSize=9, leading=12))
    clean = lambda s: escape(str(s).replace("µ", "u").replace("·", "-").replace("–", "-").replace("−", "-"))
    p = lambda s, style="Small": Paragraph(clean(s), styles[style])
    story = [Paragraph("Northwestern KCN Progression Index", styles["Purple"]),
             p("Research prototype | Purple interface v8.4 | 3.1.0-interval-half", "Fine"), Spacer(1, 10),
             p(f"{case['eye']} | {'Two visits' if case['mode']=='longitudinal' else 'Single visit'} | Age at first scan: {case['age']:g}"),
             p(f"{'SYNTHETIC EXAMPLE | ' if case['demo'] else ''}NKPI: {prediction['nkpi']:.1f} / 100"),
             p("CXL-associated model index, not disease stage, future progression probability, or a treatment recommendation."),
             Spacer(1, 10)]
    paired = case["mode"] == "longitudinal"
    rows = [["Measurement", "First / only scan", "Later scan", "Change"]]
    for m in result["measurements"]:
        fmt = lambda v: "-" if v is None else f"{v:.{m['decimals']}f}"
        unit = m["unit"].replace("µ", "u")
        rows.append([m["label"].replace("·", "-") + (" ("+unit+")" if unit else ""), fmt(m["first"]), fmt(m["latest"]), fmt(m["change"])])
    table = Table(rows, colWidths=[174, 122, 122, 122])
    table.setStyle(TableStyle([("BACKGROUND", (0,0),(-1,0),colors.HexColor("#4E2A84")),
                              ("TEXTCOLOR",(0,0),(-1,0),colors.white),
                              ("GRID",(0,0),(-1,-1),.35,colors.HexColor("#DED4E9")),
                              ("FONTSIZE",(0,0),(-1,-1),9),
                              ("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
    story += [table, Spacer(1, 9)]
    if paired:
        story.append(p(f"Verified scan interval: {case['interval_days']} days. Measured changes are later minus first; they are not adjudicated progression flags."))
    story += [p("Main model sensitivities", "Heading3")]
    specs = model(case["mode"])["feature_spec"]
    for effect in prediction["effects"][:4]:
        label = effect["label"]
        spec = specs[effect["feature"]]
        if spec["source"] == "change":
            label += " (first - later)" if spec.get("direction", 1) == -1 else " (later - first)"
        story.append(p(f"{label}: actual input {effect['value']:.3f}; cohort median {effect['reference']:.3f}; one-at-a-time effect {effect['effect']:+.1f} NKPI points."))
    story.append(p("These one-at-a-time substitutions are not additive, causal, or SHAP explanations. All values above are taken from the same submitted snapshot.", "Fine"))
    for warning in result["warnings"]:
        story.append(p(warning, "Fine"))
    story += [Spacer(1, 8), p("Numerical surface data were not part of this assessment. This report contains no patient-specific corneal geometry.", "Fine"),
              p("A low index does not establish stability or exclude marked tomographic abnormality. Independent external validation and prospective outcome validation are not established.", "Fine"),
              Spacer(1, 8), p("Input SHA-256: " + result["input_sha256"], "Fine"),
              p("Model SHA-256: " + result["model_sha256"], "Fine")]
    doc.build(story)
    return buffer.getvalue()
