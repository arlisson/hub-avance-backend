/**
 * produtos.js — AVANCE | Página de Produtos
 *
 * Responsabilidades:
 * - Renderizar os cards de produto
 * - Controlar o modal multi-step consultivo
 * - Gerar mensagem WhatsApp com o contexto da solicitação
 * - Tema escuro/claro, partículas, navbar e menu mobile
 *
 * CONFIGURAÇÃO: altere apenas as constantes na seção "CONFIG" abaixo.
 */

/* ==========================================================
   CONFIG — Ajuste aqui sem precisar mexer no resto do código
   ========================================================== */

/** Número do WhatsApp do consultor (com DDI, sem espaços ou símbolos). */
const WHATSAPP_NUMBER = '5511999999999'; // ← Substitua pelo número real

/* ==========================================================
   CATÁLOGO DE PRODUTOS
   Cada produto define seus passos (steps) e uma função
   buildMessage() que monta a mensagem pré-preenchida
   para o WhatsApp a partir das respostas do cliente.
   ========================================================== */
const PRODUCTS = [
  {
    id: 'movel',
    icon: 'ph-device-mobile',
    badge: 'Telefonia Móvel',
    title: 'Telefonia Móvel Empresarial',
    tagline: 'Planos corporativos para empresas e MEI',
    description:
      'Gerencie a conectividade da sua equipe com planos que crescem junto ao seu negócio. Você indica a operadora de preferência — nós cuidamos de toda a negociação.',
    benefits: [
      { icon: 'ph-users', text: 'Planos para empresas e MEI' },
      { icon: 'ph-arrows-left-right', text: 'Linha nova ou portabilidade' },
      { icon: 'ph-handshake', text: 'A operadora que você preferir' },
    ],
    steps: [
      {
        id: 'linhas',
        title: 'Quantas linhas você precisa?',
        hint: 'Pode ser para você, para a sua equipe, ou para toda a empresa.',
        type: 'number',
        placeholder: 'Ex: 5',
        min: 1,
        required: true,
      },
      {
        id: 'modalidade',
        title: 'Como você prefere prosseguir?',
        hint: 'A portabilidade mantém o seu número atual.',
        type: 'chips',
        required: true,
        options: [
          { value: 'nova',   label: 'Contratar linha nova',           icon: 'ph-plus-circle' },
          { value: 'portar', label: 'Portar de outra operadora',       icon: 'ph-arrows-left-right' },
        ],
      },
      {
        id: 'operadora',
        title: 'Qual operadora você prefere?',
        hint: 'Sem preferência? Sem problema — apresentaremos as melhores opções disponíveis.',
        type: 'text',
        placeholder: 'Escreva aqui, ou deixe em branco...',
        required: false,
      },
    ],
    buildMessage(a) {
      const op  = a.operadora?.trim() || 'sem preferência';
      const mod = a.modalidade === 'nova' ? 'Contratação nova' : 'Portabilidade';
      return (
        `Olá! Tenho interesse em *Telefonia Móvel Empresarial*.\n\n` +
        `📱 *Linhas desejadas:* ${a.linhas}\n` +
        `🔄 *Modalidade:* ${mod}\n` +
        `📶 *Operadora preferida:* ${op}\n\n` +
        `Poderia me apresentar as melhores opções?`
      );
    },
  },

  {
    id: 'internet',
    icon: 'ph-wifi-high',
    badge: 'Internet',
    title: 'Internet Empresarial',
    tagline: 'Conexão de alta velocidade para o seu negócio',
    description:
      'Conexão estável e veloz pensada para o ambiente corporativo. Você indica o perfil da sua operação e nós encontramos a melhor solução, sem precisar entender de tecnologia.',
    benefits: [
      { icon: 'ph-lightning', text: 'Alta velocidade e estabilidade' },
      { icon: 'ph-buildings', text: 'Ideal para qualquer porte de empresa' },
      { icon: 'ph-headset', text: 'Suporte e atendimento dedicados' },
    ],
    steps: [
      {
        id: 'perfil',
        title: 'Qual é o perfil do seu negócio?',
        hint: 'Isso nos ajuda a indicar a solução mais adequada para a sua realidade.',
        type: 'chips',
        required: true,
        options: [
          { value: 'escritorio',  label: 'Escritório',         icon: 'ph-buildings' },
          { value: 'loja',        label: 'Loja / Comércio',    icon: 'ph-storefront' },
          { value: 'homeoffice',  label: 'Home Office',         icon: 'ph-house' },
          { value: 'multiplas',   label: 'Múltiplas unidades',  icon: 'ph-map-pin' },
        ],
      },
      {
        id: 'velocidade',
        title: 'Qual velocidade aproximada você precisa?',
        hint: 'Não sabe? Tudo bem — nosso consultor vai ajudar a descobrir.',
        type: 'chips',
        required: true,
        options: [
          { value: 'nao-sei', label: 'Não sei ainda' },
          { value: '100mb',   label: 'Até 100 MB' },
          { value: '300mb',   label: 'Até 300 MB' },
          { value: '500mb',   label: 'Até 500 MB' },
          { value: '1gb',     label: '1 GB ou mais' },
        ],
      },
    ],
    buildMessage(a) {
      const perfilMap = {
        escritorio: 'Escritório',
        loja: 'Loja / Comércio',
        homeoffice: 'Home Office',
        multiplas: 'Múltiplas unidades',
      };
      const velMap = {
        'nao-sei': 'Ainda não sei',
        '100mb':   'Até 100 MB',
        '300mb':   'Até 300 MB',
        '500mb':   'Até 500 MB',
        '1gb':     '1 GB ou mais',
      };
      return (
        `Olá! Tenho interesse em *Internet Empresarial*.\n\n` +
        `🏢 *Perfil do negócio:* ${perfilMap[a.perfil]}\n` +
        `⚡ *Velocidade desejada:* ${velMap[a.velocidade]}\n\n` +
        `Poderia me apresentar as melhores opções?`
      );
    },
  },

  {
    id: 'fixa',
    icon: 'ph-phone',
    badge: 'Telefonia Fixa',
    title: 'Telefonia Fixa',
    tagline: 'Ligações ilimitadas para todo o Brasil',
    description:
      'Um plano de telefonia fixa com ligações ilimitadas para qualquer destino no Brasil. Simples, direto, sem complicação.',
    benefits: [
      { icon: 'ph-infinity', text: 'Ligações ilimitadas para todo o Brasil' },
      { icon: 'ph-plus-circle', text: 'Linha nova ou migração de operadora' },
      { icon: 'ph-check-circle', text: 'Planos para qualquer porte de empresa' },
    ],
    steps: [
      {
        id: 'situacao',
        title: 'Qual é a sua situação atual?',
        hint: 'Isso nos ajuda a direcionar o processo de forma correta.',
        type: 'chips',
        required: true,
        options: [
          { value: 'nova',   label: 'Quero uma linha nova',               icon: 'ph-plus-circle' },
          { value: 'migrar', label: 'Já tenho linha e quero migrar',      icon: 'ph-arrows-left-right' },
        ],
      },
      {
        id: 'linhas',
        title: 'Quantas linhas você precisa?',
        hint: 'Informe o número de linhas de telefone fixo desejadas.',
        type: 'number',
        placeholder: 'Ex: 2',
        min: 1,
        required: true,
      },
    ],
    buildMessage(a) {
      const sit = a.situacao === 'nova' ? 'Contratação nova' : 'Migração de linha existente';
      return (
        `Olá! Tenho interesse em *Telefonia Fixa*.\n\n` +
        `☎️ *Situação:* ${sit}\n` +
        `📋 *Linhas desejadas:* ${a.linhas}\n\n` +
        `Poderia me apresentar as melhores opções?`
      );
    },
  },
];

