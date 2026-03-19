(function () {
  let feedbackEl = null;
  let feedbackTimer = null;

  function ensureFeedbackElement() {
    if (feedbackEl) return feedbackEl;

    feedbackEl = document.createElement("div");
    feedbackEl.id = "global-feedback";
    feedbackEl.className = "global-feedback";
    document.body.appendChild(feedbackEl);

    return feedbackEl;
  }

  function showFeedback(message, type = "success", duration = 3000) {
    const el = ensureFeedbackElement();

    el.textContent = String(message || "");
    el.className = `global-feedback ${type} show`;

    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }

    feedbackTimer = setTimeout(() => {
      el.classList.remove("show");
    }, duration);
  }

  function hideFeedback() {
    if (!feedbackEl) return;

    feedbackEl.classList.remove("show");

    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }
  }

  window.showFeedback = showFeedback;
  window.hideFeedback = hideFeedback;
})();