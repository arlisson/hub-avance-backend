/**
 * script.js — AVANCE | Página Unificada
 *
 * Versão migrada para Express + JWT
 *
 * - Remove dependência do Supabase
 * - Usa token JWT salvo em localStorage ("auth_token")
 * - Valida sessão com GET /api/me
 * - Busca perfil com GET /api/profile
 * - Faz logout com POST /api/logout
 * - Registra uso dos apps com POST /api/contador
 * - Mantém seção de produtos pública
 * - Hub de apps se adapta às permissões do usuário
 */

// ============================================================
// CONFIG
// ============================================================

/** Número do WhatsApp do consultor (com DDI, sem espaços ou símbolos). */
const WHATSAPP_NUMBER = "5521995012737";

let LOGIN_URL = "/login/login.html";
let CURRENT_USER_ID = "";
let _currentUserProfile = null; // { name, cpf, whatsapp, operator, active_lines, cidade, estado }

// ============================================================
// CATÁLOGO DE APPS (Hub)
// ============================================================

const APPS = [
  {
    id: "desktop",
    badge: "Preenche Fácil",
    image: "../img/PreencheFacil.png",
    title: "Preenche Fácil",
    shortDesc:
      "O Preenche Fácil te ajuda a manter sua planilha do Excel organizada, funcionando offline na sua máquina.",
    longDesc:
      "O Preenche Fácil é uma ferramenta simples de usar, feita para facilitar sua rotina. Você preenche os dados pelo programa e ele organiza tudo automaticamente no Excel. O programa funciona na sua máquina, sem internet, suas informações ficam com você. Depois de baixar, ele é seu para sempre.",
    youtubeId: "a9bAP6Kn2l4",
    enabled: true,
    requiresPermission: false,
    actions: [
      {
        label: "Baixar",
        icon: "ph-download-simple",
        app: "desktop",
        metric: "download",
        primary: true,
        targetBlank: true,
      },
    ],
  },
  {
    id: "protocol",
    badge: "Gerador de Protocolo Agendor",
    image: "../img/Protocolo.png",
    title: "Gerador de Protocolo Agendor",
    shortDesc: "Gera, registra e envia protocolos integrado ao Agendor.",
    longDesc: "Crie protocolos de atendimento em segundos, com registro automático direto no Agendor. Cada protocolo gerado fica vinculado ao cliente, eliminando o trabalho manual de registro e reduzindo erros no acompanhamento das negociações.",
    youtubeId: "",
    enabled: true,
    requiresPermission: true,
    actions: [
      {
        label: "Acessar",
        icon: "ph-arrow-square-out",
        href: "../protocolo/protocolo.html",
        primary: true,
        targetBlank: false,
      },
    ],
  },
  {
    id: "static-protocol",
    badge: "Gerador de Protocolo",
    image: "../img/Protocolo.png",
    title: "Gerador de Protocolo",
    shortDesc: "Gere e envie protocolos de atendimento em segundos.",
    longDesc: "Chega de anotar número de protocolo no papel ou na memória. Com um clique você gera um protocolo único para usar onde quiser e manter tudo organizado, simples, rápido e sem margem para erro.",
    youtubeId: "qA_WD02eEbM",
    enabled: true,
    requiresPermission: false,
    actions: [
      {
        label: "Acessar",
        icon: "ph-arrow-square-out",
        app: "protocol",
        metric: "access",
        primary: true,
        targetBlank: false,
      },
    ],
  },
  {
    id: "agent",
    badge: "Mentor estratégico de vendas",
    image: "../img/Apolo.png",
    title: "Mentor estratégico de vendas",
    shortDesc:
      "Crie treinamentos 100% personalizados com o Apolo, nosso agente de inteligência artificial treinado para te auxiliar no processo de vendas.",
    longDesc:
      "O Apolo é o seu mentor estratégico de vendas com inteligência artificial. Ele analisa o perfil do cliente, sugere abordagens personalizadas, ajuda a contornar objeções e orienta cada etapa da negociação, tudo em tempo real, direto no navegador. Ideal para consultores que querem vender com mais confiança, consistência e resultado.",
    youtubeId: "KNljC_oggjc",
    enabled: true,
    requiresPermission: false,
    clienteCta: true,
    actions: [
      {
        label: "Acessar",
        icon: "ph-lock",
        app: "agent",
        metric: "access",
        primary: true,
        targetBlank: false,
        locked: true,
      },
    ],
  },
];

// ============================================================
// CATÁLOGO DE PRODUTOS (Soluções de telecom)
// ============================================================