/* ==========================================================
   ESTADO GLOBAL DO MODAL
   ========================================================== */
let _activeProduct = null;
let _currentStep  = 0;
let _answers      = {};

/* ==========================================================
   UTILITÁRIOS
   ========================================================== */
function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildWhatsAppUrl(message) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/* ==========================================================
   RENDERIZAÇÃO DOS CARDS DE PRODUTO
   ========================================================== */
function renderProductCards() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  grid.innerHTML = PRODUCTS.map((p) => `
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
        ${p.benefits.map((b) => `
          <li>
            <i class="ph ${escapeHtml(b.icon)}" aria-hidden="true"></i>
            ${escapeHtml(b.text)}
          </li>
        `).join('')}
      </ul>

      <button type="button" class="product-card-cta" data-product-id="${escapeHtml(p.id)}">
        Começar <i class="ph ph-arrow-up-right" aria-hidden="true"></i>
      </button>
    </article>
  `).join('');

  // Bind de clique nos cards e nos botões CTA
  grid.querySelectorAll('[data-product-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const id = el.dataset.productId;
      const product = PRODUCTS.find((p) => p.id === id);
      if (product) openModal(product);
    });

    // Acessibilidade: Enter/Space no card
    if (el.tagName === 'ARTICLE') {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });
    }
  });
}

