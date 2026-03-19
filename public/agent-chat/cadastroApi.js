// Arquivo: script.js (na raiz do projeto)

document.addEventListener('DOMContentLoaded', () => {

  const modalApi = document.getElementById('modalApi');
  const btnAbrirModal = document.getElementById('btnAbrirModalSidebar');
  const btnFecharModal = document.getElementById('btnFecharModal');
  const formApi = document.getElementById('formApi');
  const inputApiKey = document.getElementById('apiKey');
  const btnMostrarSenha = document.getElementById('btnMostrarSenha');
  const mensagemApi = document.getElementById('mensagemApi');

  // Função para abrir o modal
  if (btnAbrirModal) {
    btnAbrirModal.addEventListener('click', () => {
      modalApi.classList.add('active');
      const savedKey = localStorage.getItem('gemini_api_key');
      if (savedKey && inputApiKey) inputApiKey.value = savedKey;
    });
  }

  // Função para fechar o modal
  const fecharModal = () => {
    if (modalApi) modalApi.classList.remove('active');
    if (mensagemApi) {
      mensagemApi.textContent = '';
      mensagemApi.className = 'mensagem-feedback';
    }
  };

  if (btnFecharModal) btnFecharModal.addEventListener('click', fecharModal);

  if (modalApi) {
    modalApi.addEventListener('click', (e) => {
      if (e.target === modalApi) fecharModal();
    });
  }

  // Lógica de Mostrar/Ocultar Senha
  if (btnMostrarSenha && inputApiKey) {
    btnMostrarSenha.addEventListener('click', () => {
      const icon = btnMostrarSenha.querySelector('i');
      if (inputApiKey.type === 'password') {
        inputApiKey.type = 'text';
        if (icon) icon.className = 'ph ph-eye-slash input-icon';
      } else {
        inputApiKey.type = 'password';
        if (icon) icon.className = 'ph ph-eye input-icon';
      }
    });
  }

  // Lógica Principal: Salvar, Validar no Google e chamar Vercel
  if (formApi) {
    formApi.addEventListener('submit', async (e) => {
      e.preventDefault();

      const apiKey = inputApiKey.value.trim();

      const userEmail = document.getElementById('user-email')?.textContent || '';

      if (apiKey.length < 10) {
        mensagemApi.textContent = 'Por favor, insira uma chave de API válida.';
        mensagemApi.className = 'mensagem-feedback mensagem-erro';
        return;
      }

      mensagemApi.textContent = 'Validando chave com o Google...';
      mensagemApi.className = 'mensagem-feedback';

      try {
        // 1. Valida direto no Google primeiro
        const googleResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);

        if (!googleResponse.ok) {
          // NOVA PARTE: Pega o erro exato que o Google enviou
          const erroDetalhado = await googleResponse.json();
          console.error('⚠️ DETALHE DO ERRO DO GOOGLE:', erroDetalhado);
          throw new Error('Chave inválida ou bloqueada pelo Google.');
        }

        // 2. Se o Google aprovou, chama o SEU servidor na Vercel (que vai chamar o n8n)
        const vercelResponse = await fetch('../api/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            evento: 'nova_chave_conectada',
            status: 'sucesso',
            chave_gemini_recebida: apiKey,
            email: userEmail
          })
        });

        if (!vercelResponse.ok) {
          throw new Error('Falha ao comunicar com o servidor da Vercel.');
        }

        // 3. Salva a chave no navegador e dá a mensagem verde
        localStorage.setItem('gemini_api_key', apiKey);

        mensagemApi.textContent = 'Chave validada e conectada com sucesso!';
        mensagemApi.className = 'mensagem-feedback mensagem-sucesso';

        if (typeof window.atualizarStatusAgente === 'function') {
          window.atualizarStatusAgente(true);
        }

        setTimeout(() => { fecharModal(); }, 1500);

      } catch (erro) {
        const mensagemErro = erro.message === 'Chave inválida ou bloqueada pelo Google.'
          ? erro.message
          : 'Falha na validação ou erro de comunicação com o servidor.';

        mensagemApi.textContent = `Erro: ${mensagemErro}`;
        mensagemApi.className = 'mensagem-feedback mensagem-erro';
        console.error('Falha no processo:', erro);
      }
    });
  }
});