const PRODUCTS = [
  {
    id: "movel",
    icon: "ph-device-mobile",
    badge: "Telefonia Móvel",
    title: "Linhas empresariais com as melhores operadoras do Brasil.",
    tagline: "Linhas novas ou portabilidade sem burocracia",
    description:
      "Trabalhamos com as principais operadoras do país. Você nos conta quantas linhas novas precisa ou quer fazer a portabilidade e qual operadora prefere, nós garantimos a melhor oferta disponível e cuidamos de tudo: contrato, portabilidade, ativação e suporte.",
    benefits: [
      { icon: "ph-buildings", text: "Para empresas de qualquer porte e MEI" },
      {
        icon: "ph-arrows-left-right",
        text: "Linhas novas ou portabilidade sem burocracia",
      },
      {
        icon: "ph-handshake",
        text: "A operadora que você escolher, nós cuidamos de tudo",
      },
    ],
    steps: [
      {
        id: "linhas",
        title: "Quantas linhas você precisa?",
        hint: "Pode ser para você, para a sua equipe, ou para toda a empresa.",
        type: "number",
        placeholder: "Ex: 5",
        min: 1,
        required: true,
      },
      {
        id: "modalidade",
        title: "Como você prefere prosseguir?",
        hint: "A portabilidade mantém o seu número atual.",
        type: "chips",
        required: true,
        options: [
          {
            value: "nova",
            label: "Contratar linha nova",
            icon: "ph-plus-circle",
          },
          {
            value: "portar",
            label: "Portar de outra operadora",
            icon: "ph-arrows-left-right",
          },
        ],
      },
      {
        id: "operadora",
        title: "Qual operadora você prefere?",
        hint: "Sem preferência? Sem problema, apresentaremos as melhores opções disponíveis.",
        type: "text",
        placeholder: "Escreva aqui, ou deixe em branco...",
        required: false,
      },
    ],
    buildMessage(a) {
      const op = a.operadora?.trim() || "sem preferência";
      const mod =
        a.modalidade === "nova" ? "Contratação nova" : "Portabilidade";
      return (
        `Olá! Tenho interesse em *Telefonia Móvel Empresarial*.\n\n` +
        `- *Linhas desejadas:* ${a.linhas}\n` +
        `- *Modalidade:* ${mod}\n` +
        `- *Operadora preferida:* ${op}\n\n` +
        `Poderia me apresentar as melhores opções?`
      );
    },
  },

  {
    id: "internet",
    icon: "ph-wifi-high",
    badge: "Internet Empresarial",
    title: "Internet rápida e estável. Do jeito que a sua empresa precisa.",
    tagline: "Conexão de alta velocidade para o seu negócio",
    description:
      "Sabemos qual tipo de conexão cada negócio precisa. Você nos conta como sua empresa funciona e nós indicamos a solução certa.",
    benefits: [
      {
        icon: "ph-lightning",
        text: "Alta velocidade para o dia a dia do seu negócio",
      },
      {
        icon: "ph-buildings",
        text: "Atende escritórios, lojas e múltiplas unidades",
      },
      { icon: "ph-headset", text: "Atendimento dedicado do início ao fim" },
    ],
    steps: [
      {
        id: "perfil",
        title: "Qual é o perfil do seu negócio?",
        hint: "Isso nos ajuda a indicar a solução mais adequada para a sua realidade.",
        type: "chips",
        required: true,
        options: [
          { value: "escritorio", label: "Escritório", icon: "ph-buildings" },
          { value: "loja", label: "Loja / Comércio", icon: "ph-storefront" },
          { value: "homeoffice", label: "Home Office", icon: "ph-house" },
          {
            value: "multiplas",
            label: "Múltiplas unidades",
            icon: "ph-map-pin",
          },
        ],
      },
      {
        id: "velocidade",
        title: "Qual velocidade aproximada você precisa?",
        hint: "Não sabe? Tudo bem, nosso consultor vai te ajudar a descobrir.",
        type: "chips",
        required: true,
        options: [
          { value: "nao-sei", label: "Não sei ainda" },
          { value: "100mb", label: "Até 100 MB" },
          { value: "300mb", label: "Até 300 MB" },
          { value: "500mb", label: "Até 500 MB" },
          { value: "1gb", label: "1 GB ou mais" },
        ],
      },
    ],
    buildMessage(a) {
      const perfilMap = {
        escritorio: "Escritório",
        loja: "Loja / Comércio",
        homeoffice: "Home Office",
        multiplas: "Múltiplas unidades",
      };
      const velMap = {
        "nao-sei": "Ainda não sei",
        "100mb": "Até 100 MB",
        "300mb": "Até 300 MB",
        "500mb": "Até 500 MB",
        "1gb": "1 GB ou mais",
      };
      return (
        `Olá! Tenho interesse em *Internet Empresarial*.\n\n` +
        `- *Perfil do negócio:* ${perfilMap[a.perfil]}\n` +
        `- *Velocidade desejada:* ${velMap[a.velocidade]}\n\n` +
        `Poderia me apresentar as melhores opções?`
      );
    },
  },

  {
    id: "fixa",
    icon: "ph-phone",
    badge: "Telefonia Fixa",
    title: "Ligue para qualquer lugar do Brasil sem se preocupar com a conta.",
    tagline: "Ligações ilimitadas para todo o Brasil",
    description:
      "Planos de telefonia fixa com ligações ilimitadas para todo o Brasil. Linha nova ou portabilidade (para você não perder o seu número), sem burocracia, sem surpresa no bolso, com suporte dedicado do começo ao fim.",
    benefits: [
      {
        icon: "ph-infinity",
        text: "Ligações ilimitadas para fixo e celular de todo o Brasil",
      },
      {
        icon: "ph-arrows-left-right",
        text: "Linha nova ou portabilidade, sem burocracia",
      },
      { icon: "ph-check-circle", text: "Para empresas de qualquer porte" },
    ],
    steps: [
      {
        id: "situacao",
        title: "Qual é a sua situação atual?",
        hint: "Isso nos ajuda a direcionar o processo de forma correta.",
        type: "chips",
        required: true,
        options: [
          {
            value: "nova",
            label: "Quero uma linha nova",
            icon: "ph-plus-circle",
          },
          {
            value: "migrar",
            label: "Já tenho linha e quero migrar",
            icon: "ph-arrows-left-right",
          },
        ],
      },
      {
        id: "linhas",
        title: "Quantas linhas você precisa?",
        hint: "Informe o número de linhas de telefone fixo desejadas.",
        type: "number",
        placeholder: "Ex: 2",
        min: 1,
        required: true,
      },
    ],
    buildMessage(a) {
      const sit =
        a.situacao === "nova"
          ? "Contratação nova"
          : "Migração de linha existente";
      return (
        `Olá! Tenho interesse em *Telefonia Fixa*.\n\n` +
        `- *Situação:* ${sit}\n` +
        `- *Linhas desejadas:* ${a.linhas}\n\n` +
        `Poderia me apresentar as melhores opções?`
      );
    },
  },
];

// ============================================================
// ESTADO GLOBAL DO MODAL DE PRODUTOS
// ============================================================

let _activeProduct = null;
let _currentStep = 0;
let _answers = {};

// ============================================================
// UTILITÁRIOS COMPARTILHADOS
// ============================================================

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildWhatsAppUrl(message) {
  // Protege a formatação
  const safeMessage = encodeURIComponent(message)
    .replace(/\*/g, '%2A')
    .replace(/_/g, '%5F')
    .replace(/~/g, '%7E');
    
  // TROCAMOS o wa.me pela API oficial, que evita o bug do app Desktop já aberto
  return `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}&text=${safeMessage}`;
}

function normalizeLoginUrl(url) {
  if (!url) return "/login/login.html";
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("/")
  ) {
    return url;
  }
  return "/" + url.replace(/^\.?\//, "");
}

function clearAgentChatSessionStorage() {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("agente_chat_state:"))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignora
  }
}

// ============================================================
// AUTH / API HELPERS
// ============================================================

function clearAuthToken() {}

async function apiFetch(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  let data = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  if (!resp.ok) {
    const msg = data?.error || data?.message || `Erro HTTP ${resp.status}`;
    throw new Error(msg);
  }

  return data;
}

async function getCurrentSession() {
  return apiFetch("/api/me", { method: "GET" });
}

async function getCurrentProfile() {
  return apiFetch("/api/profile", { method: "GET" });
}

async function doLogout() {
  try {
    await apiFetch("/api/logout", { method: "POST" });
  } catch {
    // ignora falha do backend no logout
  } finally {
    clearAuthToken();
    clearAgentChatSessionStorage();
  }
}

async function registrarUsoEIrParaDestino(app, metric = "access", targetBlank = false) {
  const data = await apiFetch("/api/contador", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ app, metric }),
  });

  if (!data?.ok || !data?.target) {
    throw new Error("Não foi possível registrar o uso do aplicativo.");
  }

  if (targetBlank) {
    window.open(data.target, "_blank", "noopener,noreferrer");
  } else {
    window.location.href = data.target;
  }
}

// ============================================================
// TEMA ESCURO / CLARO
// ============================================================

function initTheme(themeToggle) {
  if (!themeToggle) return;

  if (localStorage.getItem("theme") === "light") {
    document.body.classList.remove("dark-mode");
    updateThemeIcon(themeToggle, false);
  } else {
    document.body.classList.add("dark-mode");
    updateThemeIcon(themeToggle, true);
  }

  themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    const isDark = document.body.classList.contains("dark-mode");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    updateThemeIcon(themeToggle, isDark);
  });
}