/* ==========================================================
   MODAL — ABRIR / FECHAR
   ========================================================== */
function openModal(product) {
  _activeProduct = product;
  _currentStep   = 0;
  _answers       = {};

  const backdrop = document.getElementById('prod-modal-backdrop');
  const modal    = document.getElementById('prod-modal');

  backdrop.hidden = false;
  modal.hidden    = false;

  // Necessário para a transição CSS funcionar
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      modal.classList.add('is-open');
    });
  });

  document.body.classList.add('modal-open');
  renderStep();

  // Fechar com Escape
  document.addEventListener('keydown', _onEscKey);

  // Fechar clicando no backdrop
  backdrop.addEventListener('click', _onBackdropClick);
}

function closeModal() {
  const backdrop = document.getElementById('prod-modal-backdrop');
  const modal    = document.getElementById('prod-modal');

  modal.classList.remove('is-open');
  document.body.classList.remove('modal-open');

  setTimeout(() => {
    backdrop.hidden = true;
    modal.hidden    = true;
    modal.innerHTML = '';
  }, 280);

  document.removeEventListener('keydown', _onEscKey);
  backdrop.removeEventListener('click', _onBackdropClick);
}

function _onEscKey(e) {
  if (e.key === 'Escape') closeModal();
}

function _onBackdropClick(e) {
  if (e.target === e.currentTarget) closeModal();
}

/* ==========================================================
   MODAL — RENDERIZAR PASSO ATUAL
   ========================================================== */
