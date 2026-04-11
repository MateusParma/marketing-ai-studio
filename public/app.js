// Marketing AI Studio - Frontend v2: Wizard + Dashboard + Modal expandido + Imagens

// ========== STORAGE ==========
const STORAGE_KEY = 'marketing_ai_studio_v3';
const DEFAULT_EMPRESA_DATA = { historico: [], calendario: null, concorrentes: null, galeria: [], pastas: ['Geral'] };

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    // Migração do v2
    const v2 = localStorage.getItem('marketing_ai_studio_v2');
    if (v2) {
      const old = JSON.parse(v2);
      if (old.empresa) {
        const id = 'emp_' + Date.now();
        const empresas = [{ id, ...old.empresa }];
        const dados = {};
        dados[id] = { historico: old.historico || [], calendario: old.calendario || null, concorrentes: old.concorrentes || null, galeria: old.galeria || [], pastas: old.pastas || ['Geral'] };
        return { empresas, empresaAtualId: id, dados };
      }
    }
    return { empresas: [], empresaAtualId: null, dados: {} };
  } catch { return { empresas: [], empresaAtualId: null, dados: {} }; }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
let state = loadState();

// Helpers para acessar dados da empresa atual
function empresaAtual() { return state.empresas.find(e => e.id === state.empresaAtualId) || null; }
function dadosEmpresa() {
  if (!state.empresaAtualId) return { ...DEFAULT_EMPRESA_DATA };
  if (!state.dados[state.empresaAtualId]) state.dados[state.empresaAtualId] = { ...DEFAULT_EMPRESA_DATA, galeria: [], historico: [], pastas: ['Geral'] };
  return state.dados[state.empresaAtualId];
}

// Migração de pastas para itens da galeria
Object.values(state.dados || {}).forEach(d => {
  if (!d.pastas) d.pastas = ['Geral'];
  (d.galeria || []).forEach(item => { if (!item.pasta) item.pasta = 'Geral'; });
});

// Variáveis de gerenciamento da galeria
let modoGerenciar = false;
let selecionados = new Set();

// ========== HELPERS ==========
const $ = id => document.getElementById(id);
const esc = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
async function postJSON(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return await res.json();
}
function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}
function showLoading(txt = 'Pensando com a IA...') { $('loading-text').textContent = txt; $('loading-overlay').classList.remove('hidden'); }
function hideLoading() { $('loading-overlay').classList.add('hidden'); }

// ========== BOOT ==========
window.addEventListener('DOMContentLoaded', () => {
  empresaAtual() ? showDashboard() : showWizard();
  renderHistorico();
});
function showWizard() { $('wizard').classList.remove('hidden'); $('dashboard').classList.add('hidden'); }
function showDashboard() {
  $('wizard').classList.add('hidden'); $('dashboard').classList.remove('hidden');
  const emp = empresaAtual();
  $('topbar-nome').textContent = emp?.nome || '—';
  $('topbar-segmento').textContent = emp?.segmento || '—';
  renderEmpresaSelector();
  renderPerfil();
  const d = dadosEmpresa();
  if (d.calendario) renderCalendario();
  if (d.concorrentes) renderConcorrentes();
}

// ========== WIZARD ==========
function goToStep(n) {
  document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.step-dot').forEach(el => el.classList.remove('active'));
  document.querySelector(`.wizard-step[data-step="${n}"]`).classList.add('active');
  for (let i = 1; i <= n; i++) document.querySelector(`.step-dot[data-step="${i}"]`).classList.add('active');
}
function nextStep(current) {
  if (current === 1) { if (!$('w-nome').value.trim()) return toast('Informe o nome'); if (!$('w-segmento').value.trim()) return toast('Informe o segmento'); }
  if (current === 2 && !$('w-publico').value.trim()) return toast('Descreva o público-alvo');
  goToStep(current + 1);
}
function prevStep(current) { goToStep(current - 1); }

async function finalizarOnboarding() {
  if (!$('w-descricao').value.trim()) return toast('Descreva a empresa');
  const dados = {
    nome: $('w-nome').value.trim(), site: $('w-site').value.trim(),
    segmento: $('w-segmento').value.trim(), publico: $('w-publico').value.trim(),
    redesSociais: $('w-redes').value.trim(), localizacao: $('w-local').value.trim(),
    descricao: $('w-descricao').value.trim(), concorrentesUrls: $('w-concorrentes').value.trim(),
  };
  goToStep(4);
  const steps = ['ls-1','ls-2','ls-3','ls-4']; let i = 0; $('ls-1').classList.add('active');
  const interval = setInterval(() => { if (i < steps.length - 1) { $(steps[i]).classList.remove('active'); $(steps[i]).classList.add('done'); i++; $(steps[i]).classList.add('active'); } }, 4000);
  try {
    const r = await postJSON('/api/empresa/analisar', dados);
    clearInterval(interval);
    if (!r.ok) { alert('Erro: ' + (r.error || 'desconhecido')); goToStep(3); return; }
    const id = 'emp_' + Date.now();
    const novaEmpresa = { id, ...dados, analise: r.empresa.analise, scraped: r.empresa.scraped, criadoEm: new Date().toISOString() };
    state.empresas.push(novaEmpresa);
    state.empresaAtualId = id;
    state.dados[id] = { historico: [], calendario: null, concorrentes: null, galeria: [], pastas: ['Geral'] };
    saveState();
    if (dados.concorrentesUrls) {
      const urls = dados.concorrentesUrls.split(',').map(s => s.trim()).filter(Boolean);
      try { const rc = await postJSON('/api/concorrentes/analisar', { concorrentes: urls.map((u,i) => ({nome:`Concorrente ${i+1}`,site:u})), empresa: empresaAtual() }); if (rc.ok) { dadosEmpresa().concorrentes = rc.resultado; saveState(); } } catch {}
    }
    steps.forEach(s => { $(s).classList.remove('active'); $(s).classList.add('done'); });
    await new Promise(r => setTimeout(r, 600));
    showDashboard(); toast('Pronto! Empresa cadastrada, Deborah ✨');
  } catch (err) { clearInterval(interval); alert('Erro: ' + err.message); goToStep(3); }
}

// ========== SIDEBAR PERFIL (legado — redirecionado para view) ==========
function toggleSidebar() { toggleView('perfil'); }
function renderPerfil() { /* renderizado pela view-perfil agora */ }

