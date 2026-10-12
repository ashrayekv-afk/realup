"""Snapshot-bound inference and feature audit. No model fitting or score adjustment."""
from __future__ import annotations

import base64
import hashlib
import json
import math
from typing import Any

from .assessment import assess_both, model, public_config
from .impact_audit import ranked_impact_audit
from . import evidence, baseline_outlook

UI_VERSION = "8.7.0-regional-change"


def feature_inputs(case: dict[str, Any]) -> dict[str, float]:
    """Independent, named audit of the feature values consumed by the frozen model."""
    artifact = model(case["mode"])
    values = {}
    for name in artifact["features"]:
        spec = artifact["feature_spec"][name]
        source, key = spec["source"], spec.get("key")
        if source == "age":
            value = case["age"]
        elif source == "interval_years":
            value = case["interval_days"] / spec.get("days_per_year", 365.2425)
        elif source == "change":
            value = case["latest"][key] - case["first"][key]
        elif source in ("first", "latest"):
            value = case[source][key]
        else:
            raise ValueError("Unknown feature mapping; calculation stopped.")
        values[name] = value * spec.get("direction", 1)
    return values


def fingerprint(case: dict[str, Any]) -> str:
    data = json.dumps(case, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def audit_result(result: dict[str, Any]) -> list[dict[str, Any]]:
    if not result["prediction"]:
        return []
    expected = feature_inputs(result["case"])
    effects = result["prediction"]["effects"]
    if len(effects) != len(expected) or {e["feature"] for e in effects} != set(expected):
        raise ValueError("The explanation feature set does not match the model input.")
    audit = []
    for name, value in expected.items():
        effect = next(e for e in effects if e["feature"] == name)
        if not math.isclose(value, effect["value"], rel_tol=1e-12, abs_tol=1e-12):
            raise ValueError("Input-to-explanation mismatch. Result withheld.")
        audit.append({"feature": name, "label": effect["label"],
                      "input_value": value, "model_value": effect["value"], "match": True})
    return audit


def configuration() -> dict[str, Any]:
    result = public_config()
    result["ui_version"] = UI_VERSION
    result["feature_specs"] = {mode: model(mode)["feature_spec"] for mode in ("baseline", "longitudinal")}
    result["feature_order"] = {mode: model(mode)["features"] for mode in ("baseline", "longitudinal")}
    result["evidence"] = evidence.configuration()
    result["baseline_outlook"] = baseline_outlook.configuration()
    return result


def calculate(payload: dict[str, Any], *, include_pdf: bool = True) -> dict[str, Any]:
    if len(json.dumps(payload, allow_nan=False)) > 30000:
        raise ValueError("Numeric payload is too large.")
    result = assess_both(payload)
    for eye, assessment in result["eyes"].items():
        if assessment["case"]["eye"] != eye:
            raise ValueError("Laterality mismatch. Result withheld.")
        assessment["audit"] = audit_result(assessment)
        assessment["impact_audit"] = ranked_impact_audit(assessment)
        assessment["input_sha256"] = fingerprint(assessment["case"])
        assessment["model_sha256"] = assessment["model"]["sha256"] if assessment["model"] else None
        assessment["evidence"] = evidence.analyze(assessment, assessment["input_sha256"])
        assessment["baseline_outlook"] = baseline_outlook.analyze(assessment, assessment["input_sha256"])
        if include_pdf and assessment["prediction"]:
            from .reports import eye_pdf
            assessment["pdf_base64"] = base64.b64encode(eye_pdf(assessment)).decode("ascii")
    result["ui_version"] = UI_VERSION
    return result