function renderStep() {
  const product    = _activeProduct;
  const stepIndex  = _currentStep;
  const totalSteps = product.steps.length;
  const isReview   = stepIndex === totalSteps; // passo de revisão
  const modal      = document.getElementById('prod-modal');

  // Cabeçalho sempre presente
  const header = `
    <div class="prod-modal-header">
      <div class="prod-modal-meta">
        <span class="app-modal-badge">${escapeHtml(product.badge)}</span>
        <h2 class="app-modal-title" id="prod-modal-title">${escapeHtml(product.title)}</h2>
      </div>
      <button type="button" class="app-modal-close" id="prod-modal-close" aria-label="Fechar">
        <i class="ph ph-x" aria-hidden="true"></i>
      </button>
    </div>
  `;

  // Indicador de passos
  const dots = product.steps.map((_, i) => {
    let cls = '';
    if (isReview || i < stepIndex) cls = 'done';
    else if (i === stepIndex) cls = 'active';

    const inner = (isReview || i < stepIndex)
      ? '<i class="ph ph-check" aria-hidden="true"></i>'
      : i + 1;

    const line = i < totalSteps - 1
      ? `<div class="step-line ${(isReview || i < stepIndex) ? 'done' : ''}" aria-hidden="true"></div>`
      : '';

    return `<div class="step-dot ${cls}" aria-hidden="true">${inner}</div>${line}`;
  }).join('');

  const indicator = `
    <div class="step-indicator" aria-label="Passo ${Math.min(stepIndex + 1, totalSteps)} de ${totalSteps}">
      ${dots}
    </div>
  `;

  // Conteúdo principal
  const body = isReview
    ? buildReviewHTML(product)
    : buildStepHTML(product.steps[stepIndex]);

  // Botões de navegação
  const navBack = stepIndex > 0 && !isReview
    ? `<button type="button" class="hub-btn" id="btn-back"><i class="ph ph-arrow-left" aria-hidden="true"></i> Voltar</button>`
    : isReview
      ? `<button type="button" class="hub-btn" id="btn-back"><i class="ph ph-arrow-left" aria-hidden="true"></i> Revisar</button>`
      : `<div></div>`;

  const navNext = isReview
    ? '' // O botão do WhatsApp é renderizado dentro do body na revisão
    : `<button type="button" class="hub-btn hub-btn-primary" id="btn-next">
         ${stepIndex === totalSteps - 1 ? 'Revisar' : 'Próximo'}
         <i class="ph ph-arrow-right" aria-hidden="true"></i>
       </button>`;

  modal.innerHTML = `
    ${header}
    <div class="prod-modal-body">
      ${indicator}
      <div class="step-content" id="step-content">
        ${body}
      </div>
      <div class="prod-modal-nav" id="prod-modal-nav">
        ${navBack}
        ${navNext}
      </div>
    </div>
  `;

  // Bind dos eventos após renderização
  bindModalEvents(product, stepIndex, isReview);

  // Foco acessível no modal
  const firstFocusable = modal.querySelector('button:not([disabled]), input, select');
  if (firstFocusable) firstFocusable.focus();
}

/* ==========================================================
   MODAL — HTML DE UM PASSO DE PERGUNTA
   ========================================================== */
function buildStepHTML(step) {
  let inputHtml = '';

  if (step.type === 'number') {
    const val = _answers[step.id] ?? '';
    inputHtml = `
      <input
        type="number"
        id="step-input"
        class="step-number-input"
        value="${escapeHtml(String(val))}"
        placeholder="${escapeHtml(step.placeholder ?? '')}"
        min="${step.min ?? 1}"
        aria-label="${escapeHtml(step.title)}"
      />
    `;
  } else if (step.type === 'text') {
    const val = _answers[step.id] ?? '';
    inputHtml = `
      <input
        type="text"
        id="step-input"
        class="step-text-input"
        value="${escapeHtml(String(val))}"
        placeholder="${escapeHtml(step.placeholder ?? '')}"
        aria-label="${escapeHtml(step.title)}"
        maxlength="120"
      />
    `;
  } else if (step.type === 'chips') {
    const selected = _answers[step.id] ?? '';
    inputHtml = `
      <div class="step-chips" role="group" aria-label="${escapeHtml(step.title)}">
        ${step.options.map((opt) => `
          <button
            type="button"
            class="step-chip ${selected === opt.value ? 'selected' : ''}"
            data-value="${escapeHtml(opt.value)}"
            aria-pressed="${selected === opt.value}">
            ${opt.icon ? `<i class="ph ${escapeHtml(opt.icon)}" aria-hidden="true"></i>` : ''}
            ${escapeHtml(opt.label)}
          </button>
        `).join('')}
      </div>
    `;
  }

  return `
    <h3 class="step-question">${escapeHtml(step.title)}</h3>
    ${step.hint ? `<p class="step-hint">${escapeHtml(step.hint)}</p>` : ''}
    ${inputHtml}
    <p class="step-error" id="step-error" role="alert">Por favor, preencha este campo para continuar.</p>
  `;
}

/* ==========================================================
   MODAL — HTML DO PASSO DE REVISÃO
   ========================================================== */
