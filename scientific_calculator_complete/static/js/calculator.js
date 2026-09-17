(() => {
  const exprEl = document.getElementById("keyPad_UserInput1");
  const dispEl = document.getElementById("keyPad_UserInput");
  const memEl = document.getElementById("memory");
  const pad = document.getElementById("keyPad");
  const helpOverlay = document.getElementById("helpOverlay");
  const histOverlay = document.getElementById("histOverlay");
  const historyList = document.getElementById("historyList");
  const secondBtn = document.getElementById("btnSecond");

  const state = {
    display: "0",
    expression: "",
    memory: 0,
    hasMemory: false,
    waiting: false,
    second: false,
    pending: null,
    lastAns: "0",
    error: false,
    openParens: 0,
  };

  const binarySymbols = {
    add: "+",
    sub: "-",
    mul: "*",
    div: "/",
    mod: "mod",
    pow: "^",
    yroot: "yroot",
    logy: "logy",
    exp10: "Exp",
    npr: "nPr",
    ncr: "nCr",
  };

  const angleBtn = document.getElementById("angleMode");
  const angleCycle = ["deg", "rad", "grad"];
  const angleLabel = { deg: "Deg", rad: "Rad", grad: "Grad" };

  function angleMode() {
    return angleBtn.dataset.mode || "deg";
  }

  function render() {
    exprEl.value = state.expression;
    dispEl.value = state.display;
    memEl.classList.toggle("show", state.hasMemory);
    secondBtn.classList.toggle("second-on", state.second);
    updateSecondLabels();
  }

  function updateSecondLabels() {
    document.querySelectorAll("[data-unary2],[data-binary2]").forEach((el) => {
      if (!el.dataset.orig) el.dataset.orig = el.innerHTML;
      if (!state.second) {
        el.innerHTML = el.dataset.orig;
        return;
      }
      const map = {
        csch: "csch",
        sech: "sech",
        coth: "coth",
        square: "x²",
        round: "rnd",
        npr: "nPr",
        ncr: "nCr",
        twox: "2<sup>x</sup>",
        rand: "rnd",
        ceil: "ceil",
        floor: "flr",
      };
      const key = el.dataset.unary2 || el.dataset.binary2;
      if (map[key]) el.innerHTML = map[key];
    });
  }

  function currentValue() {
    const n = Number(state.display);
    if (!Number.isFinite(n)) throw new Error("Invalid number");
    return n;
  }

  async function apiEval(payload) {
    const res = await fetch("/api/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, angle: angleMode() }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Math error");
    return data.result;
  }

  async function saveHistory(expression, result) {
    await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expression, result }),
    });
  }

  async function loadHistory() {
    const res = await fetch("/api/history");
    const data = await res.json();
    const items = data.items || [];
    historyList.innerHTML = items.length
      ? items
          .map(
            (item) =>
              `<div class="history-item" data-result="${item.result}">
                 <span class="expr">${item.expression}</span>
                 <span class="res">${item.result}</span>
               </div>`
          )
          .join("")
      : "<p>No history yet.</p>";
  }

  function setError(message) {
    state.error = true;
    state.display = message;
    state.waiting = true;
    state.pending = null;
    render();
  }

  function inputDigit(d) {
    if (state.error) clearAll();
    if (state.waiting) {
      state.display = d;
      state.waiting = false;
    } else if (state.display === "0") {
      state.display = d;
    } else if (state.display.length < 32) {
      state.display += d;
    }
    render();
  }

  function inputDot() {
    if (state.error) clearAll();
    if (state.waiting) {
      state.display = "0.";
      state.waiting = false;
    } else if (!state.display.includes(".")) {
      state.display += ".";
    }
    render();
  }

  function backspace() {
    if (state.error || state.waiting) return;
    if (state.display.length <= 1 || (state.display.length === 2 && state.display.startsWith("-"))) {
      state.display = "0";
    } else {
      state.display = state.display.slice(0, -1);
    }
    render();
  }

  function clearAll() {
    state.display = "0";
    state.expression = "";
    state.waiting = false;
    state.pending = null;
    state.error = false;
    state.openParens = 0;
    render();
  }

  async function applyUnary(op) {
    try {
      const x = currentValue();
      const result = await apiEval({ op, x });
      state.expression = `${op}(${x})`;
      state.display = result;
      state.lastAns = result;
      state.waiting = true;
      await saveHistory(state.expression, result);
      render();
    } catch (err) {
      setError(err.message);
    }
  }

  async function applyBinary(op) {
    try {
      if (state.pending && !state.waiting) {
        await equals();
      }
      state.pending = { op, x: currentValue(), symbol: binarySymbols[op] || op };
      state.expression = `${state.pending.x} ${state.pending.symbol}`;
      state.waiting = true;
      render();
    } catch (err) {
      setError(err.message);
    }
  }

  async function equals() {
    try {
      if (!state.pending) {
        state.expression = state.display;
        state.lastAns = state.display;
        render();
        return;
      }
      const y = currentValue();
      const { op, x, symbol } = state.pending;
      const result = await apiEval({ op, x, y });
      const expression = `${x} ${symbol} ${y}`;
      state.expression = expression;
      state.display = result;
      state.lastAns = result;
      state.pending = null;
      state.waiting = true;
      await saveHistory(expression + " =", result);
      render();
    } catch (err) {
      setError(err.message);
    }
  }

  async function insertConst(name) {
    try {
      const result = await apiEval({ op: "const", name });
      state.display = result;
      state.waiting = true;
      render();
    } catch (err) {
      setError(err.message);
    }
  }

  function memoryUpdate() {
    state.hasMemory = state.memory !== 0;
    render();
  }

  pad.addEventListener("click", async (event) => {
    const a = event.target.closest("a");
    if (!a || !pad.contains(a)) return;
    event.preventDefault();

    if (a.id === "angleMode") {
      const idx = angleCycle.indexOf(angleMode());
      const next = angleCycle[(idx + 1) % angleCycle.length];
      angleBtn.dataset.mode = next;
      angleBtn.textContent = angleLabel[next];
      return;
    }
    if (a.id === "keyPad_btnBack") return backspace();
    if (a.id === "keyPad_btnAllClr") return clearAll();
    if (a.id === "keyPad_btnEnter") return equals();
    if (a.id === "btnSecond") {
      state.second = !state.second;
      render();
      return;
    }
    if (a.id === "btnAns") {
      state.display = state.lastAns;
      state.waiting = true;
      render();
      return;
    }
    if (a.id === "btnHist") {
      helpOverlay.classList.remove("show");
      histOverlay.classList.toggle("show");
      if (histOverlay.classList.contains("show")) loadHistory();
      return;
    }
    if (a.id === "keyPad_MC") {
      state.memory = 0;
      memoryUpdate();
      return;
    }
    if (a.id === "keyPad_MR") {
      state.display = String(state.memory);
      state.waiting = true;
      render();
      return;
    }
    if (a.id === "keyPad_MS") {
      state.memory = currentValue();
      memoryUpdate();
      return;
    }
    if (a.id === "keyPad_M+") {
      state.memory += currentValue();
      memoryUpdate();
      return;
    }
    if (a.id === "keyPad_M-") {
      state.memory -= currentValue();
      memoryUpdate();
      return;
    }
    if (a.dataset.num) return inputDigit(a.dataset.num);
    if (a.dataset.dot) return inputDot();
    if (a.dataset.const) return insertConst(a.dataset.const);
    if (a.dataset.char === "(") {
      state.expression += "(";
      state.openParens += 1;
      state.waiting = true;
      render();
      return;
    }
    if (a.dataset.char === ")") {
      if (state.openParens > 0) {
        state.expression += state.display + ")";
        state.openParens -= 1;
        render();
      }
      return;
    }

    if (state.second && a.dataset.unary2) {
      state.second = false;
      return applyUnary(a.dataset.unary2);
    }
    if (state.second && a.dataset.binary2) {
      state.second = false;
      return applyBinary(a.dataset.binary2);
    }
    if (a.dataset.unary) return applyUnary(a.dataset.unary);
    if (a.dataset.binary) return applyBinary(a.dataset.binary);
    if (a.dataset.op === "mod") return applyBinary("mod");
  });

  document.getElementById("keyPad_Help").addEventListener("click", () => {
    histOverlay.classList.remove("show");
    helpOverlay.classList.toggle("show");
  });

  document.getElementById("calc_min").addEventListener("click", () => {
    pad.classList.toggle("minimized");
  });

  document.getElementById("closeButton").addEventListener("click", () => {
    pad.style.display = "none";
  });

  document.getElementById("closeHist").addEventListener("click", () => {
    histOverlay.classList.remove("show");
  });

  document.getElementById("copyResult").addEventListener("click", async () => {
    await navigator.clipboard.writeText(state.display);
  });

  document.getElementById("clearHistory").addEventListener("click", async () => {
    await fetch("/api/history", { method: "DELETE" });
    loadHistory();
  });

  historyList.addEventListener("click", (event) => {
    const item = event.target.closest(".history-item");
    if (!item) return;
    state.display = item.dataset.result;
    state.waiting = true;
    histOverlay.classList.remove("show");
    render();
  });

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === "c") {
      navigator.clipboard.writeText(state.display);
      return;
    }
    if (event.key >= "0" && event.key <= "9") {
      event.preventDefault();
      inputDigit(event.key);
    } else if (event.key === ".") {
      event.preventDefault();
      inputDot();
    } else if (event.key === "Backspace") {
      event.preventDefault();
      backspace();
    } else if (event.key === "Escape") {
      event.preventDefault();
      clearAll();
    } else if (event.key === "Enter" || event.key === "=") {
      event.preventDefault();
      equals();
    } else if (event.key === "+") {
      event.preventDefault();
      applyBinary("add");
    } else if (event.key === "-") {
      event.preventDefault();
      applyBinary("sub");
    } else if (event.key === "*") {
      event.preventDefault();
      applyBinary("mul");
    } else if (event.key === "/") {
      event.preventDefault();
      applyBinary("div");
    } else if (event.key === "%") {
      event.preventDefault();
      applyUnary("percent");
    } else if (event.key === "(" || event.key === ")") {
      event.preventDefault();
      document.querySelector(`[data-char="${event.key}"]`).click();
    }
  });

  render();
})();