function updateThemeIcon(btn, isDark) {
  if (!btn) return;
  const icon = btn.querySelector("i");
  if (icon) icon.className = isDark ? "ph ph-sun" : "ph ph-moon";
  btn.setAttribute(
    "aria-label",
    isDark ? "Ativar modo claro" : "Ativar modo escuro",
  );
}

// ============================================================
// EFEITO DA NAVBAR
// ============================================================

function initNavbarEffect() {
  const navbar = document.querySelector(".top-navbar");
  if (!navbar) {
    console.warn("Navbar não encontrada pelo script!");
    return;
  }

  const handleScroll = () => {
    navbar.classList.toggle("scrolled", window.scrollY > 50);
  };

  handleScroll();
  window.addEventListener("scroll", handleScroll, { passive: true });

  let _navMouseFrame;
  document.addEventListener("mousemove", (e) => {
    if (_navMouseFrame) return;
    _navMouseFrame = requestAnimationFrame(() => {
      navbar.classList.toggle("hover-active", e.clientY <= 30);
      _navMouseFrame = null;
    });
  });
}

// ============================================================
// MENU MOBILE
// ============================================================

function initMobileMenu() {
  const btn = document.getElementById("mobile-menu-btn");
  const links =
    document.getElementById("navbar-links") ||
    document.querySelector(".navbar-links");

  if (!btn || !links) return;
  if (btn._mobileMenuInit) return;
  btn._mobileMenuInit = true;

  btn.addEventListener("click", () => {
    const isOpen = links.classList.toggle("active");
    const icon = btn.querySelector("i");
    if (icon) icon.className = isOpen ? "ph ph-x" : "ph ph-list";
    btn.setAttribute("aria-label", isOpen ? "Fechar Menu" : "Abrir Menu");
  });

  links.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      links.classList.remove("active");
      const icon = btn.querySelector("i");
      if (icon) icon.className = "ph ph-list";
      btn.setAttribute("aria-label", "Abrir Menu");
    });
  });
}

// ============================================================
// SCROLL REVEAL
// ============================================================

function initScrollReveal() {
  const prefersReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (prefersReduced) {
    document
      .querySelectorAll(
        "[data-reveal], .about-block, .posvenda-pillar, .product-card, .hub-card",
      )
      .forEach((el) => {
        el.classList.add("is-visible");
      });
    return;
  }

  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );

  document
    .querySelectorAll("[data-reveal]")
    .forEach((el) => revealObserver.observe(el));

  document.querySelectorAll(".about-block").forEach((el, i) => {
    el.style.transitionDelay = `${i * 0.1}s`;
    revealObserver.observe(el);
  });

  document.querySelectorAll(".posvenda-pillar").forEach((el, i) => {
    el.style.transitionDelay = `${i * 0.08}s`;
    revealObserver.observe(el);
  });

  const productsGrid = document.getElementById("products-grid");
  if (productsGrid) {
    const mutObs = new MutationObserver(() => {
      productsGrid
        .querySelectorAll(".product-card:not(.observed)")
        .forEach((el, i) => {
          el.classList.add("observed");
          el.style.transitionDelay = `${i * 0.08}s`;
          revealObserver.observe(el);
        });
    });
    mutObs.observe(productsGrid, { childList: true });
  }

  const hubGrid = document.getElementById("hub-grid");
  if (hubGrid) {
    const hubMutObs = new MutationObserver(() => {
      hubGrid.querySelectorAll(".hub-card:not(.observed)").forEach((el, i) => {
        el.classList.add("observed");
        el.style.transitionDelay = `${i * 0.1}s`;
        revealObserver.observe(el);
      });
    });
    hubMutObs.observe(hubGrid, { childList: true });
  }
}

// ============================================================
// ACTIVE NAV LINK
// ============================================================

function initActiveNavTracking() {
  const sections = document.querySelectorAll("section[id]");
  const navLinks = document.querySelectorAll(".nav-link");
  if (!sections.length || !navLinks.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute("id");
          navLinks.forEach((link) => {
            const href = link.getAttribute("href");
            link.classList.toggle("active", href === `#${id}`);
          });
        }
      });
    },
    { threshold: 0.15, rootMargin: "-100px 0px -50% 0px" },
  );

  sections.forEach((sec) => observer.observe(sec));
}

// ============================================================
// ANIMAÇÃO DE PARTÍCULAS
// ============================================================

function initParticles() {
  let canvas = document.getElementById("global-particles");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "global-particles";
    Object.assign(canvas.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      zIndex: "1",
      pointerEvents: "none",
    });
    document.body.prepend(canvas);
  }

  const ctx = canvas.getContext("2d");
  let particles = [];
  let rafId = null;

  function createSprite(size) {
    const d = Math.ceil((size + 15) * 2);
    const oc = document.createElement("canvas");
    oc.width = oc.height = d;
    const oc2 = oc.getContext("2d");
    const c = d / 2;
    oc2.shadowBlur = 10;
    oc2.shadowColor = "rgba(87,197,234,0.7)";
    oc2.fillStyle = "rgba(87,197,234,0.8)";
    oc2.beginPath();
    oc2.arc(c, c, size, 0, Math.PI * 2);
    oc2.fill();
    return oc;
  }

  const spriteCache = new Map();
  function getSprite(size) {
    const key = Math.round(size * 2) / 2;
    if (!spriteCache.has(key)) spriteCache.set(key, createSprite(key));
    return spriteCache.get(key);
  }

  function setSize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    spriteCache.clear();
  }

  setSize();

  let resizeTimer;
  window.addEventListener(
    "resize",
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        setSize();
        init();
      }, 200);
    },
    { passive: true },
  );

  class Particle {
    constructor() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.size = Math.random() * 2.5 + 1;
      this.speedX = (Math.random() - 0.5) * 0.7;
      this.speedY = (Math.random() - 0.5) * 0.7;
      this.opacity = Math.random() * 0.5 + 0.2;
      this.sprite = getSprite(this.size);
    }
    update() {
      this.x += this.speedX;
      this.y += this.speedY;
      if (this.x < 0 || this.x > canvas.width) this.speedX *= -1;
      if (this.y < 0 || this.y > canvas.height) this.speedY *= -1;
    }
    draw() {
      const half = this.sprite.width / 2;
      ctx.globalAlpha = this.opacity;
      ctx.drawImage(this.sprite, this.x - half, this.y - half);
    }
  }

  function init() {
    particles = [];
    const isMobile = window.innerWidth <= 768;
    const divisor = isMobile ? 18000 : 12000;
    const maxCount = isMobile ? 40 : 100;
    const n = Math.min(
      Math.floor((canvas.width * canvas.height) / divisor),
      maxCount,
    );
    for (let i = 0; i < n; i++) particles.push(new Particle());
  }

  function animate() {
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.update();
      p.draw();
    });
    rafId = requestAnimationFrame(animate);
  }

  const start = () => {
    if (!rafId) rafId = requestAnimationFrame(animate);
  };
  const stop = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  document.addEventListener("visibilitychange", () =>
    document.hidden ? stop() : start(),
  );

  init();
  start();
}

// ============================================================
// MENU DE CONFIGURAÇÕES (Hub)
// ============================================================

