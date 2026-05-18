(function () {
  "use strict";

  var QUESTION_SELECTORS = [
    "#question-Text .t-ContentBlock-body",
    ".question-text",
    ".questionText",
    "[id*='question']",
    "td.question",
    ".qtext",
    "[id*='QUESTION']",
    ".t-ContentBlock-body",
    ".uQuestionText"
  ];

  var CHOICE_SELECTORS = [
    "input[type='radio']",
    "input[type='checkbox']",
    ".choice-SelectArea",
    ".choice-Text",
    ".choice-Container",
    ".answer-option",
    ".choiceText",
    "[id*='CHOICE']",
    "[id*='ANSWER']"
  ];

  function textFromNode(node) {
    if (!node) {
      return "";
    }
    var text = (node.textContent || "").replace(/\s+/g, " ").trim();
    return text;
  }

  function resolveLabelText(input) {
    if (!input) {
      return "";
    }

    var id = input.getAttribute("id");
    var label = null;

    if (id) {
      label = input.ownerDocument.querySelector("label[for='" + id.replace(/"/g, "") + "']");
      if (label && textFromNode(label)) {
        return textFromNode(label);
      }
    }

    label = input.closest("label");
    if (label && textFromNode(label)) {
      return textFromNode(label);
    }

    if (input.nextElementSibling && textFromNode(input.nextElementSibling)) {
      return textFromNode(input.nextElementSibling);
    }

    if (input.parentElement && textFromNode(input.parentElement)) {
      return textFromNode(input.parentElement);
    }

    return "";
  }

  function findQuestionInDoc(doc) {
    var i;
    for (i = 0; i < QUESTION_SELECTORS.length; i += 1) {
      var selector = QUESTION_SELECTORS[i];
      var node = doc.querySelector(selector);
      if (node) {
        var text = textFromNode(node);
        if (text) {
          return text;
        }
      }
    }
    return "";
  }

  function findChoicesInDoc(doc) {
    var choices = [];
    var seen = new Set();

    var inputs = Array.prototype.slice.call(
      doc.querySelectorAll("input[type='radio'], input[type='checkbox']")
    );

    inputs.forEach(function (input) {
      var labelText = resolveLabelText(input);
      if (labelText) {
        choices.push({
          text: labelText,
          element: input,
          isInput: true
        });
        seen.add(labelText);
      }
    });

    var i;
    for (i = 0; i < CHOICE_SELECTORS.length; i += 1) {
      var selector = CHOICE_SELECTORS[i];
      var nodes = Array.prototype.slice.call(doc.querySelectorAll(selector));
      nodes.forEach(function (node) {
        if (node.tagName && (node.tagName.toLowerCase() === "input")) {
          return;
        }
        var text = textFromNode(node);
        if (text && !seen.has(text)) {
          choices.push({
            text: text,
            element: node,
            isInput: false
          });
          seen.add(text);
        }
      });
    }

    return choices;
  }

  function collectFromDocument(doc) {
    var question = findQuestionInDoc(doc);
    var choices = findChoicesInDoc(doc);
    // Detect multi-select: true when at least one choice is a checkbox input
    var isMultiSelect = choices.some(function (c) {
      return c.isInput && c.element && c.element.type === "checkbox";
    });
    return {
      question: question,
      choices: choices,
      isMultiSelect: isMultiSelect
    };
  }

  function collectFromAllDocuments() {
    var docs = [document];
    var frames = Array.prototype.slice.call(document.querySelectorAll("iframe"));

    frames.forEach(function (frame) {
      try {
        if (frame.contentDocument) {
          docs.push(frame.contentDocument);
        }
      } catch (err) {
        // Cross-origin frames are not accessible.
      }
    });

    var i;
    for (i = 0; i < docs.length; i += 1) {
      var data = collectFromDocument(docs[i]);
      if (data.question && data.choices.length > 0) {
        return data;
      }
    }

    return { question: "", choices: [], isMultiSelect: false };
  }

  function clickChoice(choice) {
    if (!choice || !choice.element) {
      return false;
    }

    choice.element.click();

    if (choice.isInput) {
      var event = new Event("change", { bubbles: true });
      choice.element.dispatchEvent(event);
    }

    return true;
  }

  function findNextButton(doc) {
    var candidates = Array.prototype.slice.call(
      doc.querySelectorAll("button, input, a")
    );

    var withId = candidates.filter(function (el) {
      var id = (el.getAttribute("id") || "").toLowerCase();
      return id.indexOf("next") !== -1;
    });

    if (withId.length > 0) {
      return withId[0];
    }

    var withText = candidates.filter(function (el) {
      var text = textFromNode(el);
      return /next|continue|submit/i.test(text);
    });

    if (withText.length > 0) {
      return withText[0];
    }

    return null;
  }

  function clickNextButton() {
    var docs = [document];
    var frames = Array.prototype.slice.call(document.querySelectorAll("iframe"));

    frames.forEach(function (frame) {
      try {
        if (frame.contentDocument) {
          docs.push(frame.contentDocument);
        }
      } catch (err) {
        // Cross-origin frames are not accessible.
      }
    });

    var i;
    for (i = 0; i < docs.length; i += 1) {
      var nextBtn = findNextButton(docs[i]);
      if (nextBtn) {
        nextBtn.click();
        return true;
      }
    }

    return false;
  }


  function handleMessage(message, sender, sendResponse) {
    if (!message || !message.type) {
      return;
    }

    if (message.type === "getQuestion") {
      var data = collectFromAllDocuments();
      sendResponse({
        question: data.question,
        choices: data.choices.map(function (c) { return c.text; }),
        isMultiSelect: data.isMultiSelect
      });
      return true;
    }

    if (message.type === "selectAnswer") {
      // indices is an array of 1-based answer numbers
      var indices = message.indices;
      var dataForSelect = collectFromAllDocuments();
      var clickedTexts = [];
      var anyOk = false;
      indices.forEach(function (idx) {
        var target = dataForSelect.choices[idx - 1];
        var ok = clickChoice(target);
        if (ok) {
          anyOk = true;
          clickedTexts.push(target ? target.text : "");
        }
      });
      sendResponse({
        ok: anyOk,
        clickedText: clickedTexts.join(", ")
      });
      return true;
    }

    if (message.type === "nextQuestion") {
      var advanced = clickNextButton();
      sendResponse({ ok: advanced });
      return true;
    }
  }

  if (typeof browser !== "undefined" && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener(handleMessage);
  } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(handleMessage);
  }
})();