function buildReviewHTML(product) {
  const rows = product.steps.map((step) => {
    const rawVal = _answers[step.id];
    let displayVal = '';

    if (step.type === 'chips') {
      const opt = step.options.find((o) => o.value === rawVal);
      displayVal = opt ? opt.label : '—';
    } else {
      displayVal = rawVal?.toString().trim() || (step.required ? '—' : 'Sem preferência');
    }

    const icons = {
      number: 'ph-hash',
      chips:  'ph-check-square',
      text:   'ph-pencil-simple',
    };

    return `
      <div class="summary-row">
        <i class="ph ${icons[step.type] ?? 'ph-info'}" aria-hidden="true"></i>
        <div class="summary-row-content">
          <span class="summary-label">${escapeHtml(step.title)}</span>
          <span class="summary-value">${escapeHtml(displayVal)}</span>
        </div>
      </div>
    `;
  }).join('');

  const waUrl = buildWhatsAppUrl(product.buildMessage(_answers));

  return `
    <h3 class="step-question">Tudo certo! Confirme o seu pedido.</h3>
    <p class="step-hint">Revise as informações abaixo. Um consultor vai receber esses dados e entrar em contato para apresentar as melhores opções.</p>

    <div class="summary-card">
      <p class="summary-title">Resumo da solicitação</p>
      ${rows}
    </div>

    <a
      href="${waUrl}"
      target="_blank"
      rel="noopener noreferrer"
      class="whatsapp-btn-modal"
      id="btn-whatsapp">
      <i class="ph ph-whatsapp-logo" aria-hidden="true"></i>
      Falar com um consultor
    </a>
    <p class="modal-footer-note">
      Você será redirecionado para o WhatsApp com a sua solicitação já preenchida.
    </p>
  `;
}

/* ==========================================================
   MODAL — BIND DE EVENTOS POR PASSO
   ========================================================== */
function bindModalEvents(product, stepIndex, isReview) {
  // Fechar
  document.getElementById('prod-modal-close')?.addEventListener('click', closeModal);

  // Voltar
  document.getElementById('btn-back')?.addEventListener('click', () => {
    _currentStep = isReview ? product.steps.length - 1 : stepIndex - 1;
    renderStep();
  });

  // Próximo
  document.getElementById('btn-next')?.addEventListener('click', () => {
    handleNext(product, stepIndex);
  });

  // Enter no input text/number para avançar
  const input = document.getElementById('step-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleNext(product, stepIndex);
    });
  }

  // Chips: seleção e toggle de classe
  document.querySelectorAll('.step-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.step-chip').forEach((c) => {
        c.classList.remove('selected');
        c.setAttribute('aria-pressed', 'false');
      });
      chip.classList.add('selected');
      chip.setAttribute('aria-pressed', 'true');

      const step = product.steps[stepIndex];
      _answers[step.id] = chip.dataset.value;

      // Esconde erro se houver
      const errEl = document.getElementById('step-error');
      if (errEl) errEl.classList.remove('visible');
    });
  });
}

/* ==========================================================
   MODAL — VALIDAR E AVANÇAR
   ========================================================== */
function handleNext(product, stepIndex) {
  const step   = product.steps[stepIndex];
  const errEl  = document.getElementById('step-error');
  const input  = document.getElementById('step-input');

  // Coleta o valor do input (se houver)
  if (input) {
    _answers[step.id] = input.value;
  }

  // Validação: campo obrigatório
  if (step.required) {
    const val = (_answers[step.id] ?? '').toString().trim();
    if (!val) {
      errEl?.classList.add('visible');
      input?.focus();
      return;
    }
    // Número mínimo
    if (step.type === 'number' && parseInt(val, 10) < (step.min ?? 1)) {
      if (errEl) errEl.textContent = `O valor mínimo é ${step.min ?? 1}.`;
      errEl?.classList.add('visible');
      input?.focus();
      return;
    }
  }

  errEl?.classList.remove('visible');

  // Avança para o próximo passo ou para a revisão
  _currentStep = stepIndex + 1;
  renderStep();
}

/* ==========================================================
   CTA GERAL (WhatsApp sem produto específico)
   ========================================================== */