function initSettingsMenu(btn, menu) {
  if (!btn || !menu) return;
  if (btn._settingsMenuInit) return;
  btn._settingsMenuInit = true;

  const close = () => {
    menu.hidden = true;
  };
  const toggle = () => {
    menu.hidden ? (menu.hidden = false) : close();
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  document.addEventListener("click", (e) => {
    const container = document.querySelector(".user-menu-container");
    if (!container || !container.contains(e.target)) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

// ============================================================
// SKELETON LOADER (Hub)
// ============================================================

function renderSkeletonCards(count = 3) {
  const grid = document.getElementById("hub-grid");
  if (!grid) return;
  grid.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "hub-card-skeleton";
    grid.appendChild(el);
  }
}

// ============================================================
// RENDERIZAÇÃO DOS CARDS DO HUB
// ============================================================

function renderHubCards({ canAccessProtocol = false } = {}) {
  const grid = document.getElementById("hub-grid");
  if (!grid) return;
  grid.innerHTML = "";

  APPS.filter((app) => !(app.requiresPermission && !canAccessProtocol)).forEach(
    (app) => {
      const card = document.createElement("article");
      card.className = "hub-card" + (app.enabled ? "" : " hub-card-disabled");
      card.setAttribute("data-app-id", app.id);

      if (app.enabled) {
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        card.setAttribute("aria-label", `Abrir detalhes: ${app.title}`);
        const openModal = () => openAppModal(app.id);
        card.addEventListener("click", openModal);
        card.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openModal();
          }
        });
      }

      const imgTag = app.image
        ? `<img src="${escapeHtml(app.image)}" alt="${escapeHtml(app.title || "Aplicação")}" width="340" height="460" loading="lazy">`
        : "";

      card.innerHTML = `
        ${imgTag}
        <div class="hub-card-content">
          <h2 class="hub-card-title">${escapeHtml(app.title || "")}</h2>
          ${app.shortDesc ? `<p class="hub-card-short-desc">${escapeHtml(app.shortDesc)}</p>` : ""}
        </div>
      `;

      grid.appendChild(card);
    },
  );
}

// ============================================================
// FOCUS TRAP ACESSÍVEL (Hub modal)
// ============================================================

const _focusTrapHandlers = new WeakMap();

function createFocusTrap(modal) {
  const FOCUSABLE =
    'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function handler(e) {
    if (e.key !== "Tab") return;
    const els = Array.from(modal.querySelectorAll(FOCUSABLE)).filter(
      (el) => !el.closest("[hidden]"),
    );
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  modal.addEventListener("keydown", handler);
  _focusTrapHandlers.set(modal, handler);
}

function removeFocusTrap(modal) {
  const handler = _focusTrapHandlers.get(modal);
  if (handler) {
    modal.removeEventListener("keydown", handler);
    _focusTrapHandlers.delete(modal);
  }
}

// ============================================================
// MODAL DO HUB (app-modal)
// ============================================================

let _modalListenersInit = false;
let _lastFocusedBeforeModal = null;

function initAppModal() {
  const backdrop = document.getElementById("app-modal-backdrop");
  const modal = document.getElementById("app-modal");
  const closeBtn = document.getElementById("app-modal-close");

  if (!backdrop || !modal || !closeBtn || _modalListenersInit) return;
  _modalListenersInit = true;

  closeBtn.addEventListener("click", closeAppModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAppModal();
  });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeAppModal();
  });
}

function openAppModal(appId) {
  const app = APPS.find((a) => a.id === appId);
  if (!app || !app.enabled) return;

  const backdrop = document.getElementById("app-modal-backdrop");
  const modal = document.getElementById("app-modal");
  const badgeEl = document.getElementById("app-modal-badge");
  const titleEl = document.getElementById("app-modal-title");
  const descEl = document.getElementById("app-modal-desc");
  const actionsEl = document.getElementById("app-modal-actions");
  const videoEl = document.getElementById("app-modal-video");

  if (!backdrop || !modal) return;

  _lastFocusedBeforeModal = document.activeElement;

  if (badgeEl) badgeEl.textContent = app.badge || "";
  if (titleEl) titleEl.textContent = app.title || "";
  if (descEl) descEl.textContent = app.longDesc || "";

  if (actionsEl) {
    actionsEl.innerHTML = "";

    (app.actions || []).forEach((a) => {
      const el = document.createElement("button");
      el.type = "button";

      if (a.locked) {
        el.className = "hub-btn hub-btn-locked";
        el.disabled = true;
        el.title = "Em breve";
        el.innerHTML = `
          <i class="ph ph-lock"></i>
          <span>${escapeHtml(a.label || "Abrir")}</span>
          <span class="hub-btn-locked-badge">Em breve</span>
        `;
      } else {
        el.className = "hub-btn" + (a.primary ? " hub-btn-primary" : "");
        el.innerHTML = `
          <i class="ph ${escapeHtml(a.icon || "ph-arrow-square-out")}"></i>
          <span>${escapeHtml(a.label || "Abrir")}</span>
        `;

        el.addEventListener("click", async () => {
          try {
            if (a.app) {
              await registrarUsoEIrParaDestino(
                a.app,
                a.metric || "access",
                !!a.targetBlank
              );
            } else if (a.href) {
              if (a.targetBlank) {
                window.open(a.href, "_blank", "noopener,noreferrer");
              } else {
                window.location.href = a.href;
              }
            }
          } catch (err) {
            console.error("Erro ao registrar uso do app:", err);
            alert("Não foi possível abrir a aplicação agora.");
          }
        });
      }

      actionsEl.appendChild(el);
    });

    if (app.clienteCta) {
      const ctaBtn = document.createElement("button");
      ctaBtn.type = "button";
      ctaBtn.className = "hub-btn hub-btn-cta";
      ctaBtn.innerHTML = `<i class="ph ph-handshake"></i><span>Quero ser cliente</span>`;
      ctaBtn.addEventListener("click", () => {
        closeAppModal();
        requestAnimationFrame(() => {
          document.getElementById("produtos")?.scrollIntoView({ behavior: "smooth" });
        });
      });
      actionsEl.insertBefore(ctaBtn, actionsEl.firstChild);
    }
  }

  if (videoEl) {
    videoEl.innerHTML = "";
    if (app.youtubeId) {
      const iframe = document.createElement("iframe");
      iframe.allow =
        "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      iframe.loading = "lazy";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(app.youtubeId)}`;
      videoEl.appendChild(iframe);
    } else {
      const div = document.createElement("div");
      div.style.cssText = "padding:14px;opacity:.85";
      div.textContent = "Vídeo de apresentação não disponível.";
      videoEl.appendChild(div);
    }
  }

  backdrop.hidden = false;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";

  requestAnimationFrame(() =>
    requestAnimationFrame(() => modal.classList.add("is-open")),
  );

  createFocusTrap(modal);
  modal.setAttribute("tabindex", "-1");
  modal.focus();
}

