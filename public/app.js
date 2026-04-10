// Marketing AI Studio - Frontend v2: Wizard + Dashboard + Modal expandido + Imagens

// ========== STORAGE ==========
const STORAGE_KEY = 'marketing_ai_studio_v2';
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { empresa: null, historico: [], calendario: null, concorrentes: null, galeria: [] };
  } catch { return { empresa: null, historico: [], calendario: null, concorrentes: null, galeria: [] }; }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
let state = loadState();

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
  state.empresa ? showDashboard() : showWizard();
  renderHistorico();
});
function showWizard() { $('wizard').classList.remove('hidden'); $('dashboard').classList.add('hidden'); }
function showDashboard() {
  $('wizard').classList.add('hidden'); $('dashboard').classList.remove('hidden');
  $('topbar-nome').textContent = state.empresa.nome || '—';
  $('topbar-segmento').textContent = state.empresa.segmento || '—';
  renderPerfil();
  if (state.calendario) renderCalendario();
  if (state.concorrentes) renderConcorrentes();
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
    state.empresa = { ...dados, analise: r.empresa.analise, scraped: r.empresa.scraped, criadoEm: new Date().toISOString() };
    saveState();
    if (dados.concorrentesUrls) {
      const urls = dados.concorrentesUrls.split(',').map(s => s.trim()).filter(Boolean);
      try { const rc = await postJSON('/api/concorrentes/analisar', { concorrentes: urls.map((u,i) => ({nome:`Concorrente ${i+1}`,site:u})), empresa: state.empresa }); if (rc.ok) { state.concorrentes = rc.resultado; saveState(); } } catch {}
    }
    steps.forEach(s => { $(s).classList.remove('active'); $(s).classList.add('done'); });
    await new Promise(r => setTimeout(r, 600));
    showDashboard(); toast('Pronto! Bem-vinda ao seu studio ✨');
  } catch (err) { clearInterval(interval); alert('Erro: ' + err.message); goToStep(3); }
}