function initCtaGeral() {
  const btn = document.getElementById('cta-whatsapp-geral');
  if (!btn) return;

  const msg = 'Olá! Gostaria de saber mais sobre as soluções da AVANCE. Poderia me ajudar?';
  btn.href = buildWhatsAppUrl(msg);
}

/* ==========================================================
   TEMA ESCURO / CLARO
   ========================================================== */
function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const isDark = document.body.classList.contains('dark-mode');
  updateThemeIcon(btn, isDark);

  btn.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const dark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    updateThemeIcon(btn, dark);
  });
}

function updateThemeIcon(btn, isDark) {
  const icon = btn.querySelector('i');
  if (icon) icon.className = isDark ? 'ph ph-sun' : 'ph ph-moon';
  btn.setAttribute('aria-label', isDark ? 'Ativar modo claro' : 'Ativar modo escuro');
}

/* ==========================================================
   EFEITO DA NAVBAR (aparece ao rolar ou aproximar o mouse)
   ========================================================== */
function initNavbarEffect() {
  const navbar = document.querySelector('.top-navbar');
  if (!navbar) return;

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });

  document.addEventListener('mousemove', (e) => {
    navbar.classList.toggle('hover-active', e.clientY <= 30);
  });
}

/* ==========================================================
   MENU MOBILE
   ========================================================== */
function initMobileMenu() {
  const btn   = document.getElementById('mobile-menu-btn');
  const links = document.getElementById('navbar-links');
  if (!btn || !links) return;

  btn.addEventListener('click', () => {
    const isOpen = links.classList.toggle('active');
    const icon   = btn.querySelector('i');
    if (icon) icon.className = isOpen ? 'ph ph-x' : 'ph ph-list';
    btn.setAttribute('aria-label', isOpen ? 'Fechar Menu' : 'Abrir Menu');
  });

  links.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      links.classList.remove('active');
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'ph ph-list';
      btn.setAttribute('aria-label', 'Abrir Menu');
    });
  });
}

/* ==========================================================
   PARTÍCULAS (Canvas — idêntico ao hub.js)
   ========================================================== */
function initParticles() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let canvas = document.getElementById('global-particles');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'global-particles';
    Object.assign(canvas.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      zIndex: '-10', pointerEvents: 'none',
    });
    document.body.prepend(canvas);
  }

  const ctx = canvas.getContext('2d');
  let particles = [];
  let rafId = null;

  function createSprite(size) {
    const d  = Math.ceil((size + 15) * 2);
    const oc = document.createElement('canvas');
    oc.width = oc.height = d;
    const oc2 = oc.getContext('2d');
    const c   = d / 2;
    oc2.shadowBlur  = 15;
    oc2.shadowColor = 'rgba(87,197,234,1)';
    oc2.fillStyle   = 'rgba(87,197,234,1)';
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
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    spriteCache.clear();
  }

  setSize();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { setSize(); init(); }, 200);
  }, { passive: true });

  class Particle {
    constructor() {
      this.x       = Math.random() * canvas.width;
      this.y       = Math.random() * canvas.height;
      this.size    = Math.random() * 3 + 1.5;
      this.speedX  = (Math.random() - 0.5) * 1.2;
      this.speedY  = (Math.random() - 0.5) * 1.2;
      this.opacity = Math.random() * 0.7 + 0.3;
      this.sprite  = getSprite(this.size);
    }
    update() {
      this.x += this.speedX;
      this.y += this.speedY;
      if (this.x < 0 || this.x > canvas.width)  this.speedX *= -1;
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
    const n = Math.floor((canvas.width * canvas.height) / 8000);
    for (let i = 0; i < n; i++) particles.push(new Particle());
  }

  function animate() {
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => { p.update(); p.draw(); });
    rafId = requestAnimationFrame(animate);
  }

  const start = () => { if (!rafId) rafId = requestAnimationFrame(animate); };
  const stop  = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } };

  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());

  init();
  start();
}

/* ==========================================================
   INICIALIZAÇÃO
   ========================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initNavbarEffect();
  initParticles();
  initTheme();
  initMobileMenu();
  renderProductCards();
  initCtaGeral();
});