function closeAppModal() {
  const backdrop = document.getElementById("app-modal-backdrop");
  const modal = document.getElementById("app-modal");
  const videoEl = document.getElementById("app-modal-video");

  if (videoEl) videoEl.innerHTML = "";

  if (modal) {
    removeFocusTrap(modal);
    modal.classList.remove("is-open");

    const hideAll = () => {
      modal.hidden = true;
      if (backdrop) backdrop.hidden = true;
    };

    const onTransitionEnd = (e) => {
      if (e.propertyName !== "opacity") return;
      modal.removeEventListener("transitionend", onTransitionEnd);
      clearTimeout(fallbackTimer);
      hideAll();
    };

    const fallbackTimer = setTimeout(() => {
      modal.removeEventListener("transitionend", onTransitionEnd);
      hideAll();
    }, 300);

    modal.addEventListener("transitionend", onTransitionEnd);
  }

  document.body.classList.remove("modal-open");
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";

  if (_lastFocusedBeforeModal) {
    _lastFocusedBeforeModal.focus();
    _lastFocusedBeforeModal = null;
  }
}

// ============================================================
// DEPOIMENTOS
// ============================================================

async function carregarAvaliacoes() {
  const track1 = document.getElementById("testimonials-track-1");
  const track2 = document.getElementById("testimonials-track-2");

  if (track1) {
    track1.innerHTML =
      '<div style="padding:20px;color:var(--text-primary);opacity:.6;font-weight:500">Buscando avaliações...</div>';
  }
  if (track2) {
    track2.innerHTML =
      '<div style="padding:20px;color:var(--text-primary);opacity:.6;font-weight:500">Buscando avaliações...</div>';
  }

  try {
    const data = await fetch("/api/avaliacoes", { cache: "no-store", credentials: "include" });
    const json = await data.json().catch(() => null);

    if (!data.ok || !json?.ok || !Array.isArray(json.avaliacoes)) {
      throw new Error("Resposta inválida de avaliações");
    }

    const avaliacoes = json.avaliacoes;

    if (avaliacoes.length > 0) {
      const shuffled = [...avaliacoes].sort(() => 0.5 - Math.random());

      const avaliacoesBloco1 = shuffled.slice(0, 15);
      const avaliacoesBloco2 = shuffled.slice(15, 30);

      if (track1 && avaliacoesBloco1.length > 0) {
        renderTestimonials(avaliacoesBloco1, track1);
      } else if (track1) {
        track1.closest(".hub-testimonials-section").style.display = "none";
      }

      if (track2 && avaliacoesBloco2.length > 0) {
        renderTestimonials(avaliacoesBloco2, track2);
      } else if (track2) {
        track2.closest(".hub-testimonials-section").style.display = "none";
      }
    } else {
      document
        .querySelectorAll(".hub-testimonials-section")
        .forEach((sec) => (sec.style.display = "none"));
    }
  } catch (e) {
    console.error("Falha na conexão com avaliações:", e);
    document
      .querySelectorAll(".hub-testimonials-section")
      .forEach((sec) => (sec.style.display = "none"));
  }
}

