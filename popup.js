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

  function buildPrompt(question, choices, isMultiSelect) {
    var list = choices.map(function (choice, idx) {
      return (idx + 1) + ". " + choice;
    }).join("\n");

    var formatRule = isMultiSelect
      ? "- This is a MULTIPLE CORRECT ANSWERS question. Reply with ONLY the numbers of ALL correct answers separated by commas, e.g.: 1,3 or 2,4,5. Nothing else."
      : "- Reply with ONLY the number of the correct answer. Nothing else.\n- No explanation, no punctuation, no extra words. Just a single digit like: 2";

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
        max_tokens: 20,
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
    // Extract all integers from the AI response (handles "1", "2,4", "1, 3, 5", etc.)
    var matches = String(text || "").match(/\d+/g);
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

  loadSettings();
})();
