(function () {
  "use strict";

  var apiKeyInput = document.getElementById("apiKey");
  var modelInput = document.getElementById("model");
  var solveBtn = document.getElementById("solveBtn");
  var questionPreview = document.getElementById("questionPreview");
  var aiAnswer = document.getElementById("aiAnswer");
  var clickedAnswer = document.getElementById("clickedAnswer");
  var logArea = document.getElementById("logArea");
  var statusArea = document.getElementById("statusArea");
  var logToggle = document.getElementById("logToggle");
  var logCount = document.getElementById("logCount");
  var logActions = document.getElementById("logActions");
  var exportBtn = document.getElementById("exportBtn");
  var clearBtn = document.getElementById("clearBtn");

  var LOG_KEY = "quiz_solver_log";
  var LOG_ENABLED_KEY = "quiz_solver_log_enabled";

  function setLog(message, isError) {
    logArea.textContent = message || "";
    statusArea.classList.toggle("error", !!isError);
    if (isError) {
      logArea.classList.add("error");
    } else {
      logArea.classList.remove("error");
    }
  }

  function saveSettings() {
    localStorage.setItem("openrouter_api_key", apiKeyInput.value.trim());
    localStorage.setItem("openrouter_model", modelInput.value.trim());
  }

  function loadSettings() {
    var savedKey = localStorage.getItem("openrouter_api_key") || "";
    var savedModel = localStorage.getItem("openrouter_model") || "openai/gpt-4o-mini";
    apiKeyInput.value = savedKey;
    modelInput.value = savedModel;
  }

  // ── Q&A Log helpers ──────────────────────────────────────────────

  function getLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch (e) { return []; }
  }

  function updateLogUI() {
    var entries = getLog();
    logCount.textContent = entries.length;
    var enabled = logToggle.checked;
    logActions.classList.toggle("visible", enabled && entries.length > 0);
  }

  function appendToLog(question, choices, answerIndices, clickedText) {
    if (!logToggle.checked) { return; }
    var entries = getLog();
    entries.push({
      question: question,
      choices: choices,
      aiAnswerIndices: answerIndices,
      clickedAnswers: clickedText
    });
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
    updateLogUI();
  }

  function exportLog() {
    var entries = getLog();
    if (entries.length === 0) { return; }
    var blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "quiz_log_" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearLog() {
    if (!confirm("Clear all " + getLog().length + " saved questions?")) { return; }
    localStorage.removeItem(LOG_KEY);
    updateLogUI();
  }

  function getActiveTab() {
    return new Promise(function (resolve, reject) {
      var api = typeof browser !== "undefined" ? browser : chrome;
      api.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (api.runtime && api.runtime.lastError) {
          reject(new Error(api.runtime.lastError.message));
          return;
        }
        resolve(tabs[0]);
      });
    });
  }

  function sendMessageToTab(tabId, message) {
    return new Promise(function (resolve, reject) {
      var api = typeof browser !== "undefined" ? browser : chrome;
      api.tabs.sendMessage(tabId, message, function (response) {
        if (api.runtime && api.runtime.lastError) {
          reject(new Error(api.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  // Extracts the required answer count from hints like "(Choose 2)", "(Select 3)", "(Choose three answers)", etc.
  function parseRequiredCount(question) {
    var wordMap = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    // Match digit form: (Choose 2), (Select 3 answers), (Choose Two Answers), etc.
    var m = String(question).match(/\b(?:choose|select|pick)\s+(\d+|\w+)/i);
    if (m) {
      var raw = m[1].toLowerCase();
      if (wordMap[raw]) { return wordMap[raw]; }
      var n = parseInt(raw, 10);
      if (!isNaN(n)) { return n; }
    }
    return null;
  }

  function buildPrompt(question, choices, isMultiSelect) {
    var list = choices.map(function (choice, idx) {
      return (idx + 1) + ". " + choice;
    }).join("\n");

    var formatRule;
    if (isMultiSelect) {
      var requiredCount = parseRequiredCount(question);
      var countClause = requiredCount
        ? "You MUST return EXACTLY " + requiredCount + " numbers."
        : "Return ALL correct answer numbers.";
      formatRule = "- This is a MULTIPLE CORRECT ANSWERS question. " + countClause + " Reply with ONLY those numbers separated by commas, e.g.: 1,3 or 2,4,5. Nothing else.";
    } else {
      formatRule = "- Reply with ONLY the number of the correct answer. Nothing else.\n- No explanation, no punctuation, no extra words. Just a single digit like: 2";
    }

    return {
      system: "You are an Oracle technology expert with deep knowledge of:\n- SQL and PL/SQL (Oracle Database syntax specifically, not generic SQL)\n- Java programming (SE and EE)\n- Oracle Database concepts (architecture, storage, memory, transactions)\n- Oracle APEX (Application Express)\n- Oracle Cloud Infrastructure (OCI)\n- Database design and normalization\n- Data types, constraints, indexes, views, sequences, synonyms\n- Oracle-specific functions and behavior\n\nYou are answering multiple choice quiz questions from Oracle Academy.\n\nRules:\n" + formatRule + "\n- For True/False questions: 1 = True, 2 = False (unless the choices show otherwise)\n- When two answers seem close, pick the one that matches Oracle's official documentation and terminology exactly\n- Oracle syntax and behavior often differs from standard SQL — always prefer Oracle-specific answers\n- Never leave a blank — if unsure, pick the most technically precise option",
      user: "Question: " + question + "\n\nChoices:\n" + list
    };
  }

  function callOpenRouter(apiKey, model, prompt) {
    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
        "HTTP-Referer": "https://academy.oracle.com",
        "X-Title": "Oracle Quiz Solver"
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        max_tokens: 1024,
        temperature: 0
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error("OpenRouter error: " + text);
        });
      }
      return res.json();
    });
  }

  function parseAnswerNumbers(text) {
    var cleaned = String(text || "");

    // Strip DeepSeek R1 / other CoT think blocks: <think>...</think>
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");

    // Find the last non-empty line — models typically put the final answer last
    var lines = cleaned.split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var answerLine = "";
    for (var i = lines.length - 1; i >= 0; i--) {
      // Accept lines that are only digits, commas, and spaces (e.g. "2" or "1, 3" or "2,4")
      if (/^[\d,\s]+$/.test(lines[i])) {
        answerLine = lines[i];
        break;
      }
    }

    // Fallback: grab all digits anywhere in the cleaned text
    if (!answerLine) {
      answerLine = cleaned;
    }

    var matches = answerLine.match(/\d+/g);
    if (!matches || matches.length === 0) {
      return null;
    }
    return matches.map(function (n) { return parseInt(n, 10); });
  }

  function truncate(text, maxLen) {
    if (!text) {
      return "-";
    }
    if (text.length <= maxLen) {
      return text;
    }
    return text.slice(0, maxLen - 1) + "…";
  }

  function setBusy(isBusy) {
    solveBtn.disabled = isBusy;
  }

  async function onSolve() {
    try {
      setBusy(true);
      setLog("Working...", false);
      saveSettings();

      var apiKey = apiKeyInput.value.trim();
      var model = modelInput.value.trim();
      if (!apiKey) {
        throw new Error("Please enter your OpenRouter API key.");
      }

      var tab = await getActiveTab();
      if (!tab || !tab.id) {
        throw new Error("No active tab found.");
      }

      var data = await sendMessageToTab(tab.id, { type: "getQuestion" });
      if (!data || !data.question || !data.choices || data.choices.length === 0) {
        throw new Error("No question found. Make sure the quiz is visible.");
      }

      questionPreview.textContent = truncate(data.question, 140);

      var prompt = buildPrompt(data.question, data.choices, data.isMultiSelect);
      var result = await callOpenRouter(apiKey, model, prompt);
      var content = result && result.choices && result.choices[0] && result.choices[0].message
        ? result.choices[0].message.content
        : "";

      var answerNumbers = parseAnswerNumbers(content);
      if (!answerNumbers) {
        throw new Error("Could not parse an answer number from the AI response.");
      }

      aiAnswer.textContent = answerNumbers.join(", ");

      var selectResult = await sendMessageToTab(tab.id, {
        type: "selectAnswer",
        indices: answerNumbers
      });

      if (!selectResult || !selectResult.ok) {
        throw new Error("Could not click the answer choice.");
      }

      clickedAnswer.textContent = truncate(selectResult.clickedText, 120);

      // Save to Q&A log if enabled
      appendToLog(data.question, data.choices, answerNumbers, selectResult.clickedText);

      await new Promise(function (resolve) {
        setTimeout(resolve, 1500);
      });

      var nextResult = await sendMessageToTab(tab.id, { type: "nextQuestion" });
      if (!nextResult || !nextResult.ok) {
        setLog("Answer clicked, but Next button was not found.", true);
      } else {
        setLog("Done. Ready for next question.", false);
      }
    } catch (err) {
      setLog(err.message || "Unexpected error.", true);
    } finally {
      setBusy(false);
    }
  }

  solveBtn.addEventListener("click", onSolve);
  apiKeyInput.addEventListener("change", saveSettings);
  modelInput.addEventListener("change", saveSettings);

  logToggle.addEventListener("change", function () {
    localStorage.setItem(LOG_ENABLED_KEY, logToggle.checked ? "1" : "0");
    updateLogUI();
  });
  exportBtn.addEventListener("click", exportLog);
  clearBtn.addEventListener("click", clearLog);

  loadSettings();
  logToggle.checked = localStorage.getItem(LOG_ENABLED_KEY) === "1";
  updateLogUI();
})();