// ========== PERFIL COMPLETO (PÁGINA) ==========
function renderPerfilCompleto() {
  const e = empresaAtual(); if (!e) return;
  const a = e.analise || {};
  const s = e.scraped || {};
  const d = dadosEmpresa();
  const siteUrl = e.site && !e.site.startsWith('http') ? 'https://' + e.site : e.site;
  const totalConteudos = (d.galeria || []).length;
  const totalImgs = (d.galeria || []).filter(x => x.tipo === 'imagem').length;
  const totalPosts = (d.galeria || []).filter(x => x.tipo === 'post').length;
  const totalCal = (d.calendario?.posts || []).length;
  const criadoEm = e.criadoEm ? new Date(e.criadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

  $('perfil-page-content').innerHTML = `
    <!-- HERO -->
    <div class="perfil-hero">
      <div class="perfil-hero-info">
        <div class="perfil-avatar">${esc(e.nome?.charAt(0) || 'E')}</div>
        <div>
          <h1 class="perfil-nome">${esc(e.nome)}</h1>
          <p class="perfil-segmento">${esc(e.segmento)}</p>
          <div class="perfil-meta">
            ${e.localizacao ? `<span>📍 ${esc(e.localizacao)}</span>` : ''}
            ${siteUrl ? `<span>🌐 <a href="${esc(siteUrl)}" target="_blank" style="color:#c084fc;">${esc(e.site.replace(/^https?:\/\//, ''))}</a></span>` : ''}
            ${e.redesSociais ? `<span>📱 ${esc(e.redesSociais)}</span>` : ''}
            <span>📅 Desde ${criadoEm}</span>
          </div>
        </div>
      </div>
      <div class="perfil-hero-actions">
        <button class="btn-ghost-sm" onclick="editarEmpresaAtual()">✏️ Editar</button>
        <button class="btn-ghost-sm" onclick="adicionarEmpresa()">＋ Nova empresa</button>
        <button class="btn-ghost-sm btn-danger" onclick="excluirEmpresaAtual()">🗑️ Excluir</button>
      </div>
    </div>

    <!-- PREVIEW DO SITE -->
    ${siteUrl ? `
    <div class="perfil-section">
      <h3 class="perfil-section-title">🌐 Preview do Site</h3>
      <div class="perfil-site-preview">
        <div class="perfil-site-frame">
          <div class="perfil-site-bar">
            <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
            <span class="perfil-site-url">${esc(e.site)}</span>
          </div>
          <iframe src="${esc(siteUrl)}" class="perfil-iframe" sandbox="allow-same-origin allow-scripts" loading="lazy"></iframe>
        </div>
        <div class="perfil-site-info">
          ${s.title ? `<h4>${esc(s.title)}</h4>` : ''}
          ${s.description ? `<p class="perfil-site-desc">${esc(s.description)}</p>` : ''}
          ${s.h1 ? `<div class="perfil-site-tag"><strong>H1:</strong> ${esc(s.h1)}</div>` : ''}
          ${s.h2 ? `<div class="perfil-site-tag"><strong>H2:</strong> ${esc(s.h2.split(' | ').slice(0,5).join(' | '))}</div>` : ''}
          <a href="${esc(siteUrl)}" target="_blank" class="btn-ghost-sm" style="margin-top:12px;display:inline-block;text-decoration:none;">Abrir site ↗</a>
        </div>
      </div>
    </div>` : ''}

    <!-- STATS RÁPIDOS -->
    <div class="perfil-stats-row">
      <div class="perfil-stat-card"><div class="perfil-stat-num">${totalConteudos}</div><div class="perfil-stat-label">Total criados</div></div>
      <div class="perfil-stat-card"><div class="perfil-stat-num">${totalPosts}</div><div class="perfil-stat-label">Posts</div></div>
      <div class="perfil-stat-card"><div class="perfil-stat-num">${totalImgs}</div><div class="perfil-stat-label">Imagens</div></div>
      <div class="perfil-stat-card"><div class="perfil-stat-num">${totalCal}</div><div class="perfil-stat-label">Calendário</div></div>
    </div>

    <!-- SOBRE A EMPRESA -->
    <div class="perfil-section">
      <h3 class="perfil-section-title">🏢 Sobre a Empresa</h3>
      <div class="perfil-card-grid">
        <div class="perfil-card">
          <div class="perfil-card-icon">🎯</div>
          <h4>Público-alvo</h4>
          <p>${esc(e.publico)}</p>
        </div>
        <div class="perfil-card">
          <div class="perfil-card-icon">📝</div>
          <h4>Descrição</h4>
          <p>${esc(e.descricao || 'Sem descrição')}</p>
        </div>
        ${a.resumoMarca ? `<div class="perfil-card full-width">
          <div class="perfil-card-icon">💡</div>
          <h4>Resumo da Marca</h4>
          <p>${esc(a.resumoMarca)}</p>
        </div>` : ''}
      </div>
    </div>

    <!-- POSICIONAMENTO E TOM -->
    ${a.posicionamento || a.tomDeVoz ? `
    <div class="perfil-section">
      <h3 class="perfil-section-title">🧭 Posicionamento & Voz</h3>
      <div class="perfil-card-grid">
        ${a.posicionamento ? `<div class="perfil-card"><div class="perfil-card-icon">🏆</div><h4>Posicionamento</h4><p>${esc(a.posicionamento)}</p></div>` : ''}
        ${a.tomDeVoz ? `<div class="perfil-card"><div class="perfil-card-icon">🗣️</div><h4>Tom de Voz</h4><p>${esc(a.tomDeVoz)}</p></div>` : ''}
      </div>
    </div>` : ''}

    <!-- ANÁLISE SWOT -->
    ${a.pontosFortes || a.pontosFracos || a.oportunidades ? `
    <div class="perfil-section">
      <h3 class="perfil-section-title">📊 Análise Estratégica</h3>
      <div class="perfil-swot">
        ${a.pontosFortes ? `<div class="swot-card swot-forca"><h4>💪 Pontos Fortes</h4><ul>${a.pontosFortes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${a.pontosFracos ? `<div class="swot-card swot-fraqueza"><h4>⚠️ Pontos Fracos</h4><ul>${a.pontosFracos.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${a.oportunidades ? `<div class="swot-card swot-oportunidade"><h4>🚀 Oportunidades</h4><ul>${a.oportunidades.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      </div>
    </div>` : ''}

    <!-- PERSONA -->
    ${a.personaPrincipal ? `
    <div class="perfil-section">
      <h3 class="perfil-section-title">👤 Persona Principal</h3>
      <div class="perfil-persona">
        <div class="persona-avatar">👤</div>
        <div class="persona-info">
          <h4>${esc(a.personaPrincipal.nome)} — ${esc(a.personaPrincipal.idade)}</h4>
          <div class="persona-grid">
            <div class="persona-col">
              <strong>😣 Dores</strong>
              <ul>${(a.personaPrincipal.dores || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
            </div>
            <div class="persona-col">
              <strong>✨ Desejos</strong>
              <ul>${(a.personaPrincipal.desejos || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
            </div>
          </div>
        </div>
      </div>
    </div>` : ''}

    <!-- AÇÕES IMEDIATAS -->
    ${a.sugestoesImediatas ? `
    <div class="perfil-section">
      <h3 class="perfil-section-title">⚡ Ações Recomendadas</h3>
      <div class="perfil-acoes">
        ${a.sugestoesImediatas.map((x, i) => `<div class="acao-item"><span class="acao-num">${i + 1}</span><span>${esc(x)}</span></div>`).join('')}
      </div>
    </div>` : ''}
  `;
}

// ========== MODAL EXPANDIDO ==========
let modalAtual = null; // { source: 'conteudo'|'calendario', index, item, containerId }

function abrirModal(source, index, item, containerId) {
  modalAtual = { source, index, item: { ...item }, containerId };
  $('modal-titulo').textContent = source === 'calendario' ? `📅 ${item.tema || item.data}` : `✏️ ${item.tipo || 'Conteúdo'}`;
  $('modal-gancho').value = item.gancho || item.tema || '';
  $('modal-texto').value = item.texto || item.ideiaCopy || '';
  $('modal-cta').value = item.cta || '';
  $('modal-hashtags').value = item.hashtags || '';
  $('modal-visual').value = item.visual || '';
  $('modal-variacoes').innerHTML = '';
  $('modal-imagem').innerHTML = '';
  $('modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function fecharModal() {
  $('modal').classList.add('hidden');
  document.body.style.overflow = '';
  modalAtual = null;
}

function modalSalvar() {
  if (!modalAtual) return;

  // Edição de item da galeria
  if (modalAtual.source === 'galeria-edit') {
    const idx = (dadosEmpresa().galeria || []).findIndex(x => String(x.id) === String(modalAtual.galeriaId));
    if (idx >= 0) {
      dadosEmpresa().galeria[idx].titulo = $('modal-gancho').value;
      dadosEmpresa().galeria[idx].descricao = $('modal-visual').value;
      dadosEmpresa().galeria[idx].textoCompleto = $('modal-texto').value;
      dadosEmpresa().galeria[idx].textoPost = $('modal-texto').value;
      dadosEmpresa().galeria[idx].cta = $('modal-cta').value;
      dadosEmpresa().galeria[idx].hashtags = $('modal-hashtags').value;
      dadosEmpresa().galeria[idx].visual = $('modal-visual').value;
    }
    saveState();
    toast('Item atualizado!');
    fecharModal();
    renderGaleria();
    return;
  }

  const item = modalAtual.item;
  item.gancho = $('modal-gancho').value;
  item.texto = $('modal-texto').value;
  item.ideiaCopy = $('modal-texto').value;
  item.cta = $('modal-cta').value;
  item.hashtags = $('modal-hashtags').value;
  item.visual = $('modal-visual').value;

  // Atualiza no state
  if (modalAtual.source === 'conteudo' && dadosEmpresa().historico.length) {
    const h = dadosEmpresa().historico.find(x => x.itens);
    if (h && h.itens[modalAtual.index]) {
      h.itens[modalAtual.index] = { ...item };
    }
  }
  if (modalAtual.source === 'calendario' && dadosEmpresa().calendario) {
    const posts = dadosEmpresa().calendario.posts || [];
    if (posts[modalAtual.index]) {
      posts[modalAtual.index] = { ...posts[modalAtual.index], ...item };
    }
  }
  saveState();
  toast('Alterações salvas!');
  fecharModal();

  // Re-renderiza
  if (modalAtual?.source === 'calendario') renderCalendario();
}

function modalCopiarTudo() {
  const txt = `${$('modal-gancho').value}\n\n${$('modal-texto').value}\n\n${$('modal-cta').value}\n\n${$('modal-hashtags').value}`;
  navigator.clipboard.writeText(txt);
  toast('Copiado!');
}

// ========== MODAL: MELHORAR TEXTO ==========
async function modalMelhorar() {
  const texto = $('modal-texto').value;
  const gancho = $('modal-gancho').value;
  if (!texto) return toast('Não há texto para melhorar');

  showLoading('Melhorando o texto...');
  try {
    const r = await postJSON('/api/conteudo/melhorar', {
      gancho, texto,
      cta: $('modal-cta').value,
      empresa: empresaAtual(),
    });
    hideLoading();
    if (!r.ok) return toast('Erro: ' + r.error);
    $('modal-gancho').value = r.resultado.gancho || gancho;
    $('modal-texto').value = r.resultado.texto || texto;
    if (r.resultado.cta) $('modal-cta').value = r.resultado.cta;
    if (r.resultado.hashtags) $('modal-hashtags').value = r.resultado.hashtags;
    toast('Texto melhorado! ✨');
  } catch (err) { hideLoading(); toast('Erro: ' + err.message); }
}

// ========== MODAL: GERAR VARIAÇÕES ==========
async function modalVariacoes() {
  const texto = $('modal-texto').value;
  const gancho = $('modal-gancho').value;
  if (!texto) return toast('Não há texto para gerar variações');

  showLoading('Gerando variações...');
  try {
    const r = await postJSON('/api/conteudo/variacoes', {
      gancho, texto,
      cta: $('modal-cta').value,
      empresa: empresaAtual(),
    });
    hideLoading();
    if (!r.ok) return toast('Erro: ' + r.error);
    const vars = r.resultado.variacoes || [];
    $('modal-variacoes').innerHTML = `
      <label class="modal-label">Variações (clique para usar)</label>
      ${vars.map((v, i) => `
        <div class="variacao-item" onclick="usarVariacao(${i})">
          <div class="var-gancho">${esc(v.gancho)}</div>
          <div class="var-texto">${esc(v.texto)}</div>
          <div class="var-hint">Clique para substituir o texto acima</div>
        </div>`).join('')}`;
    window._variacoes = vars;
    toast(`${vars.length} variações geradas!`);
  } catch (err) { hideLoading(); toast('Erro: ' + err.message); }
}

function usarVariacao(idx) {
  const v = window._variacoes?.[idx];
  if (!v) return;
  $('modal-gancho').value = v.gancho || $('modal-gancho').value;
  $('modal-texto').value = v.texto || $('modal-texto').value;
  if (v.cta) $('modal-cta').value = v.cta;
  if (v.hashtags) $('modal-hashtags').value = v.hashtags;
  toast('Variação aplicada!');
}

// ========== MODAL: GERAR IMAGEM ==========
async function modalGerarImagem() {
  const visual = $('modal-visual').value || $('modal-gancho').value;
  const texto = $('modal-texto').value;
  if (!visual && !texto) return toast('Preencha algum texto para gerar a imagem');

  const modeloEscolhido = $('modal-modelo-img')?.value || 'gemini';
  const nomeModelo = modeloEscolhido === 'dalle' ? 'DALL-E 3' : 'NanoBanana (Gemini)';
  showLoading(`Gerando imagem com ${nomeModelo}... (15-30s)`);
  try {
    const r = await postJSON('/api/imagem/gerar', {
      descricao: visual,
      contexto: texto.slice(0, 500),
      empresa: empresaAtual(),
      modelo: modeloEscolhido,
    });
    hideLoading();
    if (!r.ok) return toast('Erro: ' + r.error);

    if (r.imageUrl) {
      $('modal-imagem').innerHTML = `
        <div class="img-result">
          <img src="${esc(r.imageUrl)}" alt="Imagem gerada" style="max-width:100%;border-radius:12px;">
          ${r.modelo ? `<div class="img-modelo">Gerada com ${esc(r.modelo)}</div>` : ''}
          ${r.descricaoPT ? `<div class="img-desc">${esc(r.descricaoPT)}</div>` : ''}
          <div class="img-prompt">${esc(r.promptUsado || '')}</div>
          <div class="img-actions">
            <a href="${esc(r.imageUrl)}" download="post-image.png" class="btn-secondary" style="text-decoration:none;display:inline-block;">⬇ Baixar imagem</a>
            <button class="btn-ai" onclick="modalGerarImagem()">🔄 Gerar outra versão</button>
            <button class="copy-btn" onclick="navigator.clipboard.writeText('${(r.promptUsado||'').replace(/'/g,"\\'")}');toast('Prompt copiado!')">📋 Copiar prompt</button>
          </div>
        </div>`;
      // Salva na galeria
      salvarNaGaleria({
        tipo: 'imagem',
        titulo: $('modal-gancho').value || 'Imagem gerada',
        descricao: r.descricaoPT || $('modal-visual').value,
        imageUrl: r.imageUrl,
        modelo: r.modelo,
        prompt: r.promptUsado,
        textoPost: $('modal-texto').value,
      });
      toast('Imagem gerada! ✨');
    } else if (r.semApi && r.instrucao) {
      $('modal-imagem').innerHTML = `
        <div class="img-result">
          <div class="error-box" style="margin-bottom:14px;">${esc(r.instrucao)}</div>
          <label class="modal-label">Prompt pronto (copie e use no NanoBanana, DALL-E, Midjourney, etc.)</label>
          <div class="modal-textarea" style="white-space:pre-wrap;min-height:80px;padding:12px;cursor:pointer;" onclick="navigator.clipboard.writeText(this.textContent);toast('Prompt copiado!')">${esc(r.promptSugerido)}</div>
        </div>`;
      toast('Configure uma API de imagem pra gerar direto no app');
    } else if (r.promptSugerido) {
      $('modal-imagem').innerHTML = `
        <div class="img-result">
          <div style="color:#fb923c;font-size:13px;margin-bottom:10px;">⚠️ ${esc(r.instrucao || 'A API falhou nesta tentativa.')}</div>
          <label class="modal-label">Prompt pronto (copie e use manualmente)</label>
          <div class="modal-textarea" style="white-space:pre-wrap;min-height:80px;padding:12px;cursor:pointer;" onclick="navigator.clipboard.writeText(this.textContent);toast('Prompt copiado!')">${esc(r.promptSugerido)}</div>
          <div class="img-actions">
            <button class="btn-ai" onclick="modalGerarImagem()">🔄 Tentar novamente</button>
          </div>
        </div>`;
      toast('Tente novamente ou use o prompt manualmente');
    }
  } catch (err) { hideLoading(); toast('Erro: ' + err.message); }
}

// ========== GERADOR DE CONTEÚDO ==========
async function gerarConteudo() {
  const tema = $('ct-tema').value.trim();
  if (!tema) return toast('Informe o tema');
  const body = {
    tipo: $('ct-tipo').value, plataforma: $('ct-plataforma').value,
    quantidade: parseInt($('ct-qtd').value) || 3, objetivo: $('ct-objetivo').value,
    tema, empresa: empresaAtual(),
  };
  showLoading('Criando conteúdo no tom da sua marca...');
  try {
    const r = await postJSON('/api/conteudo/gerar', body);
    hideLoading();
    if (!r.ok) return $('ct-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const itens = r.resultado.itens || [];
    renderConteudo('ct-resultado', itens);
    dadosEmpresa().historico.unshift({ id: Date.now(), tipo: body.tipo, tema, plataforma: body.plataforma, itens, criadoEm: new Date().toISOString() });
    dadosEmpresa().historico = dadosEmpresa().historico.slice(0, 50);
    salvarPostsNaGaleria(itens);
    saveState(); renderHistorico();
    toast(`${itens.length} itens gerados!`);
  } catch (err) { hideLoading(); $('ct-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

function renderConteudo(containerId, itens) {
  $(containerId).innerHTML = itens.map((item, idx) => `
    <div class="item-conteudo clickable" onclick="abrirModal('conteudo', ${idx}, ${esc(JSON.stringify(item).replace(/'/g,'&#39;'))}, '${containerId}')">
      <div class="gancho">${esc(item.gancho)}</div>
      <div class="copy">${esc((item.texto || '').slice(0, 200))}${(item.texto||'').length > 200 ? '...' : ''}</div>
      ${item.cta ? `<div class="cta-line">📢 ${esc(item.cta)}</div>` : ''}
      ${item.visual ? `<div class="meta">🎨 ${esc(item.visual)}</div>` : ''}
      <div class="expand-hint">Clique para expandir, melhorar e gerar imagem →</div>
    </div>`).join('');

  // Bind click events properly (the inline onclick with JSON is fragile, use data attrs)
  $(containerId).querySelectorAll('.item-conteudo.clickable').forEach((el, idx) => {
    el.onclick = () => abrirModal('conteudo', idx, itens[idx], containerId);
  });
}

function copiarTexto(id) { navigator.clipboard.writeText($(id).textContent); toast('Copiado!'); }

// ========== CALENDÁRIO ==========
async function gerarCalendario() {
  const body = {
    mes: parseInt($('cal-mes').value), ano: parseInt($('cal-ano').value),
    frequencia: $('cal-freq').value,
    plataformas: $('cal-plat').value.split(',').map(s => s.trim()).filter(Boolean),
    empresa: empresaAtual(),
  };
  showLoading('Planejando o mês inteiro...');
  try {
    const r = await postJSON('/api/calendario/gerar', body);
    hideLoading();
    if (!r.ok) return $('cal-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    dadosEmpresa().calendario = r.resultado; saveState();
    renderCalendario(); toast('Calendário pronto!');
  } catch (err) { hideLoading(); $('cal-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

function renderCalendario() {
  const a = dadosEmpresa().calendario; if (!a) return;
  const posts = a.posts || []; const datas = a.datasComemorativas || [];
  $('cal-resultado').innerHTML = `
    ${datas.length ? `<div class="cal-tags">${datas.map(d => `<span class="tag">${esc(d.data)} — ${esc(d.nome)}</span>`).join('')}</div>` : ''}
    ${posts.map((p, idx) => `
      <div class="cal-post clickable" data-idx="${idx}">
        <div class="cal-data">${esc(p.data)} · ${esc(p.plataforma)} · ${esc(p.tipo)}</div>
        <strong>${esc(p.tema)}</strong>
        <p style="margin:6px 0;">${esc(p.ideiaCopy)}</p>
        <div class="cal-data">🎯 ${esc(p.objetivo)} · <em style="color:#6b6b82;">Clique para expandir →</em></div>
      </div>`).join('')}`;

  // Bind cliques
  $('cal-resultado').querySelectorAll('.cal-post.clickable').forEach((el, idx) => {
    el.onclick = () => abrirModal('calendario', idx, posts[idx], 'cal-resultado');
  });
}

// ========== CONCORRENTES ==========
function addConc() {
  const lista = $('conc-lista'); if (lista.children.length >= 5) return toast('Máximo 5');
  const div = document.createElement('div'); div.className = 'conc-item';
  div.innerHTML = '<input placeholder="Nome" class="conc-nome"><input placeholder="https://site.com" class="conc-site">';
  lista.appendChild(div);
}

async function analisarConcorrentes() {
  const items = [...document.querySelectorAll('.conc-item')].map(el => ({ nome: el.querySelector('.conc-nome').value.trim(), site: el.querySelector('.conc-site').value.trim() })).filter(c => c.nome || c.site);
  if (!items.length) return toast('Adicione pelo menos um concorrente');
  showLoading('Analisando concorrentes...');
  try {
    const r = await postJSON('/api/concorrentes/analisar', { concorrentes: items, empresa: empresaAtual() });
    hideLoading();
    if (!r.ok) return $('conc-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    dadosEmpresa().concorrentes = r.resultado; saveState(); renderConcorrentes(); toast('Análise pronta!');
  } catch (err) { hideLoading(); $('conc-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

function renderConcorrentes() {
  const a = dadosEmpresa().concorrentes; if (!a) return;
  $('conc-resultado').innerHTML = `
    ${a.resumoMercado ? `<h4 style="margin-top:14px;color:#f472b6;font-size:13px;">RESUMO DO MERCADO</h4><p style="font-size:13px;color:#d4d4e0;">${esc(a.resumoMercado)}</p>` : ''}
    ${a.tendenciasDetectadas ? `<h4 style="margin-top:14px;color:#f472b6;font-size:13px;">TENDÊNCIAS</h4><ul style="font-size:13px;color:#d4d4e0;padding-left:18px;">${a.tendenciasDetectadas.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${a.palavrasChave ? `<h4 style="margin-top:14px;color:#f472b6;font-size:13px;">PALAVRAS-CHAVE</h4><div>${a.palavrasChave.map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''}
    ${(a.concorrentes||[]).map(c => `<div class="item-conteudo"><div class="gancho">${esc(c.nome)}</div><div class="copy"><strong>Fortes:</strong> ${(c.pontosFortes||[]).map(esc).join(', ')}<br><strong>Fracos:</strong> ${(c.pontosFracos||[]).map(esc).join(', ')}<br><strong>Aprender:</strong> ${esc(c.oQueAprender)}</div></div>`).join('')}
    ${a.oportunidadesDiferenciacao ? `<h4 style="margin-top:14px;color:#f472b6;font-size:13px;">OPORTUNIDADES</h4><ul style="font-size:13px;color:#d4d4e0;padding-left:18px;">${a.oportunidadesDiferenciacao.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${a.recomendacoes ? `<h4 style="margin-top:14px;color:#f472b6;font-size:13px;">RECOMENDAÇÕES</h4><ul style="font-size:13px;color:#d4d4e0;padding-left:18px;">${a.recomendacoes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
}

// ========== GERAR TUDO DE UMA VEZ ==========
async function gerarTudoDeUmaVez() {
  if (!confirm('Gerar: 5 posts + calendário do mês + análise. Leva ~2 minutos. Continuar?')) return;
  showLoading('Gerando pacote completo... (~2 minutos)');
  try {
    const [conteudoRes, calRes] = await Promise.all([
      postJSON('/api/conteudo/gerar', { tipo: 'post', plataforma: 'Instagram', quantidade: 5, objetivo: 'engajamento', tema: 'Conteúdo variado sobre a marca, serviços e bastidores', empresa: empresaAtual() }),
      postJSON('/api/calendario/gerar', { mes: new Date().getMonth() + 1, ano: new Date().getFullYear(), frequencia: '3x por semana', plataformas: ['Instagram', 'Facebook'], empresa: empresaAtual() }),
    ]);
    hideLoading();
    if (conteudoRes.ok) {
      renderConteudo('ct-resultado', conteudoRes.resultado.itens || []);
      dadosEmpresa().historico.unshift({ id: Date.now(), tipo: 'pacote completo', tema: 'Gerado automaticamente', plataforma: 'Instagram', itens: conteudoRes.resultado.itens, criadoEm: new Date().toISOString() });
    }
    if (calRes.ok) { dadosEmpresa().calendario = calRes.resultado; renderCalendario(); }
    saveState(); renderHistorico(); toast('Pacote completo pronto! ✨');
  } catch (err) { hideLoading(); alert('Erro: ' + err.message); }
}

// ========== HISTÓRICO ==========
function renderHistorico() {
  if (!dadosEmpresa().historico?.length) { $('historico-card').style.display = 'none'; return; }
  $('historico-card').style.display = 'block';
  $('historico-lista').innerHTML = dadosEmpresa().historico.slice(0, 10).map(h => {
    const d = new Date(h.criadoEm);
    return `<div class="historico-item" onclick="reabrirHistorico(${h.id})"><div><strong>${esc(h.tipo)}</strong> · ${esc(h.plataforma)} · ${esc(h.tema)}</div><div class="historico-data">${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR').slice(0,5)}</div></div>`;
  }).join('');
}
function reabrirHistorico(id) {
  const h = dadosEmpresa().historico.find(x => x.id === id);
  if (!h?.itens) return;
  renderConteudo('ct-resultado', h.itens);
  $('ct-resultado').scrollIntoView({ behavior: 'smooth' });
}

// ========== LINK DE IDEIAS (Answer The Public) ==========
async function explorarIdeias() {
  const tema = $('ideia-tema').value.trim();
  if (!tema) return toast('Informe o tema');
  showLoading('Mapeando árvore de ideias...');
  try {
    const r = await postJSON('/api/ideias/explorar', { tema, empresa: empresaAtual() });
    hideLoading();
    if (!r.ok) return $('ideia-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const d = r.resultado;
    const cats = d.perguntas || {};
    const catLabels = { oque: '🤔 O que...?', como: '🔧 Como...?', porque: '💡 Por que...?', quando: '📅 Quando...?', qual: '🏆 Qual...?' };
    $('ideia-resultado').innerHTML = `
      <div class="ideias-tree">
        ${Object.entries(cats).map(([key, pergs]) => `
          <div class="ideias-section">
            <h4>${catLabels[key] || key}</h4>
            <div class="ideias-perguntas">
              ${(pergs || []).map(p => `<div class="ideia-pergunta" onclick="usarIdeia(this)">${esc(p)}</div>`).join('')}
            </div>
          </div>`).join('')}

        ${d.subtemas?.length ? `
          <div class="ideias-section">
            <h4>🌿 Subtemas derivados</h4>
            <div>${d.subtemas.map(s => `<span class="tag" style="cursor:pointer;" onclick="$('ideia-tema').value='${esc(s)}';explorarIdeias();">${esc(s)}</span>`).join('')}</div>
          </div>` : ''}

        ${d.angulosDeConteudo?.length ? `
          <div class="ideias-section">
            <h4>🎯 Ângulos de conteúdo (${d.angulosDeConteudo.length} ideias)</h4>
            ${d.angulosDeConteudo.map(a => `
              <div class="ideia-angulo" style="cursor:pointer;" onclick="usarAnguloConteudo('${esc(a.titulo)}')">
                <strong>${esc(a.titulo)}</strong>
                <div class="angulo-meta">${esc(a.formato)} · ${esc(a.gancho)} · Potencial: ${esc(a.potencial)}</div>
              </div>`).join('')}
          </div>` : ''}

        ${d.palavrasChave?.length ? `
          <div class="ideias-section">
            <h4>🔑 Palavras-chave</h4>
            <div>${d.palavrasChave.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</div>
          </div>` : ''}

        ${d.tendencias?.length ? `
          <div class="ideias-section">
            <h4>📈 Tendências</h4>
            <div>${d.tendencias.map(t => `<span class="tag" style="background:rgba(244,114,182,.12);color:#f472b6;">${esc(t)}</span>`).join('')}</div>
          </div>` : ''}

        ${d.conexoes?.length ? `
          <div class="ideias-section">
            <h4>🔗 Conexões entre ideias</h4>
            <div>${d.conexoes.map(c => `<span class="conexao-item">${esc(c.de)} <span class="arrow">→</span> ${esc(c.para)} <span style="color:#6b6b82">(${esc(c.relacao)})</span></span>`).join('')}</div>
          </div>` : ''}
      </div>`;
    toast('Árvore de ideias mapeada!');
  } catch (err) { hideLoading(); $('ideia-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

function usarIdeia(el) {
  const tema = el.textContent;
  $('ct-tema').value = tema;
  document.querySelector('.module-card')?.scrollIntoView({ behavior: 'smooth' });
  toast('Ideia copiada pro Gerador de Conteúdo!');
}

function usarAnguloConteudo(titulo) {
  $('ct-tema').value = titulo;
  document.querySelector('.module-card')?.scrollIntoView({ behavior: 'smooth' });
  toast('Ângulo copiado pro Gerador de Conteúdo!');
}

// ========== GERADOR DE HASHTAGS ==========
async function gerarHashtags() {
  const tema = $('hash-tema').value.trim();
  if (!tema) return toast('Informe o tema');
  showLoading('Pesquisando hashtags estratégicas...');
  try {
    const r = await postJSON('/api/hashtags/gerar', { tema, plataforma: $('hash-plat').value, empresa: empresaAtual() });
    hideLoading();
    if (!r.ok) return $('hash-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const d = r.resultado;
    $('hash-resultado').innerHTML = `
      ${d.combinacaoIdeal ? `
        <div class="hashtag-group">
          <h4>📋 Combinação ideal (clique pra copiar)</h4>
          <div class="hashtag-combinacao" onclick="navigator.clipboard.writeText(this.textContent);toast('Hashtags copiadas!')">${esc(d.combinacaoIdeal)}</div>
        </div>` : ''}
      ${d.populares ? `<div class="hashtag-group"><h4>🚀 Alto alcance</h4><div>${d.populares.map(h => `<span class="tag">${esc(h)}</span>`).join('')}</div></div>` : ''}
      ${d.medias ? `<div class="hashtag-group"><h4>💬 Engajamento</h4><div>${d.medias.map(h => `<span class="tag">${esc(h)}</span>`).join('')}</div></div>` : ''}
      ${d.nichadas ? `<div class="hashtag-group"><h4>🎯 Nicho/conversão</h4><div>${d.nichadas.map(h => `<span class="tag">${esc(h)}</span>`).join('')}</div></div>` : ''}
      ${d.proibidas ? `<div class="hashtag-group"><h4>⚠️ Evitar (risco de shadowban)</h4><div>${d.proibidas.map(h => `<span class="tag" style="background:rgba(248,113,113,.12);color:#f87171;">${esc(h)}</span>`).join('')}</div></div>` : ''}
      ${d.dica ? `<div style="margin-top:12px;font-size:12px;color:#8a8aa0;font-style:italic;">💡 ${esc(d.dica)}</div>` : ''}`;
    toast('Hashtags prontas!');
  } catch (err) { hideLoading(); $('hash-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

// ========== BRIEFING DE DESIGN ==========
async function gerarBriefing() {
  const tema = $('brief-tema').value.trim();
  if (!tema) return toast('Informe o tema');
  showLoading('Criando briefing visual...');
  try {
    const r = await postJSON('/api/briefing/gerar', { tipo: $('brief-tipo').value, tema, plataforma: $('brief-plat').value, empresa: empresaAtual() });
    hideLoading();
    if (!r.ok) return $('brief-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const d = r.resultado;
    $('brief-resultado').innerHTML = `
      <div class="brief-grid">
        ${d.formato ? `<div class="brief-item"><h4>📐 Formato</h4><p>${esc(d.formato.largura)} × ${esc(d.formato.altura)}<br>${esc(d.formato.orientacao)}</p></div>` : ''}
        ${d.mood ? `<div class="brief-item"><h4>🎭 Mood</h4><p>${esc(d.mood)}</p></div>` : ''}
        ${d.layout ? `<div class="brief-item" style="grid-column:1/-1;"><h4>📋 Layout</h4><p>${esc(d.layout)}</p></div>` : ''}
        ${d.tipografia ? `<div class="brief-item"><h4>🔤 Tipografia</h4><p><strong>Título:</strong> ${esc(d.tipografia.titulo)}<br><strong>Corpo:</strong> ${esc(d.tipografia.corpo)}<br><strong>Destaque:</strong> ${esc(d.tipografia.destaque)}</p></div>` : ''}
        ${d.paleta ? `<div class="brief-item"><h4>🎨 Paleta</h4><div class="paleta-preview">${d.paleta.map(c => `<div class="paleta-cor" style="background:${esc(c)};" data-hex="${esc(c)}" onclick="navigator.clipboard.writeText('${esc(c)}');toast('Cor copiada!')"></div>`).join('')}</div></div>` : ''}
        ${d.hierarquia ? `<div class="brief-item" style="grid-column:1/-1;"><h4>📊 Hierarquia visual</h4><p>${esc(d.hierarquia)}</p></div>` : ''}
        ${d.elementosVisuais ? `<div class="brief-item"><h4>✨ Elementos</h4><ul style="font-size:13px;padding-left:16px;">${d.elementosVisuais.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        ${d.referencias ? `<div class="brief-item"><h4>🖼️ Referências</h4><p>${esc(d.referencias)}</p></div>` : ''}
        ${d.naoFazer ? `<div class="brief-item" style="grid-column:1/-1;"><h4>🚫 Não fazer</h4><ul style="font-size:13px;padding-left:16px;color:#f87171;">${d.naoFazer.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        ${d.arquivosSugeridos ? `<div class="brief-item" style="grid-column:1/-1;"><h4>📂 Arquivos necessários</h4><ul style="font-size:13px;padding-left:16px;">${d.arquivosSugeridos.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      </div>`;
    toast('Briefing pronto!');
  } catch (err) { hideLoading(); $('brief-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

// ========== RECICLADOR DE CONTEÚDO ==========
async function reciclarConteudo() {
  const texto = $('reciclar-texto').value.trim();
  if (!texto) return toast('Cole o conteúdo original');
  showLoading('Transformando em 6 formatos...');
  try {
    const r = await postJSON('/api/reciclar/gerar', { conteudoOriginal: texto, formatoOriginal: $('reciclar-formato').value, empresa: empresaAtual() });
    hideLoading();
    if (!r.ok) return $('reciclar-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const fmts = r.resultado.formatos || [];
    $('reciclar-resultado').innerHTML = fmts.map(f => {
      let corpo = '';
      if (f.slides) corpo = f.slides.map((s,i) => `<strong>Slide ${i+1}:</strong> ${esc(s)}`).join('<br>');
      else if (f.sequencia) corpo = f.sequencia.map((s,i) => `<strong>Story ${i+1}:</strong> ${esc(s)}`).join('<br>');
      else if (f.tweets) corpo = f.tweets.map((t,i) => `<strong>${i+1}.</strong> ${esc(t)}`).join('<br>');
      else if (f.roteiro) corpo = esc(f.roteiro);
      else if (f.topicos) corpo = `<strong>${esc(f.titulo)}</strong><br>${esc(f.introducao)}<br><br>${f.topicos.map(t => `• ${esc(t)}`).join('<br>')}<br><br>${esc(f.conclusao || '')}`;
      else corpo = esc(f.texto || f.legenda || '');
      return `
        <div class="reciclar-formato">
          <h4>${esc(f.plataforma)}</h4>
          <span class="plat-badge">${esc(f.tipo)}</span>
          <div class="texto-fmt">${corpo}</div>
          ${f.hashtags ? `<div class="meta" style="margin-top:8px;">${esc(f.hashtags)}</div>` : ''}
          ${f.cta ? `<div class="cta-line" style="margin-top:8px;">📢 ${esc(f.cta)}</div>` : ''}
          ${f.audio ? `<div class="meta" style="margin-top:8px;">🎵 ${esc(f.audio)}</div>` : ''}
          ${f.duracao ? `<div class="meta">⏱ ${esc(f.duracao)}</div>` : ''}
          <button class="copy-btn" style="margin-top:8px;" onclick="navigator.clipboard.writeText(this.closest('.reciclar-formato').querySelector('.texto-fmt').textContent);toast('Copiado!')">📋 Copiar</button>
        </div>`;
    }).join('');
    toast(`${fmts.length} formatos gerados!`);
  } catch (err) { hideLoading(); $('reciclar-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

// ========== GERADOR DE BIO ==========
async function gerarBios() {
  showLoading('Criando bios para todas as redes...');
  try {
    const r = await postJSON('/api/bio/gerar', { empresa: empresaAtual() });
    hideLoading();
    if (!r.ok) return $('bio-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const d = r.resultado;
    const redes = [
      { key: 'instagram', icon: '📸', nome: 'Instagram', field: 'bio' },
      { key: 'facebook', icon: '👥', nome: 'Facebook', field: 'sobre' },
      { key: 'linkedin', icon: '💼', nome: 'LinkedIn', field: 'sobre' },
      { key: 'tiktok', icon: '🎵', nome: 'TikTok', field: 'bio' },
      { key: 'whatsapp', icon: '📱', nome: 'WhatsApp Business', field: 'descricao' },
      { key: 'googleMeuNegocio', icon: '📍', nome: 'Google Meu Negócio', field: 'descricao' },
    ];
    $('bio-resultado').innerHTML = redes.map(r => {
      const data = d[r.key];
      if (!data) return '';
      const mainText = data[r.field] || data.bio || data.sobre || data.descricao || data.titulo || '';
      const extras = Object.entries(data).filter(([k]) => k !== r.field && k !== 'dica').map(([k,v]) => `<div style="margin-top:6px;"><strong style="font-size:11px;color:#8a8aa0;text-transform:uppercase;">${esc(k)}:</strong><div class="bio-text" onclick="navigator.clipboard.writeText(this.textContent);toast('Copiado!')">${esc(v)}</div></div>`).join('');
      return `
        <div class="bio-card">
          <h4>${r.icon} ${r.nome}</h4>
          <div class="bio-text" onclick="navigator.clipboard.writeText(this.textContent);toast('Copiado!')">${esc(mainText)}</div>
          ${extras}
          ${data.dica ? `<div class="bio-dica">💡 ${esc(data.dica)}</div>` : ''}
        </div>`;
    }).join('');
    toast('Bios prontas para todas as redes!');
  } catch (err) { hideLoading(); $('bio-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

// ========== GALERIA DE PROJETOS ==========
function toggleView(view) {
  const views = ['view-modulos', 'view-galeria', 'view-conexoes', 'view-agenda', 'view-perfil'];
  const btns = ['btn-modulos', 'btn-galeria', 'btn-conexoes', 'btn-agenda', 'btn-perfil'];
  views.forEach(v => { const el = $(v); if (el) el.style.display = 'none'; });
  btns.forEach(b => { const el = $(b); if (el) el.style.display = ''; });

  if (view === 'galeria') {
    $('view-galeria').style.display = 'block';
    $('btn-galeria').style.display = 'none';
    renderGaleria();
  } else if (view === 'conexoes') {
    $('view-conexoes').style.display = 'block';
    $('btn-conexoes').style.display = 'none';
    carregarConexoes();
  } else if (view === 'agenda') {
    $('view-agenda').style.display = 'block';
    $('btn-agenda').style.display = 'none';
    carregarAgendamentos();
  } else if (view === 'perfil') {
    $('view-perfil').style.display = 'block';
    $('btn-perfil').style.display = 'none';
    renderPerfilCompleto();
  } else {
    $('view-modulos').style.display = '';
    $('btn-modulos').style.display = 'none';
  }
}

function salvarNaGaleria(item) {
  if (!dadosEmpresa().galeria) dadosEmpresa().galeria = [];
  dadosEmpresa().galeria.unshift({
    id: Date.now(),
    ...item,
    criadoEm: new Date().toISOString(),
  });
  dadosEmpresa().galeria = dadosEmpresa().galeria.slice(0, 200);
  saveState();
}

// Salva posts automaticamente na galeria quando gera conteudo
const _origRenderConteudo = renderConteudo;
// Hook: salvar na galeria quando gera conteudo
function salvarPostsNaGaleria(itens) {
  for (const item of (itens || [])) {
    salvarNaGaleria({
      tipo: 'post',
      titulo: item.gancho || 'Post',
      descricao: (item.texto || '').slice(0, 150),
      textoCompleto: item.texto,
      cta: item.cta,
      hashtags: item.hashtags,
      visual: item.visual,
    });
  }
}

function filtrarGaleria(filtro) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.filter-btn[data-filter="${filtro}"]`)?.classList.add('active');
  renderGaleria(filtro);
}

function renderGaleria(filtro = 'todos') {
  const items = dadosEmpresa().galeria || [];
  const cal = dadosEmpresa().calendario?.posts || [];

  // Monta lista unificada
  let todos = [...items];

  // Adiciona posts do calendario se tem
  if (filtro === 'todos' || filtro === 'calendario') {
    cal.forEach((p, idx) => {
      if (!todos.find(x => x.tipo === 'calendario' && x.titulo === p.tema)) {
        todos.push({
          id: `cal-${idx}`, tipo: 'calendario',
          titulo: p.tema, descricao: p.ideiaCopy,
          data: p.data, plataforma: p.plataforma,
          criadoEm: dadosEmpresa().calendario?.criadoEm || new Date().toISOString(),
        });
      }
    });
  }

  // Filtra por tipo
  if (filtro === 'imagens') todos = todos.filter(x => x.tipo === 'imagem');
  else if (filtro === 'posts') todos = todos.filter(x => x.tipo === 'post');
  else if (filtro === 'calendario') todos = todos.filter(x => x.tipo === 'calendario');

  // Filtra por pasta
  const pastaFiltro = $('filtro-pasta')?.value || 'todas';
  if (pastaFiltro !== 'todas') {
    todos = todos.filter(x => (x.pasta || 'Geral') === pastaFiltro);
  }

  // Atualiza dropdown de pastas
  const pastaSelect = $('filtro-pasta');
  if (pastaSelect) {
    const current = pastaSelect.value;
    pastaSelect.innerHTML = '<option value="todas">📂 Todas as pastas</option>' +
      (dadosEmpresa().pastas || []).map(p => `<option value="${esc(p)}" ${p === current ? 'selected' : ''}>${esc(p)}</option>`).join('');
  }

  // Stats
  const totalImgs = (dadosEmpresa().galeria || []).filter(x => x.tipo === 'imagem').length;
  const totalPosts = (dadosEmpresa().galeria || []).filter(x => x.tipo === 'post').length;
  const totalCal = cal.length;
  $('galeria-stats').innerHTML = `
    <div class="stat-card"><div class="stat-num">${items.length + totalCal}</div><div class="stat-label">Total criados</div></div>
    <div class="stat-card"><div class="stat-num">${totalImgs}</div><div class="stat-label">Imagens</div></div>
    <div class="stat-card"><div class="stat-num">${totalPosts}</div><div class="stat-label">Posts</div></div>
    <div class="stat-card"><div class="stat-num">${totalCal}</div><div class="stat-label">Calendário</div></div>
  `;

  // Grid
  if (!todos.length) {
    $('galeria-grid').innerHTML = '';
    $('galeria-vazio').style.display = '';
    return;
  }
  $('galeria-vazio').style.display = 'none';

  $('galeria-grid').innerHTML = todos.map(item => {
    const d = item.criadoEm ? new Date(item.criadoEm) : new Date();
    const dataStr = d.toLocaleDateString('pt-BR');
    const icons = { imagem: '🖼️', post: '✏️', calendario: '📅' };
    const colors = { imagem: '#f472b6', post: '#c084fc', calendario: '#4ade80' };
    const isCal = String(item.id).startsWith('cal-');
    const sel = selecionados.has(item.id);
    const pasta = item.pasta && item.pasta !== 'Geral' ? item.pasta : '';

    return `
      <div class="galeria-card ${sel ? 'selecionado' : ''}" onclick="clickCard('${item.id}', event)" data-id="${item.id}">
        <div class="card-checkbox" onclick="event.stopPropagation();toggleSelecionado('${item.id}')">${sel ? '✓' : ''}</div>
        ${!isCal ? `<div class="card-actions">
          <button class="card-act-btn" onclick="event.stopPropagation();editarItemGaleria('${item.id}')" title="Editar">✏️</button>
          <button class="card-act-btn act-danger" onclick="event.stopPropagation();excluirItemGaleria('${item.id}')" title="Excluir">🗑️</button>
        </div>` : ''}
        ${item.imageUrl
          ? `<div class="galeria-card-img"><img src="${esc(item.imageUrl)}" alt="${esc(item.titulo)}" loading="lazy"></div>`
          : `<div class="galeria-card-placeholder">${icons[item.tipo] || '📄'}</div>`}
        <div class="galeria-card-body">
          <h4>${esc(item.titulo)}</h4>
          <p>${esc(item.descricao || '')}</p>
        </div>
        ${pasta ? `<span class="card-pasta-badge">📂 ${esc(pasta)}</span>` : ''}
        <div class="galeria-card-footer">
          <span class="galeria-card-date">${dataStr}</span>
          <span class="galeria-card-badge" style="background:${colors[item.tipo] || '#c084fc'}22;color:${colors[item.tipo] || '#c084fc'};">
            ${icons[item.tipo] || '📄'} ${item.tipo}
          </span>
        </div>
      </div>`;
  }).join('');
}

function abrirItemGaleria(id) {
  const item = (dadosEmpresa().galeria || []).find(x => String(x.id) === String(id));
  if (!item) {
    // Pode ser calendario
    if (String(id).startsWith('cal-')) {
      const idx = parseInt(String(id).replace('cal-', ''));
      const posts = dadosEmpresa().calendario?.posts || [];
      if (posts[idx]) {
        abrirModal('calendario', idx, posts[idx], 'cal-resultado');
        return;
      }
    }
    return;
  }

  if (item.tipo === 'imagem') {
    // Abre modal com a imagem
    abrirModal('conteudo', 0, {
      gancho: item.titulo,
      texto: item.textoPost || item.descricao || '',
      visual: item.descricao || '',
      cta: '', hashtags: '',
    }, 'ct-resultado');
    // Injeta a imagem no modal
    setTimeout(() => {
      $('modal-imagem').innerHTML = `
        <div class="img-result">
          <img src="${esc(item.imageUrl)}" alt="${esc(item.titulo)}" style="max-width:100%;border-radius:12px;">
          ${item.modelo ? `<div class="img-modelo">Gerada com ${esc(item.modelo)}</div>` : ''}
          <div class="img-actions">
            <a href="${esc(item.imageUrl)}" download="post-image.png" class="btn-secondary" style="text-decoration:none;display:inline-block;">⬇ Baixar</a>
            <button class="btn-ai" onclick="modalGerarImagem()">🔄 Gerar outra</button>
          </div>
        </div>`;
    }, 100);
  } else if (item.tipo === 'post') {
    abrirModal('conteudo', 0, {
      gancho: item.titulo,
      texto: item.textoCompleto || item.descricao || '',
      cta: item.cta || '',
      hashtags: item.hashtags || '',
      visual: item.visual || '',
    }, 'ct-resultado');
  }
}

// ========== GERENCIAMENTO DA GALERIA ==========
function clickCard(id, event) {
  if (modoGerenciar) { toggleSelecionado(id); }
  else { abrirItemGaleria(id); }
}

function toggleGerenciar() {
  modoGerenciar = !modoGerenciar;
  selecionados.clear();
  $('galeria-grid').classList.toggle('gerenciando', modoGerenciar);
  $('btn-gerenciar').textContent = modoGerenciar ? '✕ Cancelar' : '☑️ Selecionar';
  $('galeria-sel-count').classList.toggle('hidden', !modoGerenciar);
  $('btn-excluir-sel').classList.toggle('hidden', !modoGerenciar);
  $('btn-mover-sel').classList.toggle('hidden', !modoGerenciar);
  atualizarContagem();
  renderGaleria();
}

function toggleSelecionado(id) {
  selecionados.has(id) ? selecionados.delete(id) : selecionados.add(id);
  atualizarContagem();
  renderGaleria();
}

function atualizarContagem() {
  const el = $('galeria-sel-count');
  if (el) el.textContent = `${selecionados.size} selecionados`;
}

function excluirItemGaleria(id) {
  if (!confirm('Tem certeza que deseja excluir este item?')) return;
  dadosEmpresa().galeria = (dadosEmpresa().galeria || []).filter(x => String(x.id) !== String(id));
  saveState();
  renderGaleria();
  toast('Item excluído!');
}

function excluirSelecionados() {
  if (!selecionados.size) return toast('Nenhum item selecionado');
  if (!confirm(`Excluir ${selecionados.size} itens permanentemente?`)) return;
  dadosEmpresa().galeria = (dadosEmpresa().galeria || []).filter(x => !selecionados.has(x.id));
  saveState();
  selecionados.clear();
  atualizarContagem();
  renderGaleria();
  toast('Itens excluídos!');
}

function editarItemGaleria(id) {
  const item = (dadosEmpresa().galeria || []).find(x => String(x.id) === String(id));
  if (!item) return;

  modalAtual = {
    source: 'galeria-edit',
    galeriaId: id,
    item: { ...item },
    index: 0,
    containerId: null,
  };
  $('modal-titulo').textContent = '✏️ Editar item';
  $('modal-gancho').value = item.titulo || '';
  $('modal-texto').value = item.textoCompleto || item.textoPost || item.descricao || '';
  $('modal-cta').value = item.cta || '';
  $('modal-hashtags').value = item.hashtags || '';
  $('modal-visual').value = item.visual || item.descricao || '';
  $('modal-variacoes').innerHTML = '';
  $('modal-imagem').innerHTML = item.imageUrl
    ? `<div class="img-result"><img src="${esc(item.imageUrl)}" alt="${esc(item.titulo)}" style="max-width:100%;border-radius:12px;"></div>`
    : '';
  $('modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function moverSelecionados() {
  if (!selecionados.size) return toast('Nenhum item selecionado');
  const pastas = dadosEmpresa().pastas || ['Geral'];
  const pasta = prompt('Mover para qual pasta?\n\nPastas disponíveis:\n• ' + pastas.join('\n• ') + '\n\nDigite o nome (ou um novo para criar):');
  if (!pasta) return;
  if (!pastas.includes(pasta)) {
    dadosEmpresa().pastas.push(pasta);
  }
  dadosEmpresa().galeria.forEach(item => {
    if (selecionados.has(item.id)) item.pasta = pasta;
  });
  saveState();
  selecionados.clear();
  atualizarContagem();
  renderGaleria();
  toast(`${selecionados.size || 'Itens'} movidos para "${pasta}"!`);
}

function gerenciarPastas() {
  const pastas = dadosEmpresa().pastas || ['Geral'];
  const acao = prompt(
    '📂 Gerenciar Pastas\n\n' +
    'Pastas atuais: ' + pastas.join(', ') + '\n\n' +
    'Digite:\n' +
    '+ Nome  → criar pasta\n' +
    '- Nome  → excluir pasta\n' +
    '> Antigo > Novo  → renomear pasta'
  );
  if (!acao) return;

  if (acao.startsWith('+')) {
    const nome = acao.slice(1).trim();
    if (nome && !pastas.includes(nome)) {
      dadosEmpresa().pastas.push(nome);
      toast(`Pasta "${nome}" criada!`);
    } else if (pastas.includes(nome)) {
      toast('Pasta já existe!');
    }
  } else if (acao.startsWith('-')) {
    const nome = acao.slice(1).trim();
    if (nome === 'Geral') return toast('Não pode excluir a pasta padrão');
    if (!pastas.includes(nome)) return toast('Pasta não encontrada');
    dadosEmpresa().pastas = pastas.filter(p => p !== nome);
    dadosEmpresa().galeria.forEach(item => { if (item.pasta === nome) item.pasta = 'Geral'; });
    toast(`Pasta "${nome}" excluída!`);
  } else if (acao.includes('>')) {
    const partes = acao.split('>').map(s => s.trim());
    if (partes.length >= 2) {
      const antigo = partes[0], novo = partes[1];
      const idx = pastas.indexOf(antigo);
      if (idx >= 0 && novo) {
        dadosEmpresa().pastas[idx] = novo;
        dadosEmpresa().galeria.forEach(item => { if (item.pasta === antigo) item.pasta = novo; });
        toast(`Pasta renomeada para "${novo}"!`);
      } else {
        toast('Pasta não encontrada');
      }
    }
  } else {
    toast('Comando não reconhecido. Use +, - ou >');
  }
  saveState();
  renderGaleria();
}

// ========== CAMPANHA COMPLETA ==========
async function gerarCampanha() {
  const tema = $('camp-tema').value.trim();
  if (!tema) return toast('Informe o tema da campanha');
  showLoading('Criando campanha completa...');
  try {
    const r = await postJSON('/api/campanha/gerar', {
      tema, objetivo: $('camp-objetivo').value.trim(),
      duracao: $('camp-duracao').value.trim(),
      orcamento: $('camp-orcamento').value.trim(),
      plataformas: $('camp-plats').value.split(',').map(s => s.trim()).filter(Boolean),
      empresa: empresaAtual()
    });
    hideLoading();
    if (!r.ok) return $('camp-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const d = r.resultado;
    $('camp-resultado').innerHTML = `
      <div class="campanha-resultado">
        <div class="camp-hero"><h2>${esc(d.nomeCampanha)}</h2><p>${esc(d.conceito)}</p></div>
        <div class="camp-info-row">
          <div class="camp-info"><strong>Público</strong><p>${esc(d.publicoAlvo)}</p></div>
          <div class="camp-info"><strong>Mensagem-chave</strong><p>${esc(d.mensagemChave)}</p></div>
          <div class="camp-info"><strong>Hashtags</strong><p>${esc(d.hashtags)}</p></div>
        </div>
        ${d.cronograma ? `<h4>📅 Cronograma</h4><div class="camp-timeline">${d.cronograma.map(c => `<div class="timeline-item"><span class="timeline-dia">${esc(c.dia)}</span><span class="timeline-plat">${esc(c.plataforma)} · ${esc(c.formato)}</span><p>${esc(c.acao)}</p></div>`).join('')}</div>` : ''}
        ${d.pecas ? `<h4>📝 Peças Criativas (${d.pecas.length})</h4>${d.pecas.map(p => `
          <div class="peca-card">
            <div class="peca-header"><span class="peca-plat">${esc(p.plataforma)}</span><span class="peca-fmt">${esc(p.formato)} · ${esc(p.dimensoes || '')}</span></div>
            <h5>${esc(p.titulo)}</h5>
            <p class="peca-texto">${esc(p.texto)}</p>
            ${p.cta ? `<div class="peca-cta">${esc(p.cta)}</div>` : ''}
            ${p.hashtags ? `<div class="peca-hash">${esc(p.hashtags)}</div>` : ''}
            ${p.direcaoVisual ? `<div class="peca-visual">🎨 ${esc(p.direcaoVisual)}</div>` : ''}
            <button class="btn-ghost-sm" onclick="navigator.clipboard.writeText(\`${esc(p.texto).replace(/`/g,"'")}\n\n${esc(p.cta || '')}\n${esc(p.hashtags || '')}\`);toast('Copiado!')">📋 Copiar</button>
          </div>`).join('')}` : ''}
        ${d.emailMarketing ? `<h4>📧 Email Marketing</h4><div class="peca-card"><strong>Assunto:</strong> ${esc(d.emailMarketing.assunto)}<br><strong>Preheader:</strong> ${esc(d.emailMarketing.preheader || '')}<p style="margin-top:8px;">${esc(d.emailMarketing.corpo)}</p><div class="peca-cta">${esc(d.emailMarketing.cta)}</div></div>` : ''}
        ${d.kpis ? `<h4>📊 KPIs</h4><ul>${d.kpis.map(k => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
        ${d.investimento ? `<h4>💰 Investimento</h4><p>${esc(d.investimento.sugestao)}</p>` : ''}
      </div>`;
    toast('Campanha criada!');
  } catch (err) { hideLoading(); $('camp-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

// ========== GOOGLE ADS ==========
async function gerarGoogleAds() {
  const produto = $('gads-produto').value.trim();
  if (!produto) return toast('Informe o produto ou serviço');
  showLoading('Gerando anúncios Google Ads...');
  try {
    const r = await postJSON('/api/googleads/gerar', {
      produto, objetivo: $('gads-objetivo').value.trim(),
      quantidade: $('gads-qtd').value, empresa: empresaAtual()
    });
    hideLoading();
    if (!r.ok) return $('gads-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const d = r.resultado;
    $('gads-resultado').innerHTML = `
      ${d.estrategia ? `<div class="camp-info" style="margin-bottom:16px;"><strong>📊 Estratégia</strong><p>${esc(d.estrategia)}</p>${d.orcamentoDiario ? `<p><strong>Orçamento diário sugerido:</strong> ${esc(d.orcamentoDiario)}</p>` : ''}</div>` : ''}
      ${(d.anuncios || []).map((a, i) => `
        <div class="peca-card">
          <div class="peca-header"><span class="peca-plat">Anúncio ${i+1}</span><span class="peca-fmt">${esc(a.tipo)}</span></div>
          <h5>Títulos</h5>
          ${a.titulos.map(t => `<div class="ads-titulo">${esc(t)} <span class="char-count">${t.length}/30</span></div>`).join('')}
          <h5 style="margin-top:12px;">Descrições</h5>
          ${a.descricoes.map(d => `<div class="ads-desc">${esc(d)} <span class="char-count">${d.length}/90</span></div>`).join('')}
          ${a.palavrasChave ? `<h5 style="margin-top:12px;">Keywords</h5><div class="hash-tags">${a.palavrasChave.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</div>` : ''}
          ${a.extensoes?.callouts ? `<h5 style="margin-top:12px;">Callouts</h5><div class="hash-tags">${a.extensoes.callouts.map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div>` : ''}
          ${a.dica ? `<p class="peca-visual">💡 ${esc(a.dica)}</p>` : ''}
        </div>`).join('')}`;
    toast('Anúncios gerados!');
  } catch (err) { hideLoading(); $('gads-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

// ========== EMAIL MARKETING ==========
async function gerarEmail() {
  const tema = $('email-tema').value.trim();
  if (!tema) return toast('Informe o tema do email');
  showLoading('Criando email marketing...');
  try {
    const r = await postJSON('/api/email/gerar', {
      tema, tipo: $('email-tipo').value, objetivo: $('email-obj').value.trim(),
      empresa: empresaAtual()
    });
    hideLoading();
    if (!r.ok) return $('email-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const d = r.resultado;
    const corpo = d.corpo || {};
    $('email-resultado').innerHTML = `
      <div class="email-preview">
        <div class="email-header-preview">
          <div class="email-from">${esc(d.remetente?.nome || 'Empresa')} &lt;${esc(d.remetente?.sugestaoEmail || '')}&gt;</div>
          <div class="email-subject"><strong>Assunto:</strong> ${esc(d.assunto)}</div>
          <div class="email-preheader">${esc(d.preheader || '')}</div>
          ${d.assuntosAlternativos ? `<div class="email-alt"><strong>A/B Test:</strong> ${d.assuntosAlternativos.map(a => `"${esc(a)}"`).join(' | ')}</div>` : ''}
        </div>
        <div class="email-body-preview">
          <p>${esc(corpo.saudacao || '')}</p>
          <p>${esc(corpo.introducao || '')}</p>
          <p>${esc(corpo.conteudoPrincipal || '')}</p>
          ${corpo.prova ? `<blockquote>${esc(corpo.prova)}</blockquote>` : ''}
          ${corpo.cta ? `<div class="email-cta-btn" style="background:${esc(corpo.cta.cor || '#c084fc')}">${esc(corpo.cta.texto)}</div>` : ''}
          ${corpo.ps ? `<p class="email-ps">${esc(corpo.ps)}</p>` : ''}
        </div>
        ${d.designSugerido ? `<div class="camp-info" style="margin-top:16px;"><strong>🎨 Design sugerido</strong><p>Layout: ${esc(d.designSugerido.layout || '')}<br>Header: ${esc(d.designSugerido.header || '')}</p>${d.designSugerido.paleta ? `<div class="paleta-preview">${d.designSugerido.paleta.map(c => `<div class="paleta-cor" style="background:${esc(c)}" onclick="navigator.clipboard.writeText('${esc(c)}');toast('Cor copiada!')"></div>`).join('')}</div>` : ''}</div>` : ''}
        ${d.melhorHorario ? `<p style="margin-top:12px;font-size:12px;color:#8a8aa0;">⏰ Melhor horário: ${esc(d.melhorHorario)}</p>` : ''}
      </div>`;
    toast('Email criado!');
  } catch (err) { hideLoading(); $('email-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

// ========== YOUTUBE THUMBNAIL ==========
async function gerarThumbnail() {
  const titulo = $('thumb-titulo').value.trim();
  if (!titulo) return toast('Informe o título do vídeo');
  showLoading('Criando briefing de thumbnail...');
  try {
    const r = await postJSON('/api/thumbnail/gerar', {
      tituloVideo: titulo, estilo: $('thumb-estilo').value.trim(),
      empresa: empresaAtual()
    });
    hideLoading();
    if (!r.ok) return $('thumb-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const d = r.resultado;
    $('thumb-resultado').innerHTML = `
      <div class="brief-grid">
        <div class="brief-item" style="grid-column:1/-1;"><h4>🎯 Conceito</h4><p>${esc(d.conceito)}</p></div>
        <div class="brief-item"><h4>📝 Texto overlay</h4><p style="font-size:20px;font-weight:800;">${esc(d.elementos?.textoOverlay || '')}</p><p style="font-size:11px;color:#8a8aa0;">${esc(d.elementos?.fonteEstilo || '')}</p></div>
        <div class="brief-item"><h4>🎨 Cor dominante</h4><div style="width:60px;height:60px;border-radius:12px;background:${esc(d.elementos?.corDominante || '#c084fc')};margin:8px 0;"></div><p>${esc(d.elementos?.corDominante || '')}</p></div>
        ${d.paleta ? `<div class="brief-item"><h4>🎨 Paleta</h4><div class="paleta-preview">${d.paleta.map(c => `<div class="paleta-cor" style="background:${esc(c)}" onclick="navigator.clipboard.writeText('${esc(c)}');toast('Cor copiada!')"></div>`).join('')}</div></div>` : ''}
        <div class="brief-item"><h4>📐 Composição</h4><p>${esc(d.composicao || '')}</p></div>
        ${d.elementos?.fundoDescricao ? `<div class="brief-item"><h4>🖼️ Fundo</h4><p>${esc(d.elementos.fundoDescricao)}</p></div>` : ''}
        ${d.elementos?.elementosGraficos ? `<div class="brief-item"><h4>✨ Elementos gráficos</h4><ul style="font-size:13px;padding-left:16px;">${d.elementos.elementosGraficos.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        ${d.referenciasEstilo ? `<div class="brief-item" style="grid-column:1/-1;"><h4>🖼️ Referências</h4><p>${esc(d.referenciasEstilo)}</p></div>` : ''}
        ${d.naoFazer ? `<div class="brief-item" style="grid-column:1/-1;"><h4>🚫 Não fazer</h4><ul style="font-size:13px;padding-left:16px;color:#f87171;">${d.naoFazer.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      </div>
      ${d.promptImagem ? `<div style="margin-top:16px;"><button class="btn-primary" onclick="gerarImagemThumb()">🎨 Gerar imagem da thumbnail</button><input type="hidden" id="thumb-prompt" value="${esc(d.promptImagem)}"></div>` : ''}`;
    toast('Briefing de thumbnail pronto!');
  } catch (err) { hideLoading(); $('thumb-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

async function gerarImagemThumb() {
  const prompt = $('thumb-prompt')?.value;
  if (!prompt) return;
  showLoading('Gerando imagem da thumbnail...');
  try {
    const r = await postJSON('/api/imagem/gerar', { descricao: prompt, empresa: empresaAtual() });
    hideLoading();
    if (r.imageUrl) {
      $('thumb-resultado').innerHTML += `<div class="img-result" style="margin-top:16px;"><img src="${esc(r.imageUrl)}" style="max-width:100%;border-radius:12px;"><div class="img-actions" style="margin-top:8px;"><a href="${esc(r.imageUrl)}" download="thumbnail.png" class="btn-secondary" style="text-decoration:none;">⬇ Baixar</a></div></div>`;
      salvarNaGaleria({ tipo: 'imagem', titulo: 'YouTube Thumbnail', descricao: prompt, imageUrl: r.imageUrl, modelo: r.modelo });
      saveState();
      toast('Thumbnail gerada!');
    }
  } catch (err) { hideLoading(); toast('Erro ao gerar imagem: ' + err.message); }
}

// ========== PHOTOSHOOT IA ==========
async function gerarPhotoshoot() {
  const desc = $('photo-desc').value.trim();
  if (!desc) return toast('Descreva o produto');
  showLoading('Criando foto profissional...');
  try {
    const r = await postJSON('/api/photoshoot/gerar', {
      descricaoProduto: desc, estilo: $('photo-estilo').value,
      cenario: $('photo-cenario').value.trim(), empresa: empresaAtual()
    });
    hideLoading();
    if (!r.ok) return $('photo-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    $('photo-resultado').innerHTML = `
      <div class="img-result">
        <img src="${esc(r.imageUrl)}" style="max-width:100%;border-radius:12px;">
        <div class="img-modelo">Gerada com ${esc(r.modelo || 'Gemini')}</div>
        <div class="img-actions">
          <a href="${esc(r.imageUrl)}" download="photoshoot.png" class="btn-secondary" style="text-decoration:none;">⬇ Baixar</a>
          <button class="btn-ai" onclick="gerarPhotoshoot()">🔄 Gerar outra</button>
        </div>
      </div>`;
    salvarNaGaleria({ tipo: 'imagem', titulo: 'Photoshoot: ' + desc, descricao: $('photo-estilo').value, imageUrl: r.imageUrl, modelo: r.modelo });
    saveState();
    toast('Foto profissional gerada!');
  } catch (err) { hideLoading(); $('photo-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

// ========== EDITOR INTELIGENTE (LINGUAGEM NATURAL) ==========
async function editarNatural() {
  const original = $('edit-original').value.trim();
  const instrucao = $('edit-instrucao').value.trim();
  if (!original) return toast('Cole o texto original');
  if (!instrucao) return toast('Diga o que quer mudar');
  showLoading('Aplicando edição...');
  try {
    const r = await postJSON('/api/editar/natural', {
      conteudoOriginal: original, instrucao, empresa: empresaAtual()
    });
    hideLoading();
    if (!r.ok) return $('edit-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const d = r.resultado;
    $('edit-resultado').innerHTML = `
      <div class="peca-card">
        <h5>Texto editado</h5>
        <p class="peca-texto">${esc(d.textoEditado)}</p>
        ${d.mudancas ? `<h5 style="margin-top:12px;">Mudanças aplicadas</h5><ul style="font-size:12px;color:#8a8aa0;padding-left:16px;">${d.mudancas.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
        ${d.dicaExtra ? `<p class="peca-visual">💡 ${esc(d.dicaExtra)}</p>` : ''}
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button class="btn-ghost-sm" onclick="navigator.clipboard.writeText(\`${esc(d.textoEditado).replace(/`/g,"'")}\`);toast('Copiado!')">📋 Copiar</button>
          <button class="btn-ghost-sm" onclick="$('edit-original').value=\`${esc(d.textoEditado).replace(/`/g,"'")}\`;toast('Texto atualizado para nova edição')">🔄 Editar mais</button>
        </div>
      </div>`;
    toast('Edição aplicada!');
  } catch (err) { hideLoading(); $('edit-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

// ========== IDEIAS POR NICHO ==========
async function gerarIdeiasNicho() {
  const nicho = $('nicho-tema').value.trim();
  if (!nicho) return toast('Informe o nicho');
  showLoading('Gerando ideias...');
  try {
    const r = await postJSON('/api/ideias/nicho', {
      nicho, objetivo: $('nicho-obj').value.trim(),
      quantidade: $('nicho-qtd').value, empresa: empresaAtual()
    });
    hideLoading();
    if (!r.ok) return $('nicho-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const d = r.resultado;
    $('nicho-resultado').innerHTML = `
      ${d.tendencias ? `<div class="camp-info" style="margin-bottom:16px;"><strong>📈 Tendências do nicho</strong><div class="hash-tags">${d.tendencias.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>` : ''}
      <div class="ideias-grid">${(d.ideias || []).map((idea, i) => `
        <div class="ideia-card">
          <div class="ideia-num">${i + 1}</div>
          <div class="ideia-body">
            <h5>${esc(idea.titulo)}</h5>
            <p>${esc(idea.descricao)}</p>
            <div class="ideia-tags">
              <span class="tag">${esc(idea.formato)}</span>
              <span class="tag">${esc(idea.plataforma)}</span>
              <span class="tag ${idea.potencialViral === 'alto' ? 'tag-hot' : ''}">${idea.potencialViral === 'alto' ? '🔥' : ''} ${esc(idea.dificuldade)}</span>
            </div>
            ${idea.gancho ? `<p class="ideia-gancho">"${esc(idea.gancho)}"</p>` : ''}
          </div>
        </div>`).join('')}</div>
      ${d.dicaExtra ? `<div class="camp-info" style="margin-top:16px;"><strong>💡 Dica</strong><p>${esc(d.dicaExtra)}</p></div>` : ''}`;
    toast('Ideias geradas!');
  } catch (err) { hideLoading(); $('nicho-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

// ========== BUSINESS DNA ==========
async function gerarDNA() {
  const site = $('dna-site').value.trim() || empresaAtual()?.site;
  if (!site) return toast('Informe a URL do site');
  showLoading('Analisando DNA da marca...');
  try {
    const r = await postJSON('/api/empresa/dna', { site, empresa: empresaAtual() });
    hideLoading();
    if (!r.ok) return $('dna-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const d = r.dna;
    $('dna-resultado').innerHTML = `
      <div class="dna-resultado">
        ${d.paleta ? `<div class="dna-section"><h4>🎨 Paleta de Cores</h4><div class="dna-paleta">
          ${Object.entries(d.paleta).map(([k,v]) => `<div class="dna-cor"><div class="dna-cor-box" style="background:${esc(v)}" onclick="navigator.clipboard.writeText('${esc(v)}');toast('Copiado!')"></div><span>${esc(k)}</span><span class="dna-hex">${esc(v)}</span></div>`).join('')}
        </div></div>` : ''}
        ${d.tipografia ? `<div class="dna-section"><h4>🔤 Tipografia</h4><p><strong>Títulos:</strong> ${esc(d.tipografia.titulos)}<br><strong>Corpo:</strong> ${esc(d.tipografia.corpo)}<br><strong>Estilo:</strong> ${esc(d.tipografia.estilo)}</p></div>` : ''}
        ${d.estiloVisual ? `<div class="dna-section"><h4>🎭 Estilo Visual</h4><p>${esc(d.estiloVisual)}</p></div>` : ''}
        ${d.mood ? `<div class="dna-section"><h4>✨ Mood</h4><p>${esc(d.mood)}</p></div>` : ''}
        ${d.personalidade ? `<div class="dna-section"><h4>🧬 Personalidade da Marca</h4><div class="hash-tags">${d.personalidade.map(p => `<span class="tag">${esc(p)}</span>`).join('')}</div></div>` : ''}
        ${d.tomComunicacao ? `<div class="dna-section"><h4>🗣️ Tom de Comunicação</h4><p>${esc(d.tomComunicacao)}</p></div>` : ''}
        ${d.diferenciais ? `<div class="dna-section"><h4>💎 Diferenciais</h4><ul>${d.diferenciais.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${d.publicoPercebido ? `<div class="dna-section"><h4>👥 Público Percebido</h4><p>${esc(d.publicoPercebido)}</p></div>` : ''}
      </div>`;
    toast('DNA da marca extraído!');
  } catch (err) { hideLoading(); $('dna-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

// ========== CONEXÕES ==========
async function carregarConexoes() {
  try {
    const r = await (await fetch('/api/conexoes')).json();
    if (!r.ok) return;
    const c = r.conexoes;

    // Meta
    if (c.meta?.conectado) {
      $('meta-status').innerHTML = '<span class="status-dot on"></span> Conectado';
      $('meta-instrucoes').classList.add('hidden');
      $('meta-conectado').classList.remove('hidden');
      $('meta-page-name').textContent = c.meta.nome || 'Página';
      $('meta-ig-status').textContent = c.meta.instagramId ? '📸 Instagram Business vinculado' : '⚠ Instagram não encontrado';
    } else {
      $('meta-status').innerHTML = '<span class="status-dot off"></span> Não conectado';
      $('meta-instrucoes').classList.remove('hidden');
      $('meta-conectado').classList.add('hidden');
    }

    // Wix
    if (c.wix?.conectado) {
      $('wix-status').innerHTML = '<span class="status-dot on"></span> Conectado';
      $('wix-instrucoes').classList.add('hidden');
      $('wix-conectado').classList.remove('hidden');
    } else {
      $('wix-status').innerHTML = '<span class="status-dot off"></span> Não conectado';
      $('wix-instrucoes').classList.remove('hidden');
      $('wix-conectado').classList.add('hidden');
    }

    // Site IA
    if (c.siteIA?.conectado) {
      $('siteia-status').innerHTML = '<span class="status-dot on"></span> Conectado';
      $('siteia-instrucoes').classList.add('hidden');
      $('siteia-conectado').classList.remove('hidden');
      $('siteia-nome-conectado').textContent = c.siteIA.nome || 'Site';
    } else {
      $('siteia-status').innerHTML = '<span class="status-dot off"></span> Não conectado';
      $('siteia-instrucoes').classList.remove('hidden');
      $('siteia-conectado').classList.add('hidden');
    }
  } catch (e) { console.log('Erro ao carregar conexoes:', e); }
}

async function conectarMetaManual() {
  const pageToken = $('meta-page-token').value.trim();
  const pageId = $('meta-page-id').value.trim();
  const igId = $('meta-ig-id').value.trim();
  if (!pageToken) return toast('Cole o token de acesso');

  showLoading('Conectando ao Facebook & Instagram...');
  try {
    const r = await postJSON('/api/meta/conectar-manual', { pageToken, pageId, instagramId: igId });
    hideLoading();
    if (r.ok) {
      toast(r.msg || 'Conectado!');
      carregarConexoes();
    } else {
      toast(r.error || 'Erro ao conectar');
    }
  } catch (e) { hideLoading(); toast('Erro: ' + e.message); }
}

async function buscarPaginasMeta() {
  const token = $('meta-page-token').value.trim();
  if (!token) return toast('Cole o token primeiro, depois clique aqui');

  showLoading('Buscando suas páginas...');
  try {
    const r = await postJSON('/api/meta/paginas', { token });
    hideLoading();
    if (!r.ok) return toast(r.error || 'Erro');
    const paginas = r.paginas || [];
    if (!paginas.length) return toast('Nenhuma página encontrada. Verifique as permissões do token.');

    // Preenche automaticamente com a primeira página
    $('meta-page-id').value = paginas[0].id;
    if (paginas[0].instagramId) $('meta-ig-id').value = paginas[0].instagramId;
    toast(`Página encontrada: ${paginas[0].nome}. Clique em Conectar!`);
  } catch (e) { hideLoading(); toast('Erro: ' + e.message); }
}

async function conectarWix() {
  const apiKey = $('wix-api-key').value.trim();
  const siteId = $('wix-site-id').value.trim();
  const accountId = $('wix-account-id').value.trim();
  if (!apiKey || !siteId) return toast('API Key e Site ID são obrigatórios');

  showLoading('Conectando ao Wix...');
  try {
    const r = await postJSON('/api/wix/conectar', { apiKey, siteId, accountId });
    hideLoading();
    if (r.ok) { toast('Wix conectado!'); carregarConexoes(); }
    else toast(r.error || 'Erro ao conectar');
  } catch (e) { hideLoading(); toast('Erro: ' + e.message); }
}

async function conectarSiteIA() {
  const nome = $('siteia-nome').value.trim();
  const webhookUrl = $('siteia-webhook').value.trim();
  const headerKey = $('siteia-header-key').value.trim();
  const headerVal = $('siteia-header-val').value.trim();
  if (!webhookUrl) return toast('URL do webhook obrigatória');

  const headers = {};
  if (headerKey) headers[headerKey] = headerVal;

  showLoading('Conectando ao site...');
  try {
    const r = await postJSON('/api/webhook-site/conectar', { nome, webhookUrl, headers });
    hideLoading();
    if (r.ok) { toast('Site conectado!'); carregarConexoes(); }
    else toast(r.error || 'Erro');
  } catch (e) { hideLoading(); toast('Erro: ' + e.message); }
}

async function desconectarPlataforma(plat) {
  if (!confirm(`Desconectar ${plat}?`)) return;
  try {
    await postJSON('/api/conexoes/remover', { plataforma: plat });
    toast('Desconectado'); carregarConexoes();
  } catch (e) { toast('Erro: ' + e.message); }
}

// ========== PUBLICAR / AGENDAR DO MODAL ==========
function getPlataformasSelecionadas() {
  const plats = [];
  if ($('pub-facebook').checked) plats.push('facebook');
  if ($('pub-instagram').checked) plats.push('instagram');
  if ($('pub-wix').checked) plats.push('wix');
  if ($('pub-siteia').checked) plats.push('siteIA');
  return plats;
}

async function modalPublicarAgora() {
  const plats = getPlataformasSelecionadas();
  if (!plats.length) return toast('Selecione pelo menos 1 plataforma');

  const texto = $('modal-texto').value;
  const gancho = $('modal-gancho').value;
  const hashtags = $('modal-hashtags').value;
  const fullTexto = `${gancho}\n\n${texto}${hashtags ? '\n\n' + hashtags : ''}`;

  // Pegar imagem se tiver
  const imgEl = document.querySelector('#modal-imagem img');
  const imageUrl = imgEl?.src || null;

  showLoading('Publicando nas plataformas...');
  try {
    const r = await postJSON('/api/publicar/multi', {
      plataformas: plats, texto: fullTexto,
      imageUrl, titulo: gancho,
    });
    hideLoading();

    const el = $('pub-resultado');
    const resultados = r.resultados || {};
    let html = '';
    for (const [plat, res] of Object.entries(resultados)) {
      if (res.ok) {
        let extra = '';
        if (plat === 'wix' && res.comImagem) extra = ' (com imagem de capa)';
        if (plat === 'wix' && res.status === 'draft_criado') extra = ' (draft salvo)';
        html += `<div style="color:#4ade80;">✅ ${plat}: publicado${extra}!</div>`;
      }
      else html += `<div style="color:#ef4444;">❌ ${plat}: ${res.error || 'erro'}</div>`;
    }
    el.innerHTML = html;
    el.className = 'pub-resultado';
    toast('Publicação concluída!');
  } catch (e) { hideLoading(); toast('Erro: ' + e.message); }
}

async function modalAgendar() {
  const plats = getPlataformasSelecionadas();
  if (!plats.length) return toast('Selecione pelo menos 1 plataforma');

  const dataHora = $('pub-data').value;
  if (!dataHora) return toast('Selecione a data e hora para agendar');

  const agendadoPara = new Date(dataHora);
  if (agendadoPara <= new Date()) return toast('A data precisa ser no futuro');

  const texto = $('modal-texto').value;
  const gancho = $('modal-gancho').value;
  const hashtags = $('modal-hashtags').value;
  const fullTexto = `${gancho}\n\n${texto}${hashtags ? '\n\n' + hashtags : ''}`;
  const imgEl = document.querySelector('#modal-imagem img');
  const imageUrl = imgEl?.src || null;

  showLoading('Agendando postagem...');
  try {
    const r = await postJSON('/api/agendar', {
      plataformas: plats, texto: fullTexto,
      imageUrl, titulo: gancho,
      agendadoPara: agendadoPara.toISOString(),
    });
    hideLoading();

    if (r.ok) {
      $('pub-resultado').innerHTML = `<div style="color:#f59e0b;">⏰ Agendado para ${agendadoPara.toLocaleString('pt-BR')}</div>`;
      $('pub-resultado').className = 'pub-resultado';
      toast('Postagem agendada!');
    } else {
      toast(r.error || 'Erro ao agendar');
    }
  } catch (e) { hideLoading(); toast('Erro: ' + e.message); }
}

// ========== AGENDA ==========
async function carregarAgendamentos() {
  try {
    const r = await (await fetch('/api/agendamentos')).json();
    if (!r.ok) return;
    const lista = r.agendamentos || [];

    if (!lista.length) {
      $('agenda-lista').innerHTML = '';
      $('agenda-vazio').style.display = '';
      return;
    }
    $('agenda-vazio').style.display = 'none';

    $('agenda-lista').innerHTML = lista.map(ag => {
      const data = new Date(ag.agendadoPara).toLocaleString('pt-BR');
      const statusClass = ag.status === 'publicado' ? 'publicado' : 'pendente';
      const statusLabel = ag.status === 'publicado' ? '✅ Publicado' : '⏰ Pendente';
      const platsHtml = (ag.plataformas || []).map(p => `<span class="agenda-plat-badge">${p}</span>`).join('');
      const previewTexto = (ag.texto || '').slice(0, 80) + ((ag.texto || '').length > 80 ? '...' : '');

      return `
        <div class="agenda-item">
          <div class="agenda-info">
            <h4>${esc(ag.titulo || 'Publicação')}</h4>
            <p>${esc(previewTexto)}</p>
            <div class="agenda-plats">${platsHtml}</div>
          </div>
          <div class="agenda-actions">
            <span class="agenda-status ${statusClass}">${statusLabel}</span>
            <span style="color:#94a3b8;font-size:.85rem;">${data}</span>
            ${ag.status === 'pendente' ? `<button class="btn-ghost-sm" onclick="cancelarAgendamento(${ag.id})" title="Cancelar">🗑️</button>` : ''}
          </div>
        </div>`;
    }).join('');
  } catch (e) { console.log('Erro ao carregar agendamentos:', e); }
}

async function cancelarAgendamento(id) {
  if (!confirm('Cancelar este agendamento?')) return;
  try {
    await postJSON('/api/agendar/cancelar', { id });
    toast('Agendamento cancelado');
    carregarAgendamentos();
  } catch (e) { toast('Erro: ' + e.message); }
}

// ========== GERENCIAMENTO DE EMPRESAS ==========
function renderEmpresaSelector() {
  const sel = $('empresa-selector');
  if (!sel) return;
  sel.innerHTML = state.empresas.map(e =>
    `<option value="${e.id}" ${e.id === state.empresaAtualId ? 'selected' : ''}>${esc(e.nome)}</option>`
  ).join('') + '<option value="__nova__">＋ Nova empresa...</option>';
}

function trocarEmpresa(id) {
  if (id === '__nova__') {
    adicionarEmpresa();
    return;
  }
  state.empresaAtualId = id;
  saveState();
  selecionados.clear();
  modoGerenciar = false;
  showDashboard();
  toggleView('galeria');
  toast(`Empresa: ${empresaAtual()?.nome}`);
}

function adicionarEmpresa() {
  // Limpa o wizard e mostra para criar nova empresa
  $('w-nome').value = ''; $('w-site').value = ''; $('w-segmento').value = '';
  $('w-publico').value = ''; $('w-redes').value = ''; $('w-local').value = '';
  $('w-descricao').value = ''; $('w-concorrentes').value = '';
  document.querySelectorAll('.loading-step').forEach(el => { el.classList.remove('active','done'); });
  goToStep(1);
  showWizard();
}

function editarEmpresaAtual() {
  const emp = empresaAtual();
  if (!emp) return;
  const novoNome = prompt('Nome da empresa:', emp.nome);
  if (novoNome === null) return;
  if (novoNome.trim()) emp.nome = novoNome.trim();
  const novoSegmento = prompt('Segmento:', emp.segmento);
  if (novoSegmento !== null && novoSegmento.trim()) emp.segmento = novoSegmento.trim();
  const novoPub = prompt('Público-alvo:', emp.publico);
  if (novoPub !== null && novoPub.trim()) emp.publico = novoPub.trim();
  saveState();
  showDashboard();
  toast('Empresa atualizada!');
}

function excluirEmpresaAtual() {
  if (state.empresas.length <= 1) return toast('Não pode excluir a única empresa');
  const emp = empresaAtual();
  if (!confirm(`Excluir "${emp?.nome}" e todos os dados? Isso não pode ser desfeito.`)) return;
  const id = state.empresaAtualId;
  state.empresas = state.empresas.filter(e => e.id !== id);
  delete state.dados[id];
  state.empresaAtualId = state.empresas[0]?.id || null;
  saveState();
  if (state.empresaAtualId) {
    showDashboard();
    toast('Empresa excluída');
  } else {
    showWizard();
  }
}

function resetTudo() {
  if (!confirm('Isso apaga TUDO (todas as empresas e conteúdos). Tem certeza?')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('marketing_ai_studio_v2');
  state = loadState();
  location.reload();
}
