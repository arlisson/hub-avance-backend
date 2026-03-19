(function () {
  const CSS_PATH = "/shared/loading.css";

  function ensureCss() {
    const existing = document.querySelector(`link[data-app-loading="true"]`);
    if (existing) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_PATH;
    link.dataset.appLoading = "true";
    document.head.appendChild(link);
  }

  function ensureMarkup() {
    let overlay = document.getElementById("app-loading");

    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = "app-loading";
    overlay.className = "app-loading-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-busy", "true");

    overlay.innerHTML = `
      <div class="app-loading-card" role="status">
        <div class="app-loading-icon-wrap">
          <div class="app-loading-spinner"></div>
        </div>
        <h2 id="app-loading-title" class="app-loading-title">Carregando</h2>
        <p id="app-loading-message" class="app-loading-message">Aguarde um momento...</p>
      </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
  }

  function getElements() {
    ensureCss();
    const overlay = ensureMarkup();

    return {
      overlay,
      title: document.getElementById("app-loading-title"),
      message: document.getElementById("app-loading-message"),
    };
  }

  function show(options = {}) {
    const { overlay, title, message } = getElements();

    const {
      title: titleText = "Carregando",
      message: messageText = "Aguarde um momento...",
      lockScroll = true,
    } = options;

    if (title) title.textContent = titleText;
    if (message) message.textContent = messageText;

    overlay.hidden = false;

    if (lockScroll) {
      document.body.dataset.appLoadingLock = "true";
      document.body.style.overflow = "hidden";
    }
  }

  function update(options = {}) {
    const { title, message } = getElements();

    if (typeof options.title === "string" && title) {
      title.textContent = options.title;
    }

    if (typeof options.message === "string" && message) {
      message.textContent = options.message;
    }
  }

  function hide() {
    const { overlay } = getElements();

    overlay.hidden = true;

    if (document.body.dataset.appLoadingLock === "true") {
      document.body.style.overflow = "";
      delete document.body.dataset.appLoadingLock;
    }
  }

  window.AppLoading = {
    show,
    update,
    hide,
  };
})();

async function withLoading(task, options = {}) {
  show(options);
  try {
    return await task();
  } finally {
    hide();
  }
}