// ========== SIDEBAR PERFIL ==========
function toggleSidebar() { $('sidebar-perfil').classList.toggle('hidden'); }
function renderPerfil() {
  const e = state.empresa; if (!e) return; const a = e.analise || {};
  $('perfil-conteudo').innerHTML = `
    <h4>Empresa</h4><p><strong>${esc(e.nome)}</strong><br>${esc(e.segmento)}</p>
    ${e.site ? `<p style="font-size:12px;color:#8a8aa0;">${esc(e.site)}</p>` : ''}
    <h4>Público</h4><p>${esc(e.publico)}</p>
    ${a.resumoMarca ? `<h4>Resumo da marca</h4><p>${esc(a.resumoMarca)}</p>` : ''}
    ${a.posicionamento ? `<h4>Posicionamento</h4><p>${esc(a.posicionamento)}</p>` : ''}
    ${a.tomDeVoz ? `<h4>Tom de voz</h4><p>${esc(a.tomDeVoz)}</p>` : ''}
    ${a.pontosFortes ? `<h4>Pontos fortes</h4><ul>${a.pontosFortes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${a.pontosFracos ? `<h4>Pontos fracos</h4><ul>${a.pontosFracos.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${a.oportunidades ? `<h4>Oportunidades</h4><ul>${a.oportunidades.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${a.personaPrincipal ? `<h4>Persona</h4><p><strong>${esc(a.personaPrincipal.nome)}</strong> — ${esc(a.personaPrincipal.idade)}</p><p><em>Dores:</em> ${(a.personaPrincipal.dores||[]).map(esc).join(', ')}</p><p><em>Desejos:</em> ${(a.personaPrincipal.desejos||[]).map(esc).join(', ')}</p>` : ''}
    ${a.sugestoesImediatas ? `<h4>Ações imediatas</h4><ul>${a.sugestoesImediatas.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
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
  const item = modalAtual.item;
  item.gancho = $('modal-gancho').value;
  item.texto = $('modal-texto').value;
  item.ideiaCopy = $('modal-texto').value;
  item.cta = $('modal-cta').value;
  item.hashtags = $('modal-hashtags').value;
  item.visual = $('modal-visual').value;

  // Atualiza no state
  if (modalAtual.source === 'conteudo' && state.historico.length) {
    const h = state.historico.find(x => x.itens);
    if (h && h.itens[modalAtual.index]) {
      h.itens[modalAtual.index] = { ...item };
    }
  }
  if (modalAtual.source === 'calendario' && state.calendario) {
    const posts = state.calendario.posts || [];
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
      empresa: state.empresa,
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
      empresa: state.empresa,
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
      empresa: state.empresa,
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
    tema, empresa: state.empresa,
  };
  showLoading('Criando conteúdo no tom da sua marca...');
  try {
    const r = await postJSON('/api/conteudo/gerar', body);
    hideLoading();
    if (!r.ok) return $('ct-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    const itens = r.resultado.itens || [];
    renderConteudo('ct-resultado', itens);
    state.historico.unshift({ id: Date.now(), tipo: body.tipo, tema, plataforma: body.plataforma, itens, criadoEm: new Date().toISOString() });
    state.historico = state.historico.slice(0, 50);
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
    empresa: state.empresa,
  };
  showLoading('Planejando o mês inteiro...');
  try {
    const r = await postJSON('/api/calendario/gerar', body);
    hideLoading();
    if (!r.ok) return $('cal-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    state.calendario = r.resultado; saveState();
    renderCalendario(); toast('Calendário pronto!');
  } catch (err) { hideLoading(); $('cal-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

function renderCalendario() {
  const a = state.calendario; if (!a) return;
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
    const r = await postJSON('/api/concorrentes/analisar', { concorrentes: items, empresa: state.empresa });
    hideLoading();
    if (!r.ok) return $('conc-resultado').innerHTML = `<div class="error-box">Erro: ${esc(r.error)}</div>`;
    state.concorrentes = r.resultado; saveState(); renderConcorrentes(); toast('Análise pronta!');
  } catch (err) { hideLoading(); $('conc-resultado').innerHTML = `<div class="error-box">Erro: ${esc(err.message)}</div>`; }
}

function renderConcorrentes() {
  const a = state.concorrentes; if (!a) return;
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
      postJSON('/api/conteudo/gerar', { tipo: 'post', plataforma: 'Instagram', quantidade: 5, objetivo: 'engajamento', tema: 'Conteúdo variado sobre a marca, serviços e bastidores', empresa: state.empresa }),
      postJSON('/api/calendario/gerar', { mes: new Date().getMonth() + 1, ano: new Date().getFullYear(), frequencia: '3x por semana', plataformas: ['Instagram', 'Facebook'], empresa: state.empresa }),
    ]);
    hideLoading();
    if (conteudoRes.ok) {
      renderConteudo('ct-resultado', conteudoRes.resultado.itens || []);
      state.historico.unshift({ id: Date.now(), tipo: 'pacote completo', tema: 'Gerado automaticamente', plataforma: 'Instagram', itens: conteudoRes.resultado.itens, criadoEm: new Date().toISOString() });
    }
    if (calRes.ok) { state.calendario = calRes.resultado; renderCalendario(); }
    saveState(); renderHistorico(); toast('Pacote completo pronto! ✨');
  } catch (err) { hideLoading(); alert('Erro: ' + err.message); }
}

// ========== HISTÓRICO ==========
function renderHistorico() {
  if (!state.historico?.length) { $('historico-card').style.display = 'none'; return; }
  $('historico-card').style.display = 'block';
  $('historico-lista').innerHTML = state.historico.slice(0, 10).map(h => {
    const d = new Date(h.criadoEm);
    return `<div class="historico-item" onclick="reabrirHistorico(${h.id})"><div><strong>${esc(h.tipo)}</strong> · ${esc(h.plataforma)} · ${esc(h.tema)}</div><div class="historico-data">${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR').slice(0,5)}</div></div>`;
  }).join('');
}
function reabrirHistorico(id) {
  const h = state.historico.find(x => x.id === id);
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
    const r = await postJSON('/api/ideias/explorar', { tema, empresa: state.empresa });
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
    const r = await postJSON('/api/hashtags/gerar', { tema, plataforma: $('hash-plat').value, empresa: state.empresa });
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
    const r = await postJSON('/api/briefing/gerar', { tipo: $('brief-tipo').value, tema, plataforma: $('brief-plat').value, empresa: state.empresa });
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
    const r = await postJSON('/api/reciclar/gerar', { conteudoOriginal: texto, formatoOriginal: $('reciclar-formato').value, empresa: state.empresa });
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
    const r = await postJSON('/api/bio/gerar', { empresa: state.empresa });
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
  const views = ['view-modulos', 'view-galeria', 'view-conexoes', 'view-agenda'];
  const btns = ['btn-modulos', 'btn-galeria', 'btn-conexoes', 'btn-agenda'];
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
  } else {
    $('view-modulos').style.display = '';
    $('btn-modulos').style.display = 'none';
  }
}

function salvarNaGaleria(item) {
  if (!state.galeria) state.galeria = [];
  state.galeria.unshift({
    id: Date.now(),
    ...item,
    criadoEm: new Date().toISOString(),
  });
  state.galeria = state.galeria.slice(0, 200);
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
  const items = state.galeria || [];
  const cal = state.calendario?.posts || [];

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
          criadoEm: state.calendario?.criadoEm || new Date().toISOString(),
        });
      }
    });
  }

  // Filtra
  if (filtro === 'imagens') todos = todos.filter(x => x.tipo === 'imagem');
  else if (filtro === 'posts') todos = todos.filter(x => x.tipo === 'post');
  else if (filtro === 'calendario') todos = todos.filter(x => x.tipo === 'calendario');

  // Stats
  const totalImgs = (state.galeria || []).filter(x => x.tipo === 'imagem').length;
  const totalPosts = (state.galeria || []).filter(x => x.tipo === 'post').length;
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

    return `
      <div class="galeria-card" onclick="abrirItemGaleria('${item.id}')">
        ${item.imageUrl
          ? `<div class="galeria-card-img"><img src="${esc(item.imageUrl)}" alt="${esc(item.titulo)}" loading="lazy"></div>`
          : `<div class="galeria-card-placeholder">${icons[item.tipo] || '📄'}</div>`}
        <div class="galeria-card-body">
          <h4>${esc(item.titulo)}</h4>
          <p>${esc(item.descricao || '')}</p>
        </div>
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
  const item = (state.galeria || []).find(x => String(x.id) === String(id));
  if (!item) {
    // Pode ser calendario
    if (String(id).startsWith('cal-')) {
      const idx = parseInt(String(id).replace('cal-', ''));
      const posts = state.calendario?.posts || [];
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

// ========== RESET ==========
function resetTudo() {
  if (!confirm('Isso apaga TUDO (empresa, conteúdos, calendário). Tem certeza?')) return;
  localStorage.removeItem(STORAGE_KEY); state = loadState(); location.reload();
}
