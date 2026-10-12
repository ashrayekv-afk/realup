"""Streamlit entry point. Run: streamlit run kcn_dual_calculator_app.py"""
from pathlib import Path
import streamlit as st
import streamlit.components.v1 as components
from nkpi.service import calculate, configuration

st.set_page_config(page_title="NKPI | Bilateral calculator", page_icon="◉", layout="wide", initial_sidebar_state="collapsed")
st.markdown("""<style>
.block-container{padding:3.75rem .5rem 1rem!important;max-width:1120px!important;}
[data-testid="stAppViewContainer"]{background:#F7F6FA;}
[data-testid="stHeader"]{background:transparent;}
iframe{border:0;} footer{visibility:hidden;}
</style>""", unsafe_allow_html=True)
workspace = components.declare_component("nkpi_purple_bilateral_v8_7_0", path=str(Path(__file__).parent / "components"))
try:
    config = configuration()
except Exception:
    st.error("The model artifacts did not pass verification. Restore the complete models and research folders from this release.")
    st.stop()
event = workspace(config=config, response=st.session_state.get("nkpi_response"), key="nkpi_purple_v8_7_0", default=None)
if isinstance(event, dict) and event.get("id") != st.session_state.get("nkpi_last_event"):
    event_id = event.get("id")
    if not isinstance(event_id, str) or not 1 <= len(event_id) <= 100:
        st.stop()
    st.session_state["nkpi_last_event"] = event_id
    if event.get("action") == "clear":
        st.session_state.pop("nkpi_response", None)
        st.rerun()
    elif event.get("action") == "assess":
        try:
            response = {"id": event_id, "result": calculate(event.get("payload"))}
        except (ValueError, TypeError, KeyError):
            response = {"id": event_id, "error": "Input verification failed. Check the eye, values, scan order and source confirmation; no score was substituted."}
        except Exception:
            response = {"id": event_id, "error": "Calculation did not complete. Restore the complete release package; no fallback score is used."}
        st.session_state["nkpi_response"] = response
        st.rerun()
