"""TCS iON-style scientific calculator with extra features, served by Flask."""

from __future__ import annotations

import math
from datetime import datetime

from flask import Flask, jsonify, render_template, request, session

app = Flask(__name__)
app.secret_key = "scientific-calculator-local-key"


def _num(value) -> float:
    if value in (None, ""):
        raise ValueError("Empty value")
    return float(value)


def _angle_to_rad(x: float, mode: str) -> float:
    if mode == "deg":
        return math.radians(x)
    if mode == "grad":
        return x * math.pi / 200.0
    return x


def _rad_to_angle(x: float, mode: str) -> float:
    if mode == "deg":
        return math.degrees(x)
    if mode == "grad":
        return x * 200.0 / math.pi
    return x


def _format(value: float) -> str:
    if isinstance(value, bool) or value is None:
        raise ValueError("Invalid result")
    if math.isnan(value) or math.isinf(value):
        raise ValueError("Result out of range")
    if abs(value) > 0 and (abs(value) >= 1e12 or abs(value) < 1e-10):
        text = f"{value:.10e}"
    else:
        text = f"{value:.12g}"
    if "e" in text.lower():
        return text
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _factorial(x: float) -> float:
    if x < 0:
        raise ValueError("Factorial of negative")
    if abs(x - round(x)) < 1e-12:
        n = int(round(x))
        if n > 170:
            raise ValueError("Factorial overflow")
        return float(math.factorial(n))
    return math.gamma(x + 1.0)


def _npr(n: float, r: float) -> float:
    ni, ri = int(round(n)), int(round(r))
    if ni < 0 or ri < 0 or ri > ni:
        raise ValueError("Invalid nPr")
    return float(math.perm(ni, ri))


def _ncr(n: float, r: float) -> float:
    ni, ri = int(round(n)), int(round(r))
    if ni < 0 or ri < 0 or ri > ni:
        raise ValueError("Invalid nCr")
    return float(math.comb(ni, ri))


UNARY_OPS = {
    "sin": lambda x, m: math.sin(_angle_to_rad(x, m)),
    "cos": lambda x, m: math.cos(_angle_to_rad(x, m)),
    "tan": lambda x, m: math.tan(_angle_to_rad(x, m)),
    "asin": lambda x, m: _rad_to_angle(math.asin(x), m),
    "acos": lambda x, m: _rad_to_angle(math.acos(x), m),
    "atan": lambda x, m: _rad_to_angle(math.atan(x), m),
    "sinh": lambda x, m: math.sinh(x),
    "cosh": lambda x, m: math.cosh(x),
    "tanh": lambda x, m: math.tanh(x),
    "asinh": lambda x, m: math.asinh(x),
    "acosh": lambda x, m: math.acosh(x),
    "atanh": lambda x, m: math.atanh(x),
    "csch": lambda x, m: 1.0 / math.sinh(x),
    "sech": lambda x, m: 1.0 / math.cosh(x),
    "coth": lambda x, m: 1.0 / math.tanh(x),
    "sqrt": lambda x, m: math.sqrt(x),
    "cbrt": lambda x, m: math.copysign(abs(x) ** (1.0 / 3.0), x),
    "square": lambda x, m: x ** 2,
    "cube": lambda x, m: x ** 3,
    "ln": lambda x, m: math.log(x),
    "log": lambda x, m: math.log10(x),
    "log2": lambda x, m: math.log2(x),
    "exp": lambda x, m: math.exp(x),
    "tenx": lambda x, m: 10.0 ** x,
    "twox": lambda x, m: 2.0 ** x,
    "inv": lambda x, m: 1.0 / x,
    "abs": lambda x, m: abs(x),
    "fact": lambda x, m: _factorial(x),
    "neg": lambda x, m: -x,
    "percent": lambda x, m: x / 100.0,
    "floor": lambda x, m: math.floor(x),
    "ceil": lambda x, m: math.ceil(x),
    "round": lambda x, m: float(round(x)),
    "rand": lambda x, m: __import__("random").random(),
}

BINARY_OPS = {
    "add": lambda a, b: a + b,
    "sub": lambda a, b: a - b,
    "mul": lambda a, b: a * b,
    "div": lambda a, b: a / b,
    "mod": lambda a, b: a % b,
    "pow": lambda a, b: a ** b,
    "yroot": lambda a, b: a ** (1.0 / b),
    "logy": lambda a, b: math.log(b) / math.log(a),
    "exp10": lambda a, b: a * (10.0 ** b),
    "npr": lambda a, b: _npr(a, b),
    "ncr": lambda a, b: _ncr(a, b),
}


@app.route("/")
def index():
    return render_template("index.html")


@app.post("/api/eval")
def api_eval():
    data = request.get_json(silent=True) or {}
    op = (data.get("op") or "").strip()
    mode = (data.get("angle") or "deg").lower()
    if mode not in {"deg", "rad", "grad"}:
        mode = "deg"
    try:
        if op in UNARY_OPS:
            x = _num(data.get("x"))
            result = UNARY_OPS[op](x, mode)
        elif op in BINARY_OPS:
            x = _num(data.get("x"))
            y = _num(data.get("y"))
            result = BINARY_OPS[op](x, y)
        elif op == "const":
            name = data.get("name")
            consts = {"pi": math.pi, "e": math.e, "phi": (1 + math.sqrt(5)) / 2}
            if name not in consts:
                raise ValueError("Unknown constant")
            result = consts[name]
        else:
            return jsonify({"ok": False, "error": "Unknown operation"}), 400
        formatted = _format(float(result))
        return jsonify({"ok": True, "result": formatted, "numeric": float(result)})
    except ZeroDivisionError:
        return jsonify({"ok": False, "error": "Cannot divide by zero"}), 400
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc) or "Math error"}), 400
    except OverflowError:
        return jsonify({"ok": False, "error": "Overflow"}), 400


@app.get("/api/history")
def get_history():
    return jsonify({"ok": True, "items": session.get("history", [])})


@app.post("/api/history")
def add_history():
    data = request.get_json(silent=True) or {}
    expr = str(data.get("expression") or "").strip()
    result = str(data.get("result") or "").strip()
    if not expr or not result:
        return jsonify({"ok": False, "error": "Missing history item"}), 400
    items = session.get("history", [])
    items.insert(
        0,
        {
            "expression": expr,
            "result": result,
            "at": datetime.now().strftime("%H:%M:%S"),
        },
    )
    session["history"] = items[:40]
    session.modified = True
    return jsonify({"ok": True, "items": session["history"]})


@app.delete("/api/history")
def clear_history():
    session["history"] = []
    session.modified = True
    return jsonify({"ok": True, "items": []})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