function renderTestimonials(avaliacoes, trackElement) {
  if (!trackElement) return;

  const allItems = [...avaliacoes, ...avaliacoes];

  trackElement.innerHTML = allItems
    .map((t) => {
      const cor1 = t.cor1 || "#00d4ff";
      const cor2 = t.cor2 || "#0066ff";
      return `
      <div class="testimonial-card">
        <div class="stars">★★★★★</div>
        <p class="testimonial-text">"${escapeHtml(t.TextoComentario)}"</p>
        <div class="testimonial-author">
          <div class="author-avatar" style="background:linear-gradient(135deg,${cor1},${cor2})">${escapeHtml(t.Iniciais)}</div>
          <div>
            <div class="author-name">${escapeHtml(t.Nome)}</div>
            <div class="author-role">${escapeHtml(t.Cargo)}</div>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  // Fix Bug #5: double RAF garante que o iOS Safari terminou de calcular
  // o layout (width: max-content) antes de iniciar a animação CSS.
  // Um único RAF às vezes dispara antes do reflow, fazendo o translateX(-50%)
  // ser calculado com largura errada e o loop não fechar.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => trackElement.classList.add("iniciada"))
  );

  const container = trackElement.closest(".testimonials-container");
  iniciarCarrosselInterativo(container, trackElement);
}

function iniciarCarrosselInterativo(container, track) {
  if (!container || !track) return;

  // Remove a animação do CSS para que o JavaScript assuma o controle total
  track.classList.remove("iniciada");
  track.style.animation = "none";
  track.style.webkitAnimation = "none";

  let isDragging = false;
  let isHovered = false;
  let startX;
  let currentTx = 0;
  
  // Velocidade do carrossel automático (ajuste se quiser mais rápido ou devagar)
  const speed = 1.2;

  // Calcula a metade da largura para fazer o loop infinito (o conteúdo já é duplicado)
  let halfWidth = track.scrollWidth / 2;
  window.addEventListener("resize", () => {
    halfWidth = track.scrollWidth / 2;
  });

  // Loop de animação de alta performance
  function animate() {
    // Só rola automaticamente se o mouse não estiver em cima e não estiver arrastando
    if (!isDragging && !isHovered) {
      currentTx -= speed;
    }

    // Regra do Loop Infinito:
    // Se rolou até a metade (fim do primeiro bloco), reseta a posição discretamente.
    if (currentTx <= -halfWidth) {
      currentTx += halfWidth;
    } else if (currentTx > 0) { // Se arrastar para trás (direita)
      currentTx -= halfWidth;
    }

    track.style.transform = `translateX(${currentTx}px)`;
    track.style.webkitTransform = `translateX(${currentTx}px)`;

    requestAnimationFrame(animate);
  }

  // Inicia a animação
  requestAnimationFrame(animate);

  // ── Eventos de Mouse ──────────────────────────────────────────
  container.addEventListener("mouseenter", () => {
    isHovered = true;
    container.classList.add("grab");
  });
  
  container.addEventListener("mouseleave", () => {
    isHovered = false;
    isDragging = false;
    container.classList.remove("grabbing", "grab");
  });
  
  container.addEventListener("mousedown", (e) => {
    isDragging = true;
    container.classList.replace("grab", "grabbing");
    startX = e.pageX;
  });
  
  container.addEventListener("mouseup", () => {
    isDragging = false;
    container.classList.replace("grabbing", "grab");
  });
  
  container.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const dx = e.pageX - startX;
    startX = e.pageX; // Atualiza o ponto inicial para o próximo frame
    currentTx += dx * 1.5; // Multiplicador para a sensação de arraste
  });

  // ── Eventos de Toque (Mobile) ─────────────────────────────────
  let startY;
  let gestureDecided = false;

  container.addEventListener("touchstart", (e) => {
    isDragging = true;
    gestureDecided = false;
    startX = e.touches[0].pageX;
    startY = e.touches[0].pageY;
  }, { passive: true });

  container.addEventListener("touchend", () => {
    isDragging = false;
    gestureDecided = false;
  }, { passive: true });

  container.addEventListener("touchmove", (e) => {
    if (!isDragging) return;
    const dx = e.touches[0].pageX - startX;
    const dy = e.touches[0].pageY - startY;

    if (!gestureDecided) {
      // Se o movimento for mais vertical do que horizontal, o usuário quer rolar a página
      if (Math.abs(dx) < Math.abs(dy)) {
        isDragging = false;
        return;
      }
      gestureDecided = true;
    }

    e.preventDefault(); // Impede o scroll da página enquanto arrasta o carrossel
    startX = e.touches[0].pageX;
    currentTx += dx * 1.5;
  }, { passive: false });
}
// ============================================================
// CARDS DE PRODUTO
// ============================================================

function renderProductCards() {
  const grid = document.getElementById("products-grid");
  if (!grid) return;

  grid.innerHTML = PRODUCTS.map(
    (p) => `
    <article
      class="product-card"
      role="listitem"
      tabindex="0"
      data-product-id="${escapeHtml(p.id)}"
      aria-label="Saiba mais sobre ${escapeHtml(p.title)}">

      <div class="product-card-icon">
        <i class="ph ${escapeHtml(p.icon)}"></i>
      </div>

      <span class="product-card-badge">${escapeHtml(p.badge)}</span>
      <h3 class="product-card-title">${escapeHtml(p.title)}</h3>
      <p class="product-card-desc">${escapeHtml(p.description)}</p>

      <div class="product-card-divider"></div>

      <ul class="product-card-benefits" aria-label="Benefícios">
        ${p.benefits
          .map(
            (b) => `
          <li>
            <i class="ph ${escapeHtml(b.icon)}" aria-hidden="true"></i>
            ${escapeHtml(b.text)}
          </li>
        `,
          )
          .join("")}
      </ul>

      <button type="button" class="product-card-cta" data-product-id="${escapeHtml(p.id)}">
        Contratar <i class="ph ph-arrow-up-right" aria-hidden="true"></i>
      </button>
    </article>
  `,
  ).join("");

  grid.querySelectorAll("[data-product-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const product = PRODUCTS.find((p) => p.id === el.dataset.productId);
      if (product) openProductModal(product);
    });
    if (el.tagName === "ARTICLE") {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          el.click();
        }
      });
    }
  });
}

// ============================================================
// MODAL DE PRODUTO — ABRIR / FECHAR
// ============================================================

function openProductModal(product) {
  _activeProduct = product;
  _currentStep = 0;
  _answers = {};

  const backdrop = document.getElementById("prod-modal-backdrop");
  const modal = document.getElementById("prod-modal");

  backdrop.hidden = false;
  modal.hidden = false;

  requestAnimationFrame(() =>
    requestAnimationFrame(() => modal.classList.add("is-open")),
  );

  document.body.classList.add("modal-open");
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  renderProductStep();

  document.addEventListener("keydown", _onProdEscKey);
  document.addEventListener("keydown", _onProdFocusTrap);
  backdrop.addEventListener("click", _onProdBackdropClick);
}

function closeProductModal() {
  const backdrop = document.getElementById("prod-modal-backdrop");
  const modal = document.getElementById("prod-modal");

  modal.classList.remove("is-open");
  document.body.classList.remove("modal-open");
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";

  setTimeout(() => {
    backdrop.hidden = true;
    modal.hidden = true;
    modal.innerHTML = "";
  }, 280);

  document.removeEventListener("keydown", _onProdEscKey);
  document.removeEventListener("keydown", _onProdFocusTrap);
  backdrop.removeEventListener("click", _onProdBackdropClick);
}

function _onProdEscKey(e) {
  if (e.key === "Escape") closeProductModal();
}
function _onProdBackdropClick(e) {
  if (e.target === e.currentTarget) closeProductModal();
}

function _onProdFocusTrap(e) {
  if (e.key !== "Tab") return;
  const modal = document.getElementById("prod-modal");
  if (!modal) return;
  const focusable = Array.from(
    modal.querySelectorAll(
      'button:not([disabled]), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.closest("[hidden]"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

// ============================================================
// MODAL DE PRODUTO — RENDERIZAR PASSO ATUAL
// ============================================================

function renderProductStep() {
  const product = _activeProduct;
  const stepIndex = _currentStep;
  const totalSteps = product.steps.length;
  const isReview = stepIndex === totalSteps;
  const modal = document.getElementById("prod-modal");

  const header = `
    <div class="prod-modal-header">
      <div class="prod-modal-meta">
        <span class="app-modal-badge">${escapeHtml(product.badge)}</span>
      </div>
      <button type="button" class="app-modal-close" id="prod-modal-close" aria-label="Fechar">
        <i class="ph ph-x" aria-hidden="true"></i>
      </button>
    </div>
  `;

  const dots = product.steps
    .map((_, i) => {
      const done = isReview || i < stepIndex;
      const active = !isReview && i === stepIndex;
      const inner = done
        ? '<i class="ph ph-check" aria-hidden="true"></i>'
        : i + 1;
      const line =
        i < totalSteps - 1
          ? `<div class="step-line ${done ? "done" : ""}" aria-hidden="true"></div>`
          : "";
      return `<div class="step-dot ${done ? "done" : active ? "active" : ""}" aria-hidden="true">${inner}</div>${line}`;
    })
    .join("");

  const indicator = `
    <div class="step-indicator" aria-label="Passo ${Math.min(stepIndex + 1, totalSteps)} de ${totalSteps}">
      ${dots}
    </div>
  `;

  const body = isReview
    ? buildProductReviewHTML(product)
    : buildProductStepHTML(product.steps[stepIndex]);

  const navBack =
    stepIndex > 0 || isReview
      ? `<button type="button" class="hub-btn" id="btn-back"><i class="ph ph-arrow-left" aria-hidden="true"></i> Voltar</button>`
      : `<div></div>`;

  const navNext = isReview
    ? ""
    : `<button type="button" class="hub-btn hub-btn-primary" id="btn-next">
         ${stepIndex === totalSteps - 1 ? "Revisar" : "Próximo"}
         <i class="ph ph-arrow-right" aria-hidden="true"></i>
       </button>`;

  modal.innerHTML = `
    ${header}
    <div class="prod-modal-body">
      ${indicator}
      <div class="step-content" id="step-content">${body}</div>
      <div class="prod-modal-nav" id="prod-modal-nav">${navBack}${navNext}</div>
    </div>
  `;

  bindProductModalEvents(product, stepIndex, isReview);

  const first = modal.querySelector("button:not([disabled]), input, select");
  if (first) first.focus();
}

function buildProductStepHTML(step) {
  let inputHtml = "";
  const val = _answers[step.id] ?? "";

  if (step.type === "number") {
    inputHtml = `
      <input type="number" id="step-input" class="step-number-input"
        value="${escapeHtml(String(val))}"
        placeholder="${escapeHtml(step.placeholder ?? "")}"
        min="${step.min ?? 1}"
        aria-label="${escapeHtml(step.title)}" />
    `;
  } else if (step.type === "text") {
    inputHtml = `
      <input type="text" id="step-input" class="step-text-input"
        value="${escapeHtml(String(val))}"
        placeholder="${escapeHtml(step.placeholder ?? "")}"
        aria-label="${escapeHtml(step.title)}"
        maxlength="120" />
    `;
  } else if (step.type === "chips") {
    const selected = _answers[step.id] ?? "";
    inputHtml = `
      <div class="step-chips" role="group" aria-label="${escapeHtml(step.title)}">
        ${step.options
          .map(
            (opt) => `
          <button type="button" class="step-chip ${selected === opt.value ? "selected" : ""}"
            data-value="${escapeHtml(opt.value)}"
            aria-pressed="${selected === opt.value}">
            ${opt.icon ? `<i class="ph ${escapeHtml(opt.icon)}" aria-hidden="true"></i>` : ""}
            ${escapeHtml(opt.label)}
          </button>
        `,
          )
          .join("")}
      </div>
    `;
  }

  return `
    <h3 class="step-question">${escapeHtml(step.title)}</h3>
    ${step.hint ? `<p class="step-hint">${escapeHtml(step.hint)}</p>` : ""}
    ${inputHtml}
    <p class="step-error" id="step-error" role="alert">Por favor, preencha este campo para continuar.</p>
  `;
}

function buildProductReviewHTML(product) {
  const rows = product.steps
    .map((step) => {
      const rawVal = _answers[step.id];
      let displayVal = "";

      if (step.type === "chips") {
        const opt = step.options.find((o) => o.value === rawVal);
        displayVal = opt ? opt.label : "—";
      } else {
        displayVal =
          rawVal?.toString().trim() ||
          (step.required ? "—" : "Sem preferência");
      }

      const icons = {
        number: "ph-hash",
        chips: "ph-check-square",
        text: "ph-pencil-simple",
      };
      return `
      <div class="summary-row">
        <i class="ph ${icons[step.type] ?? "ph-info"}" aria-hidden="true"></i>
        <div class="summary-row-content">
          <span class="summary-label">${escapeHtml(step.title)}</span>
          <span class="summary-value">${escapeHtml(displayVal)}</span>
        </div>
      </div>
    `;
    })
    .join("");

  const p = _currentUserProfile;
  const profileLines = [];
  if (p?.name) profileLines.push(`- *Nome:* ${p.name}`);
  if (p?.whatsapp) profileLines.push(`- *Telefone:* ${p.whatsapp}`);
  if (p?.operator) profileLines.push(`- *Operadora atual:* ${p.operator}`);
  if (p?.active_lines != null) profileLines.push(`- *Chips ativos:* ${p.active_lines}`);
  if (p?.cidade || p?.estado) profileLines.push(`- *Localização:* ${[p.cidade, p.estado].filter(Boolean).join(" - ")}`);
  const profileSuffix = profileLines.length
    ? `\n\n_Dados do solicitante:_\n${profileLines.join("\n")}`
    : "";

  const rawMessage = product.buildMessage(_answers) + profileSuffix;
  const waUrl = buildWhatsAppUrl(rawMessage);

  return `
    <h3 class="step-question">Tudo certo! Confirme o seu pedido.</h3>
    <p class="step-hint">Revise as informações abaixo. Um consultor vai receber esses dados e entrará em contato para apresentar as melhores opções.</p>
    <div class="summary-card">
      <p class="summary-title">Resumo da solicitação</p>
      ${rows}
    </div>
    <a href="${waUrl}" target="_blank" rel="noopener noreferrer"
      class="whatsapp-btn-modal" id="btn-whatsapp">
      <i class="ph ph-whatsapp-logo" aria-hidden="true"></i>
      Falar com um consultor
    </a>
    <p class="modal-footer-note">
      Você será redirecionado para o WhatsApp para falar com um consultor.
    </p>
  `;
}

function bindProductModalEvents(product, stepIndex, isReview) {
  document
    .getElementById("prod-modal-close")
    ?.addEventListener("click", closeProductModal);

  document.getElementById("btn-back")?.addEventListener("click", () => {
    _currentStep = isReview ? product.steps.length - 1 : stepIndex - 1;
    renderProductStep();
  });

  document.getElementById("btn-next")?.addEventListener("click", () => {
    handleProductNext(product, stepIndex);
  });

  if (isReview) {
    const saveLead = () => {
      const dados = {};
      product.steps.forEach((s) => {
        dados[s.id] = _answers[s.id] ?? null;
      });

      fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: _currentUserProfile?.name ?? "",
          cpf: _currentUserProfile?.cpf ?? "",
          whatsapp: _currentUserProfile?.whatsapp ?? "",
          servico: product.id,
          dados,
        }),
      }).catch(() => {});
    };

    document.getElementById("btn-whatsapp")?.addEventListener("click", saveLead);
  }

  const input = document.getElementById("step-input");
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleProductNext(product, stepIndex);
    });
  }

  const modal = document.getElementById("prod-modal");

  modal?.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter") return;
      const tag = document.activeElement?.tagName;
      const id = document.activeElement?.id;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (id === "btn-back" || id === "btn-close") return;
      e.preventDefault();
      if (!isReview) handleProductNext(product, stepIndex);
    },
    { capture: true },
  );

  const _chips = modal ? Array.from(modal.querySelectorAll(".step-chip")) : [];
  _chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      _chips.forEach((c) => {
        c.classList.remove("selected");
        c.setAttribute("aria-pressed", "false");
      });
      chip.classList.add("selected");
      chip.setAttribute("aria-pressed", "true");
      _answers[product.steps[stepIndex].id] = chip.dataset.value;
      document.getElementById("step-error")?.classList.remove("visible");
    });
  });
}

function handleProductNext(product, stepIndex) {
  const step = product.steps[stepIndex];
  const errEl = document.getElementById("step-error");
  const input = document.getElementById("step-input");

  if (input) _answers[step.id] = input.value;

  if (step.required) {
    const val = (_answers[step.id] ?? "").toString().trim();
    if (!val) {
      errEl?.classList.add("visible");
      input?.focus();
      return;
    }
    if (step.type === "number") {
      const num = parseInt(val, 10);
      if (isNaN(num) || num < (step.min ?? 1)) {
        if (errEl) errEl.textContent = `O valor mínimo é ${step.min ?? 1}.`;
        errEl?.classList.add("visible");
        input?.focus();
        return;
      }
    }
  }

  errEl?.classList.remove("visible");
  _currentStep = stepIndex + 1;
  renderProductStep();
}

// ============================================================
// CTA GERAL
// ============================================================

function initCtaGeral() {
  const waUrl = buildWhatsAppUrl(
    "Olá! Acessei o site da AvanceVip e queria tirar algumas dúvidas. Podem me ajudar?",
  );

  const ids = [
    "cta-whatsapp-geral",
    "mid-cta-whatsapp",
    "posvenda-whatsapp",
    "floating-whatsapp",
  ];

  ids.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.href = waUrl;
  });
}

// ============================================================
// CONFIG PÚBLICA (LOGIN_URL)
// ============================================================

async function loadPublicAgentConfig() {
  try {
    const r = await fetch("/api/public-agent-config", { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok && j.loginUrl) LOGIN_URL = j.loginUrl;
  } catch (e) {
    console.warn("Falha ao carregar /api/public-agent-config:", e);
  }
}

// ============================================================
// UI DE AUTENTICAÇÃO
// ============================================================

function applyAuthenticatedState(user, profile) {
  const email = user?.email || "";
  const canAccessProtocol =
    !!user?.protocol || !!profile?.protocol;

  CURRENT_USER_ID = user?.id || "";

  _currentUserProfile = {
    name: profile?.nome ?? profile?.name ?? "",
    cpf: profile?.cpf_cnpj ?? profile?.cpf ?? "",
    whatsapp: profile?.whatsapp ?? "",
    operator: profile?.operador ?? profile?.operator ?? "",
    active_lines: profile?.active_lines ?? null,
    cidade: profile?.regiao?.cidade ?? "",
    estado: profile?.regiao?.estado ?? "",
  };

  const menuUsers = document.getElementById("menu-users");
  if (menuUsers) menuUsers.hidden = !canAccessProtocol;

  const userEmailEl = document.getElementById("user-email");
  if (userEmailEl) {
    userEmailEl.textContent = email;
    userEmailEl.title = email;
    userEmailEl.style.cursor = "default";
  }

  const loginBtnVisitor = document.getElementById("login-btn-visitor");
  if (loginBtnVisitor) loginBtnVisitor.style.display = "none";

  const userMenuContainer = document.getElementById("user-menu-container");
  if (userMenuContainer) userMenuContainer.hidden = false;

  initSettingsMenu(
    document.getElementById("settings-btn"),
    document.getElementById("settings-menu"),
  );

  const menuLogout = document.getElementById("menu-logout");
  if (menuLogout && !menuLogout._logoutBound) {
    menuLogout._logoutBound = true;
    menuLogout.addEventListener("click", async () => {
      await doLogout();
      window.location.href = normalizeLoginUrl(LOGIN_URL);
    });
  }

  initAppModal();
  renderHubCards({ canAccessProtocol });
}

function applyVisitorState() {
  CURRENT_USER_ID = "";
  _currentUserProfile = null;

  const menuUsers = document.getElementById("menu-users");
  if (menuUsers) menuUsers.hidden = true;

  const userMenuContainer = document.getElementById("user-menu-container");
  if (userMenuContainer) userMenuContainer.hidden = true;

  const loginBtnVisitor = document.getElementById("login-btn-visitor");
  if (loginBtnVisitor) {
    loginBtnVisitor.style.display = "";
    loginBtnVisitor.href = normalizeLoginUrl(LOGIN_URL);
  }

  renderHubCards({ canAccessProtocol: false });
  initAppModal();
}

// ============================================================
// AVALIAÇÕES DO RODAPÉ (Estrelas e Envio)
// ============================================================
function initFooterRating() {
  const container = document.getElementById("footer-stars");
  const label = document.getElementById("footer-rating-label");
  
  if (!container || !label) {
    console.warn("Aviso: Elementos de avaliação não encontrados na tela.");
    return;
  }

  const stars = container.querySelectorAll(".star-btn");
  let current = 5; // Começa com 5 estrelas

  // Função que pinta as estrelas
  function render(val) {
    stars.forEach((btn) => {
      const v = parseInt(btn.dataset.value, 10);
      if (v <= val) {
        btn.classList.add("star-active");
      } else {
        btn.classList.remove("star-active");
      }
    });
    label.textContent = val === 0 ? "Sem avaliação" : val + " de 5";
  }

  // Evento de clique para fixar a nota
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".star-btn");
    if (!btn) return;
    const val = parseInt(btn.dataset.value, 10);
    current = current === val ? 0 : val;
    render(current);
  });

  // Hover visual gerenciado por CSS puro (sem conflito com render)

  // Renderiza o estado inicial (5 estrelas)
  render(current);

  // --- LÓGICA DE ENVIO ---
  const submitBtn = document.getElementById("btn-submit-rating");
  const commentInput = document.getElementById("footer-comment");

  if (submitBtn && commentInput) {
    submitBtn.addEventListener("click", async () => {
      const comentario = commentInput.value.trim();
      const nota = current;

      if (nota === 0) {
        alert("Por favor, selecione uma nota de 1 a 5 estrelas antes de enviar.");
        return;
      }else if(commentInput.value.trim() === ""){
        alert("Por favor, preencha o campo de comentário antes de enviar.")
        return;
      }

      // Utiliza o ID da sessão que já existe no seu script.js
      const cliente_id = typeof CURRENT_USER_ID !== 'undefined' ? CURRENT_USER_ID : null; 

      if (!cliente_id) {
        alert("Sessão inválida. Por favor, faça login novamente.");
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = "Enviando... <i class='ph ph-spinner ph-spin' style='animation: spin 1s linear infinite;'></i>";

      try {
        const res = await fetch("/api/avaliacoes/nova", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cliente_id: cliente_id,
            nota: nota,
            comentario: comentario
          })
        });

        if (res.ok) {
          alert("Avaliação enviada com sucesso! Obrigado pelo feedback.");
          commentInput.value = "";
          current = 5; 
          render(current);
        } else {
          alert("Erro ao enviar avaliação. Tente novamente.");
        }
      } catch (err) {
        console.error("Erro no envio da avaliação:", err);
        alert("Erro na conexão com o servidor. Tente novamente mais tarde.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Enviar Avaliação";
      }
    });
  }
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  initNavbarEffect();
  initParticles();
  initTheme(document.getElementById("theme-toggle"));
  initMobileMenu();
  initScrollReveal();
  initActiveNavTracking();
  initFooterRating();

  const _navLinks = document.querySelectorAll(".nav-link");
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      const target = document.querySelector(this.getAttribute("href"));
      if (!target) return;
      e.preventDefault();

      const clickedHref = this.getAttribute("href");
      _navLinks.forEach((link) => {
        link.classList.toggle(
          "active",
          link.getAttribute("href") === clickedHref,
        );
      });

      target.scrollIntoView({ behavior: "smooth" });
    });
  });

  renderSkeletonCards();
  renderProductCards();
  initCtaGeral();

  await loadPublicAgentConfig();

  try {
   
    const sessionData = await getCurrentSession();

    if (!sessionData?.ok || !sessionData?.user) {
      window.location.href = normalizeLoginUrl(LOGIN_URL);
      return;
    }

    const profileData = await getCurrentProfile().catch((err) => {
      console.warn("Falha ao carregar perfil:", err);
      return { ok: false, user: null };
    });

    applyAuthenticatedState(
      sessionData.user,
      profileData?.user || {}
    );

    await carregarAvaliacoes();
  } catch (e) {
    console.error("Erro ao inicializar página:", e);
    clearAuthToken();
    clearAgentChatSessionStorage();
    window.location.href = normalizeLoginUrl(LOGIN_URL);
  }
});

const backToTopBtn = document.getElementById("back-to-top");

if (backToTopBtn) {
  const toggleBackToTop = () => {
    if (window.scrollY > 250) {
      backToTopBtn.classList.add("show");
    } else {
      backToTopBtn.classList.remove("show");
    }
  };

  window.addEventListener("scroll", toggleBackToTop);

  backToTopBtn.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  });

  toggleBackToTop();
}