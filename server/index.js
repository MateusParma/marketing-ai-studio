// Marketing AI Studio - Servidor Principal
// Backend Node.js + Express + Claude API

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const cheerio = require('cheerio');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializa cliente Claude
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-opus-4-6';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ====== Armazenamento simples em JSON (sem banco de dados) ======
const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? '/tmp' : path.join(__dirname, '..', 'data');
if (!isVercel && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return { empresa: null, conteudos: [], calendario: [], concorrentes: [], conexoes: {}, agendamentos: [] };
  }
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    if (!db.conexoes) db.conexoes = {};
    if (!db.agendamentos) db.agendamentos = [];
    return db;
  } catch {
    return { empresa: null, conteudos: [], calendario: [], concorrentes: [], conexoes: {}, agendamentos: [] };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ====== Helper: chamar Claude ======
async function askClaude(systemPrompt, userPrompt, maxTokens = 2000) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-xxxx')) {
    throw new Error('ANTHROPIC_API_KEY nao configurada. Edite o arquivo .env e coloque sua chave real.');
  }
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return response.content[0].text;
}

// ====== Helper: contexto rico da empresa para prompts ======
function buildEmpresaContext(emp) {
  if (!emp) return '';
  const a = emp.analise || {};
  const s = emp.scraped || {};
  let ctx = `Empresa: ${emp.nome || ''}. Segmento: ${emp.segmento || ''}. Publico: ${emp.publico || ''}. Tom: ${a.tomDeVoz || 'profissional'}.`;
  if (a.posicionamento) ctx += ` Posicionamento: ${a.posicionamento}.`;
  if (a.pontosFortes?.length) ctx += ` Pontos fortes: ${a.pontosFortes.join(', ')}.`;
  if (s && !s.error && s.title) {
    ctx += ` Site (${s.url || emp.site}): titulo="${s.title}", descricao="${s.description || ''}", H1="${s.h1 || ''}", conteudo="${(s.bodyText || '').slice(0, 1500)}".`;
  }
  return ctx;
}

// ====== Helper: fetch com timeout ======
function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

// ====== Helper: raspar conteudo de um site ======
async function scrapeSite(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 MarketingAIStudio/1.0' },
    }, 6000);
    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $('title').text().trim();
    const description = $('meta[name="description"]').attr('content') || '';
    const h1 = $('h1').map((_, el) => $(el).text().trim()).get().join(' | ');
    const h2 = $('h2').map((_, el) => $(el).text().trim()).get().slice(0, 10).join(' | ');
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 5000);
    return { url, title, description, h1, h2, bodyText };
  } catch (err) {
    return { url, error: err.message };
  }
}

// ====== ROTA: Perfil da empresa e analise de marca ======
app.post('/api/empresa/analisar', async (req, res) => {
  try {
    const { nome, site, segmento, publico, descricao, redesSociais } = req.body;
    let scraped = null;
    if (site) scraped = await scrapeSite(site);

    const system = `Voce e um estrategista senior de marketing e branding. Analise empresas de forma profunda e entregue diagnosticos acionaveis em portugues brasileiro. Seja especifico, evite generalidades.`;

    const user = `Analise esta empresa e entregue um diagnostico de marketing completo em JSON valido com esta estrutura exata:
{
  "resumoMarca": "paragrafo",
  "posicionamento": "paragrafo",
  "pontosFortes": ["...", "..."],
  "pontosFracos": ["...", "..."],
  "oportunidades": ["...", "..."],
  "personaPrincipal": {"nome": "...", "idade": "...", "dores": ["..."], "desejos": ["..."]},
  "tomDeVoz": "descricao",
  "sugestoesImediatas": ["acao 1", "acao 2", "acao 3"]
}

DADOS DA EMPRESA:
- Nome: ${nome || 'nao informado'}
- Segmento: ${segmento || 'nao informado'}
- Publico-alvo: ${publico || 'nao informado'}
- Descricao: ${descricao || 'nao informada'}
- Redes sociais: ${redesSociais || 'nao informadas'}
${scraped && !scraped.error ? `
CONTEUDO EXTRAIDO DO SITE (${scraped.url}):
Titulo: ${scraped.title}
Meta descricao: ${scraped.description}
Titulos H1: ${scraped.h1}
Titulos H2: ${scraped.h2}
Texto: ${scraped.bodyText}
` : ''}

Responda APENAS com o JSON, sem texto antes ou depois.`;

    const raw = await askClaude(system, user, 3000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const analise = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };

    const db = loadDB();
    db.empresa = { nome, site, segmento, publico, descricao, redesSociais, analise, scraped, atualizadoEm: new Date().toISOString() };
    saveDB(db);

    res.json({ ok: true, empresa: db.empresa });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/empresa', (req, res) => {
  const db = loadDB();
  res.json({ ok: true, empresa: db.empresa });
});

// ====== ROTA: Gerar conteudo / copy ======
app.post('/api/conteudo/gerar', async (req, res) => {
  try {
    const { tipo, tema, plataforma, objetivo, quantidade, empresa } = req.body;
    const db = loadDB();
    const emp = empresa || db.empresa;
    const contextoEmpresa = buildEmpresaContext(emp) || 'Empresa ainda nao cadastrada.';

    const system = `Voce e um copywriter e social media senior especializado em design grafico e marketing. Escreva em portugues brasileiro, com tom envolvente, especifico e orientado a conversao. Use ganchos fortes, beneficios claros e CTAs bem definidos.`;

    const user = `Contexto: ${contextoEmpresa}

Tarefa: gerar ${quantidade || 3} ${tipo || 'posts'} para ${plataforma || 'Instagram'} sobre o tema "${tema}". Objetivo: ${objetivo || 'engajamento'}.

Para cada item entregue:
- gancho (primeira linha forte)
- texto completo (copy pronto para publicar)
- hashtags relevantes (se aplicavel)
- sugestao de imagem/visual
- CTA (chamada para acao)

Responda em JSON valido:
{
  "itens": [
    {"gancho": "...", "texto": "...", "hashtags": "...", "visual": "...", "cta": "..."}
  ]
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 3000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };

    db.conteudos.push({ id: Date.now(), tipo, tema, plataforma, objetivo, resultado, criadoEm: new Date().toISOString() });
    saveDB(db);

    res.json({ ok: true, resultado });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/conteudo', (req, res) => {
  const db = loadDB();
  res.json({ ok: true, conteudos: db.conteudos.slice(-20).reverse() });
});

// ====== ROTA: Calendario editorial ======
app.post('/api/calendario/gerar', async (req, res) => {
  try {
    const { mes, ano, frequencia, plataformas, empresa } = req.body;
    const db = loadDB();
    const emp = empresa || db.empresa;
    const contextoEmpresa = buildEmpresaContext(emp) || 'Empresa generica de design/marketing.';

    const system = `Voce e um planejador de conteudo senior. Cria calendarios editoriais estrategicos considerando datas comemorativas brasileiras, sazonalidades e objetivos de marketing.`;

    const user = `${contextoEmpresa}

Gere um calendario editorial para ${mes}/${ano}. Frequencia: ${frequencia || '3x por semana'}. Plataformas: ${(plataformas || ['Instagram']).join(', ')}.

Inclua datas comemorativas relevantes do Brasil para esse mes e amarre conteudos a elas quando fizer sentido.

Responda em JSON valido:
{
  "datasComemorativas": [{"data": "DD/MM", "nome": "..."}],
  "posts": [
    {"data": "DD/MM/AAAA", "plataforma": "...", "tipo": "...", "tema": "...", "ideiaCopy": "...", "objetivo": "..."}
  ]
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 4000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };

    db.calendario = resultado.posts || [];
    db.datasComemorativas = resultado.datasComemorativas || [];
    saveDB(db);

    res.json({ ok: true, resultado });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/calendario', (req, res) => {
  const db = loadDB();
  res.json({ ok: true, calendario: db.calendario || [], datasComemorativas: db.datasComemorativas || [] });
});

// ====== ROTA: Analise de concorrentes e tendencias ======
app.post('/api/concorrentes/analisar', async (req, res) => {
  try {
    const { concorrentes, empresa } = req.body; // array de {nome, site}
    const scrapes = [];
    for (const c of (concorrentes || [])) {
      if (c.site) scrapes.push({ nome: c.nome, ...(await scrapeSite(c.site)) });
      else scrapes.push({ nome: c.nome });
    }

    const db = loadDB();
    const emp = empresa || db.empresa;
    const contextoEmpresa = buildEmpresaContext(emp);

    const system = `Voce e um analista de inteligencia competitiva. Compara concorrentes, identifica padroes, tendencias e oportunidades de diferenciacao. Seja concreto e acionavel.`;

    const user = `${contextoEmpresa}

Analise os concorrentes abaixo e entregue em JSON valido:
{
  "resumoMercado": "...",
  "tendenciasDetectadas": ["..."],
  "palavrasChave": ["..."],
  "concorrentes": [
    {"nome": "...", "pontosFortes": ["..."], "pontosFracos": ["..."], "oQueAprender": "..."}
  ],
  "oportunidadesDiferenciacao": ["..."],
  "recomendacoes": ["..."]
}

DADOS:
${scrapes.map(s => `- ${s.nome} (${s.url || 'sem site'}): ${s.title || ''} | ${s.description || ''} | ${(s.bodyText || '').slice(0, 800)}`).join('\n')}

Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 4000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };

    db.concorrentes = resultado.concorrentes || [];
    db.analiseCompetitiva = resultado;
    saveDB(db);

    res.json({ ok: true, resultado });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/concorrentes', (req, res) => {
  const db = loadDB();
  res.json({ ok: true, analise: db.analiseCompetitiva || null });
});

// ====== ROTA: Melhorar texto ======
app.post('/api/conteudo/melhorar', async (req, res) => {
  try {
    const { gancho, texto, cta, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);

    const system = `Voce e um copywriter senior. Melhore textos de marketing mantendo a essencia mas tornando-os mais impactantes, persuasivos e profissionais. Escreva em portugues brasileiro.`;
    const user = `${ctx}

Melhore este conteudo de marketing. Mantenha o tema mas torne mais impactante:

GANCHO: ${gancho}
TEXTO: ${texto}
CTA: ${cta || ''}

Entregue em JSON valido:
{"gancho": "...", "texto": "...", "cta": "...", "hashtags": "..."}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 2000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { gancho, texto };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Gerar variacoes ======
app.post('/api/conteudo/variacoes', async (req, res) => {
  try {
    const { gancho, texto, cta, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);

    const system = `Voce e um copywriter criativo. Gere variacoes de textos de marketing com abordagens diferentes (humor, emocional, direto, storytelling, etc). Portugues brasileiro.`;
    const user = `${ctx}

Crie 3 variacoes DIFERENTES deste conteudo. Cada uma com abordagem/angulo diferente mas mesmo tema:

ORIGINAL:
Gancho: ${gancho}
Texto: ${texto}
CTA: ${cta || ''}

Entregue em JSON valido:
{"variacoes": [{"gancho": "...", "texto": "...", "cta": "...", "abordagem": "humor|emocional|direto|storytelling|etc"}]}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 3000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { variacoes: [] };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Gerar imagem (Gemini NanoBanana / OpenAI DALL-E) ======
app.post('/api/imagem/gerar', async (req, res) => {
  try {
    const { descricao, contexto, empresa, modelo } = req.body;
    const emp = empresa || loadDB().empresa;
    const preferencia = modelo || 'gemini'; // 'gemini' ou 'dalle'
    const segmento = emp?.segmento || 'marketing';

    // 1. Usa Claude para gerar um prompt profissional de imagem
    const system = `Voce e um diretor de arte especializado em criar prompts perfeitos para geradores de imagem AI. Crie prompts em ingles que gerem imagens profissionais para marketing e redes sociais. Seja CONCISO: maximo 200 palavras no prompt.`;
    const user = `Crie um prompt de geracao de imagem AI para este post:

Empresa: ${emp?.nome || 'empresa'} (${segmento})
Descricao visual: ${descricao}
Contexto: ${contexto || ''}

Regras:
- Prompt em INGLES, max 200 palavras
- Especifique estilo, cores, composicao e mood
- Formato quadrado Instagram 1:1
- Profissional para marketing
- NAO inclua texto/palavras na imagem (geradores de imagem nao geram texto bem)

Entregue em JSON:
{"promptEN": "prompt em ingles", "promptPT": "descricao em portugues", "estilo": "fotografia|ilustracao|flat design|3d|etc"}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 1000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const promptData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    const imgPrompt = promptData?.promptEN || descricao;

    // 2. Gerar imagem com a API escolhida pelo usuario
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    // Helper: retorna imagem como data URL (funciona em qualquer ambiente)
    function salvarImagem(base64, ext = 'png') {
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${base64}`;
    }

    // Helper: gerar com Gemini (NanoBanana)
    async function tentarGemini() {
      if (!geminiKey) return null;
      const models = ['gemini-2.0-flash-preview-image-generation', 'gemini-2.0-flash-exp'];
      for (const model of models) {
        try {
          console.log(`[IMG] Tentando ${model}...`);
          const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: imgPrompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
          }, 25000);
          const d = await r.json();
          if (d.error) { console.log(`[IMG] ${model} erro: ${d.error.message}`); continue; }
          const imgPart = (d.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.mimeType?.startsWith('image/'));
          if (imgPart) {
            return { imageUrl: salvarImagem(imgPart.inlineData.data), modelo: `NanoBanana (${model})` };
          }
        } catch (e) { console.log(`[IMG] ${model} falhou: ${e.message}`); }
      }
      return null;
    }

    // Helper: gerar com DALL-E
    async function tentarDalle() {
      if (!openaiKey) return null;
      try {
        console.log('[IMG] Tentando DALL-E 3...');
        const r = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'dall-e-3', prompt: imgPrompt, n: 1, size: '1024x1024', quality: 'standard', response_format: 'b64_json' }),
        }, 30000);
        const d = await r.json();
        if (d.data?.[0]?.b64_json) return { imageUrl: salvarImagem(d.data[0].b64_json), modelo: 'DALL-E 3' };
        if (d.data?.[0]?.url) return { imageUrl: d.data[0].url, modelo: 'DALL-E 3' };
        console.log('[IMG] DALL-E sem imagem:', JSON.stringify(d).slice(0, 200));
      } catch (e) { console.log(`[IMG] DALL-E falhou: ${e.message}`); }
      return null;
    }

    // Executa na ordem de preferencia do usuario
    let result = null;
    if (preferencia === 'dalle') {
      result = await tentarDalle() || await tentarGemini();
    } else {
      result = await tentarGemini() || await tentarDalle();
    }

    if (result) {
      return res.json({ ok: true, ...result, promptUsado: imgPrompt, descricaoPT: promptData?.promptPT || '' });
    }

    // Nenhuma API funcionou
    res.json({
      ok: true,
      semApi: !geminiKey && !openaiKey,
      promptSugerido: `${imgPrompt}\n\n--- Em portugues ---\n${promptData?.promptPT || descricao}\nEstilo: ${promptData?.estilo || ''}`,
      promptUsado: imgPrompt,
      instrucao: !geminiKey && !openaiKey
        ? 'Nenhuma API de imagem configurada. Adicione GEMINI_API_KEY ou OPENAI_API_KEY no arquivo .env.'
        : 'As APIs falharam. Tente novamente ou use o prompt manualmente.',
    });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Link de Ideias (estilo Answer The Public) ======
app.post('/api/ideias/explorar', async (req, res) => {
  try {
    const { tema, profundidade, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);

    const system = `Voce e um estrategista de conteudo e especialista em SEO. Sua funcao e explorar um tema como uma arvore de ideias interconectadas, similar ao Answer The Public. Para cada tema, gere perguntas que o publico faz, subtemas derivados, angulos de conteudo, e conexoes entre ideias. Pense como o publico-alvo pensa: quais duvidas, desejos, medos e curiosidades eles tem sobre o tema? Portugues brasileiro.`;

    const user = `${ctx}

Explore o tema "${tema}" e gere uma arvore completa de ideias para conteudo.

Entregue em JSON valido:
{
  "temaCentral": "${tema}",
  "perguntas": {
    "oque": ["O que e...?", "O que fazer quando...?"],
    "como": ["Como fazer...?", "Como escolher...?"],
    "porque": ["Por que...?", "Por que e importante...?"],
    "quando": ["Quando...?", "Quando devo...?"],
    "qual": ["Qual o melhor...?", "Qual a diferenca...?"]
  },
  "subtemas": ["subtema1", "subtema2", "subtema3"],
  "angulosDeConteudo": [
    {"titulo": "...", "formato": "post|carrossel|reels|blog|stories", "gancho": "primeira linha", "potencial": "alto|medio"}
  ],
  "palavrasChave": ["keyword1", "keyword2"],
  "tendencias": ["tendencia relacionada"],
  "conexoes": [
    {"de": "subtema1", "para": "subtema2", "relacao": "complementa|contrasta|aprofunda"}
  ]
}
Gere pelo menos 5 perguntas por categoria, 8 subtemas, 10 angulos de conteudo e 15 palavras-chave.
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 4000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Gerador de Hashtags inteligente ======
app.post('/api/hashtags/gerar', async (req, res) => {
  try {
    const { tema, plataforma, nicho, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);

    const system = `Voce e um especialista em crescimento organico e hashtags para redes sociais. Gere conjuntos estrategicos de hashtags misturando populares (alto alcance), medias (engajamento) e nichadas (conversao). Portugues brasileiro.`;
    const user = `${ctx}

Gere hashtags estrategicas para: "${tema}" na plataforma ${plataforma || 'Instagram'}.

Entregue em JSON valido:
{
  "conjuntoPrincipal": ["#hashtag1", "#hashtag2"],
  "populares": ["#hashtag (alto alcance, 1M+ posts)"],
  "medias": ["#hashtag (engajamento, 100K-1M)"],
  "nichadas": ["#hashtag (conversao, -100K)"],
  "proibidas": ["#hashtags que podem causar shadowban"],
  "combinacaoIdeal": "As 30 melhores juntas, prontas pra colar",
  "dica": "dica de uso estrategico"
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 2000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Briefing de Design ======
app.post('/api/briefing/gerar', async (req, res) => {
  try {
    const { tipo, tema, plataforma, texto, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const a = emp?.analise || {};
    const s = emp?.scraped || {};

    // Contexto rico da empresa incluindo dados do site
    let ctx = '';
    if (emp) {
      ctx = `EMPRESA:
- Nome: ${emp.nome || ''}
- Segmento: ${emp.segmento || ''}
- Publico-alvo: ${emp.publico || ''}
- Descricao: ${emp.descricao || ''}
- Tom de voz: ${a.tomDeVoz || ''}
- Posicionamento: ${a.posicionamento || ''}
- Pontos fortes: ${(a.pontosFortes || []).join(', ')}
- Persona: ${a.personaPrincipal ? `${a.personaPrincipal.nome}, ${a.personaPrincipal.idade}` : ''}`;

      if (s && !s.error && s.title) {
        ctx += `\n\nDADOS DO SITE DA EMPRESA (${s.url || emp.site}):
- Titulo do site: ${s.title || ''}
- Meta descricao: ${s.description || ''}
- Titulos H1: ${s.h1 || ''}
- Titulos H2: ${s.h2 || ''}
- Conteudo principal: ${(s.bodyText || '').slice(0, 2000)}`;
      }
    }

    const system = `Voce e um diretor de arte e designer senior especializado em marketing digital. Crie briefings visuais detalhados e profissionais que um designer grafico consiga executar perfeitamente. Use as informacoes do site e da marca da empresa para criar briefings alinhados com a identidade visual existente. Inclua especificacoes tecnicas, referencias de estilo e direcao criativa. Portugues brasileiro.`;
    const user = `${ctx}

Crie um briefing completo de design para:
Tipo: ${tipo || 'post Instagram'}
Tema: ${tema}
Plataforma: ${plataforma || 'Instagram'}
Texto/copy: ${texto || 'nao definido'}

IMPORTANTE: Baseie a paleta de cores, tipografia e estilo visual na identidade da empresa e no que voce viu no site dela. O briefing deve ser coerente com a marca.

Entregue em JSON valido:
{
  "formato": {"largura": "1080px", "altura": "1080px", "orientacao": "quadrado"},
  "layout": "descricao detalhada do layout - onde fica cada elemento",
  "tipografia": {"titulo": "tipo de fonte, peso, tamanho sugerido", "corpo": "...", "destaque": "..."},
  "paleta": ["#hex1", "#hex2", "#hex3", "#hex4"],
  "elementosVisuais": ["elemento 1 com descricao", "elemento 2"],
  "hierarquia": "1o titulo em destaque, 2o subtexto, 3o CTA...",
  "mood": "moderno|minimalista|divertido|elegante|rustico|etc",
  "referencias": "descricao de estilos/referencias visuais similares",
  "naoFazer": ["erros comuns a evitar"],
  "arquivosSugeridos": ["o que precisa: foto produto, icone, background, etc"]
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 2500);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Reciclador de Conteudo ======
app.post('/api/reciclar/gerar', async (req, res) => {
  try {
    const { conteudoOriginal, formatoOriginal, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);

    const system = `Voce e um social media senior. Sua especialidade e transformar um unico conteudo em multiplos formatos para diferentes plataformas, maximizando o alcance sem parecer repetitivo. Cada versao deve ser nativa da plataforma. Portugues brasileiro.`;
    const user = `${ctx}

Transforme este conteudo em 6 formatos diferentes:

CONTEUDO ORIGINAL (${formatoOriginal || 'post'}):
${conteudoOriginal}

Entregue em JSON valido:
{
  "formatos": [
    {"plataforma": "Instagram Feed", "tipo": "carrossel", "slides": ["slide 1 texto", "slide 2"], "legenda": "...", "hashtags": "..."},
    {"plataforma": "Instagram Stories", "tipo": "stories", "sequencia": ["story 1", "story 2", "story 3"], "cta": "..."},
    {"plataforma": "Twitter/X", "tipo": "thread", "tweets": ["tweet 1 (max 280 chars)", "tweet 2"]},
    {"plataforma": "LinkedIn", "tipo": "post profissional", "texto": "...", "hashtags": "..."},
    {"plataforma": "TikTok/Reels", "tipo": "roteiro de video", "duracao": "30-60s", "roteiro": "...", "audio": "sugestao de audio"},
    {"plataforma": "Blog", "tipo": "artigo", "titulo": "...", "subtitulo": "...", "introducao": "...", "topicos": ["..."], "conclusao": "..."}
  ]
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 4000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Gerador de Bio ======
app.post('/api/bio/gerar', async (req, res) => {
  try {
    const { empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    if (!emp) return res.json({ ok: false, error: 'Cadastre a empresa primeiro' });

    const system = `Voce e um especialista em branding e copywriting para redes sociais. Crie bios profissionais, cativantes e otimizadas para cada plataforma. Use emojis de forma estrategica. Portugues brasileiro.`;
    const user = `${buildEmpresaContext(emp)} Localizacao: ${emp.localizacao || ''}.

Gere bios otimizadas para cada plataforma:

Entregue em JSON valido:
{
  "instagram": {"bio": "max 150 chars com emojis e CTA", "dica": "..."},
  "facebook": {"sobre": "paragrafo curto pra secao Sobre", "descricaoCurta": "1 frase", "dica": "..."},
  "linkedin": {"titulo": "headline profissional", "sobre": "paragrafo profissional", "dica": "..."},
  "tiktok": {"bio": "max 80 chars, jovem e direto", "dica": "..."},
  "whatsapp": {"status": "frase curta pra status", "descricao": "pra perfil business", "dica": "..."},
  "googleMeuNegocio": {"descricao": "otimizada pra SEO local", "dica": "..."}
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 2500);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====================================================================
// ====== INTEGRAÇÕES: META (Instagram/Facebook), WIX, SITES IA ======
// ====================================================================

// ====== Helper: extrair base64 de imagem (data URL ou arquivo local) ======
async function getImageAsBase64(imgPath) {
  // Se já é data URL, extrai o base64
  if (imgPath && imgPath.startsWith('data:')) {
    const match = imgPath.match(/^data:[^;]+;base64,(.+)$/);
    return match ? match[1] : null;
  }
  // Se é URL externa, baixa a imagem
  if (imgPath && imgPath.startsWith('http')) {
    try {
      const r = await fetch(imgPath);
      const buf = Buffer.from(await r.arrayBuffer());
      return buf.toString('base64');
    } catch { return null; }
  }
  // Arquivo local (apenas desenvolvimento)
  if (!isVercel && imgPath) {
    const fullPath = path.join(__dirname, '..', 'public', imgPath);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath).toString('base64');
    }
  }
  return null;
}

// ====== ROTA: Status de conexões ======
app.get('/api/conexoes', (req, res) => {
  const db = loadDB();
  const conexoes = db.conexoes || {};
  // Retorna status sem expor tokens completos
  const status = {};
  for (const [plat, data] of Object.entries(conexoes)) {
    status[plat] = {
      conectado: !!(data.accessToken || data.apiKey || data.webhookUrl || data.pageToken),
      nome: data.nome || data.pageName || plat,
      expiraEm: data.expiresAt || null,
      ultimaPostagem: data.ultimaPostagem || null,
      instagramId: data.instagramId || null,
    };
  }
  res.json({ ok: true, conexoes: status });
});

// ====== ROTA: Salvar conexão (tokens configurados pelo usuário) ======
app.post('/api/conexoes/salvar', (req, res) => {
  try {
    const { plataforma, dados } = req.body;

    // Se for config do Meta, salva no DB e atualiza process.env
    if (plataforma === 'meta_config' && dados.appId && dados.appSecret) {
      const db = loadDB();
      db.conexoes.meta_config = { appId: dados.appId, appSecret: dados.appSecret };
      saveDB(db);
      process.env.META_APP_ID = dados.appId;
      process.env.META_APP_SECRET = dados.appSecret;
      return res.json({ ok: true, msg: 'Credenciais Meta salvas' });
    }

    const db = loadDB();
    db.conexoes[plataforma] = { ...dados, conectadoEm: new Date().toISOString() };
    saveDB(db);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Remover conexão ======
app.post('/api/conexoes/remover', (req, res) => {
  try {
    const { plataforma } = req.body;
    const db = loadDB();
    delete db.conexoes[plataforma];
    saveDB(db);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== META: Conectar com token manual ======
app.post('/api/meta/conectar-manual', async (req, res) => {
  try {
    const { pageToken, pageId, instagramId } = req.body;
    if (!pageToken) return res.json({ ok: false, error: 'Token de acesso obrigatorio.' });

    const db = loadDB();

    // Se nao passou pageId, busca automaticamente
    let finalPageId = pageId;
    let pageName = '';
    let finalIgId = instagramId || null;

    if (!finalPageId) {
      // Buscar paginas com o token
      const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${pageToken}`);
      const pagesData = await pagesRes.json();
      if (pagesData.error) return res.json({ ok: false, error: pagesData.error.message });
      const pages = pagesData.data || [];
      if (!pages.length) return res.json({ ok: false, error: 'Nenhuma pagina encontrada com esse token. Verifique as permissoes.' });
      finalPageId = pages[0].id;
      pageName = pages[0].name;
    } else {
      // Buscar nome da pagina
      try {
        const pgRes = await fetch(`https://graph.facebook.com/v19.0/${finalPageId}?fields=name&access_token=${pageToken}`);
        const pgData = await pgRes.json();
        pageName = pgData.name || 'Pagina';
      } catch { pageName = 'Pagina'; }
    }

    // Buscar Instagram Business se nao foi informado
    if (!finalIgId) {
      try {
        const igRes = await fetch(`https://graph.facebook.com/v19.0/${finalPageId}?fields=instagram_business_account&access_token=${pageToken}`);
        const igData = await igRes.json();
        finalIgId = igData.instagram_business_account?.id || null;
      } catch { /* sem ig */ }
    }

    db.conexoes.meta = {
      accessToken: pageToken,
      pageId: finalPageId,
      pageToken: pageToken,
      pageName,
      instagramId: finalIgId,
      expiresAt: new Date(Date.now() + 59 * 24 * 60 * 60 * 1000).toISOString(),
      conectadoEm: new Date().toISOString(),
    };
    saveDB(db);

    res.json({
      ok: true,
      pageName,
      pageId: finalPageId,
      instagramId: finalIgId,
      msg: finalIgId ? 'Facebook e Instagram conectados!' : 'Facebook conectado! Instagram Business nao encontrado na pagina.',
    });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== META: Buscar paginas do usuario ======
app.post('/api/meta/paginas', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.json({ ok: false, error: 'Token obrigatorio' });

    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${token}`);
    const pagesData = await pagesRes.json();
    if (pagesData.error) return res.json({ ok: false, error: pagesData.error.message });

    const paginas = (pagesData.data || []).map(p => ({
      id: p.id, nome: p.name,
      instagramId: p.instagram_business_account?.id || null,
    }));
    res.json({ ok: true, paginas });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== META: Postar no Facebook ======
app.post('/api/publicar/facebook', async (req, res) => {
  try {
    const { texto, imageUrl, agendadoPara } = req.body;
    const db = loadDB();
    const meta = db.conexoes.meta;
    if (!meta?.pageToken) return res.json({ ok: false, error: 'Facebook nao conectado. Conecte primeiro no painel.' });

    let endpoint, body;

    if (imageUrl) {
      // Post com imagem
      if (imageUrl.startsWith('data:')) {
        // Imagem base64: upload direto via multipart
        const base64 = imageUrl.replace(/^data:[^;]+;base64,/, '');
        const imgBuffer = Buffer.from(base64, 'base64');
        const FormData = (await import('node-fetch')).FormData || globalThis.FormData;
        const blob = new Blob([imgBuffer], { type: 'image/png' });
        const formData = new FormData();
        formData.append('source', blob, 'image.png');
        formData.append('message', texto);
        formData.append('access_token', meta.pageToken);
        endpoint = `https://graph.facebook.com/v19.0/${meta.pageId}/photos`;
        const r = await fetch(endpoint, { method: 'POST', body: formData });
        const data = await r.json();
        if (data.error) return res.json({ ok: false, error: data.error.message });
        meta.ultimaPostagem = new Date().toISOString();
        saveDB(db);
        return res.json({ ok: true, postId: data.id || data.post_id, plataforma: 'facebook' });
      }
      const imgFullUrl = imageUrl.startsWith('http') ? imageUrl : imageUrl;
      endpoint = `https://graph.facebook.com/v19.0/${meta.pageId}/photos`;
      body = { url: imgFullUrl, message: texto, access_token: meta.pageToken };
    } else {
      // Post só texto
      endpoint = `https://graph.facebook.com/v19.0/${meta.pageId}/feed`;
      body = { message: texto, access_token: meta.pageToken };
    }

    // Agendamento
    if (agendadoPara) {
      const ts = Math.floor(new Date(agendadoPara).getTime() / 1000);
      if (ts > Math.floor(Date.now() / 1000) + 600) {
        body.scheduled_publish_time = ts;
        body.published = false;
      }
    }

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();

    if (data.error) return res.json({ ok: false, error: data.error.message });

    meta.ultimaPostagem = new Date().toISOString();
    saveDB(db);

    res.json({ ok: true, postId: data.id || data.post_id, plataforma: 'facebook' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== META: Postar no Instagram ======
app.post('/api/publicar/instagram', async (req, res) => {
  try {
    const { texto, imageUrl, agendadoPara } = req.body;
    const db = loadDB();
    const meta = db.conexoes.meta;
    if (!meta?.instagramId) return res.json({ ok: false, error: 'Instagram Business nao conectado.' });
    if (!imageUrl) return res.json({ ok: false, error: 'Instagram exige imagem. Gere uma imagem primeiro.' });

    if (imageUrl.startsWith('data:')) {
      return res.json({ ok: false, error: 'Instagram requer URL pública para imagens. Faça upload da imagem para um serviço de hospedagem primeiro.' });
    }
    const imgFullUrl = imageUrl.startsWith('http') ? imageUrl : imageUrl;

    // Passo 1: Criar container de mídia
    const createUrl = `https://graph.facebook.com/v19.0/${meta.instagramId}/media`;
    const createBody = {
      image_url: imgFullUrl,
      caption: texto,
      access_token: meta.pageToken,
    };
    const createRes = await fetch(createUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    });
    const createData = await createRes.json();
    if (createData.error) return res.json({ ok: false, error: createData.error.message });

    // Passo 2: Publicar
    const publishUrl = `https://graph.facebook.com/v19.0/${meta.instagramId}/media_publish`;
    const publishRes = await fetch(publishUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: createData.id, access_token: meta.pageToken }),
    });
    const publishData = await publishRes.json();
    if (publishData.error) return res.json({ ok: false, error: publishData.error.message });

    meta.ultimaPostagem = new Date().toISOString();
    saveDB(db);

    res.json({ ok: true, postId: publishData.id, plataforma: 'instagram' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== WIX: Salvar conexão ======
app.post('/api/wix/conectar', async (req, res) => {
  try {
    const { apiKey, siteId, accountId } = req.body;
    if (!apiKey || !siteId) return res.json({ ok: false, error: 'API Key e Site ID sao obrigatorios.' });

    // Busca o memberId a partir de um post existente
    let memberId = null;
    try {
      const r = await fetch('https://www.wixapis.com/blog/v3/posts?paging.limit=1', {
        headers: { 'Authorization': apiKey, 'wix-site-id': siteId, 'Content-Type': 'application/json' },
      });
      const d = await r.json();
      memberId = d.posts?.[0]?.memberId || null;
    } catch { /* sem posts */ }

    const db = loadDB();
    db.conexoes.wix = { apiKey, siteId, accountId, memberId, nome: 'Wix Blog', conectadoEm: new Date().toISOString() };
    saveDB(db);
    res.json({ ok: true, memberId, totalPosts: 'conectado' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== WIX: Publicar post no blog ======
// Helper: Upload imagem para o Wix Media
async function uploadImageToWix(wix, localImagePath) {
  try {
    const fullPath = path.join(__dirname, '..', 'public', localImagePath);
    if (!fs.existsSync(fullPath)) return null;

    const imgBuffer = fs.readFileSync(fullPath);
    const ext = path.extname(localImagePath).replace('.', '') || 'png';
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const fileName = `blog_${Date.now()}.${ext}`;

    // 1. Gerar URL de upload
    const urlRes = await fetch('https://www.wixapis.com/site-media/v1/files/generate-upload-url', {
      method: 'POST',
      headers: { 'Authorization': wix.apiKey, 'wix-site-id': wix.siteId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType, fileName }),
    });
    const urlData = await urlRes.json();
    if (!urlData.uploadUrl) return null;

    // 2. Fazer upload da imagem
    const boundary = '----WixUpload' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      imgBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const upRes = await fetch(urlData.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const upData = await upRes.json();
    const fileUrl = upData.file?.url || upData.file?.fileUrl || null;
    const fileId = upData.file?.id || null;

    if (fileUrl) {
      console.log('[WIX] Imagem uploaded:', fileUrl);
      return { url: fileUrl, id: fileId, width: upData.file?.mediaInfo?.width || 1080, height: upData.file?.mediaInfo?.height || 1080 };
    }
    return null;
  } catch (e) { console.log('[WIX] Upload erro:', e.message); return null; }
}

// Helper: Converter texto simples em Rich Content nodes formatados para Wix Blog
function textoParaRichContent(texto, imgData) {
  const nodes = [];

  // Imagem de capa no topo
  if (imgData?.url) {
    nodes.push({
      type: 'IMAGE',
      imageData: {
        image: { src: { url: imgData.url }, width: imgData.width || 1080, height: imgData.height || 1080 },
        containerData: { width: { size: 'CONTENT' }, alignment: 'CENTER' },
      }
    });
  }

  // Divide texto em paragrafos e formata
  const linhas = texto.split('\n').filter(l => l.trim());
  for (const linha of linhas) {
    const trimmed = linha.trim();

    // Detecta titulos (linhas curtas, em CAPS ou com emoji no inicio)
    if (trimmed.length < 80 && (trimmed === trimmed.toUpperCase() || /^[#\u{1F300}-\u{1FAFF}]/u.test(trimmed) || trimmed.startsWith('##'))) {
      const cleanTitle = trimmed.replace(/^#+\s*/, '');
      nodes.push({
        type: 'HEADING',
        headingData: { level: 3 },
        nodes: [{ type: 'TEXT', textData: { text: cleanTitle, decorations: [{ type: 'BOLD' }] } }]
      });
    }
    // Detecta listas (linhas que comecam com - ou *)
    else if (/^[-*•]\s/.test(trimmed)) {
      nodes.push({
        type: 'BULLETED_LIST',
        nodes: [{
          type: 'LIST_ITEM',
          nodes: [{
            type: 'PARAGRAPH',
            nodes: [{ type: 'TEXT', textData: { text: trimmed.replace(/^[-*•]\s*/, '') } }]
          }]
        }]
      });
    }
    // Detecta hashtags
    else if (trimmed.startsWith('#') && trimmed.includes(' #')) {
      nodes.push({
        type: 'PARAGRAPH',
        paragraphData: { textStyle: { textAlignment: 'CENTER' } },
        nodes: [{ type: 'TEXT', textData: { text: trimmed, decorations: [{ type: 'ITALIC' }, { type: 'COLOR', colorData: { foreground: '#6C63FF' } }] } }]
      });
    }
    // Paragrafo normal
    else {
      nodes.push({
        type: 'PARAGRAPH',
        nodes: [{ type: 'TEXT', textData: { text: trimmed } }]
      });
    }
  }

  return { nodes };
}

app.post('/api/publicar/wix', async (req, res) => {
  try {
    const { titulo, texto, imageUrl, agendadoPara } = req.body;
    const db = loadDB();
    const wix = db.conexoes.wix;
    if (!wix?.apiKey) return res.json({ ok: false, error: 'Wix nao conectado.' });

    // 1. Usa Claude para transformar o texto em post de blog formatado
    let blogTexto = texto;
    try {
      const system = 'Voce e um redator de blog profissional. Transforme o conteudo fornecido em um post de blog bem estruturado em portugues brasileiro. Use paragrafos claros, subtitulos (com ##), listas quando apropriado, e um tom profissional mas acessivel. Mantenha o conteudo original mas melhore a estrutura e legibilidade. NAO use markdown alem de ## para subtitulos e - para listas. Responda APENAS com o texto do post, sem JSON.';
      const user = `Transforme em post de blog profissional:\n\nTitulo: ${titulo || 'Post'}\n\nConteudo:\n${texto}`;
      blogTexto = await askClaude(system, user, 2000);
    } catch (e) { console.log('[WIX] Formatacao IA falhou, usando texto original:', e.message); }

    // 2. Upload da imagem se existir
    let imgData = null;
    if (imageUrl && !imageUrl.startsWith('http')) {
      imgData = await uploadImageToWix(wix, imageUrl);
    }

    // 3. Monta rich content formatado
    const richContent = textoParaRichContent(blogTexto, imgData);

    // 4. Cria draft
    const draftBody = {
      draftPost: {
        title: titulo || 'Post do Marketing AI Studio',
        memberId: wix.memberId || undefined,
        richContent,
        featured: !!imgData,
      }
    };

    // Se tem imagem, coloca como media de capa
    if (imgData?.url) {
      draftBody.draftPost.media = {
        wixMedia: { image: { id: imgData.id || imgData.url, url: imgData.url, height: imgData.height || 1080, width: imgData.width || 1080 } },
        displayed: true, custom: true,
      };
    }

    const draftRes = await fetch('https://www.wixapis.com/blog/v3/draft-posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': wix.apiKey, 'wix-site-id': wix.siteId },
      body: JSON.stringify(draftBody),
    });
    const draftData = await draftRes.json();
    if (draftData.error || !draftData.draftPost) {
      return res.json({ ok: false, error: draftData.message || draftData.error || 'Erro ao criar draft no Wix.' });
    }

    const draftId = draftData.draftPost.id;

    // 5. Publicar o draft (se nao for agendado)
    if (!agendadoPara) {
      const pubRes = await fetch(`https://www.wixapis.com/blog/v3/draft-posts/${draftId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': wix.apiKey, 'wix-site-id': wix.siteId },
      });
      const pubData = await pubRes.json();
      if (pubData.error) return res.json({ ok: false, error: pubData.message || 'Erro ao publicar no Wix.' });

      wix.ultimaPostagem = new Date().toISOString();
      saveDB(db);
      return res.json({ ok: true, postId: draftId, plataforma: 'wix', status: 'publicado', comImagem: !!imgData });
    }

    wix.ultimaPostagem = new Date().toISOString();
    saveDB(db);
    res.json({ ok: true, postId: draftId, plataforma: 'wix', status: 'draft_criado', comImagem: !!imgData });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== SITES IA: Webhook genérico ======
app.post('/api/webhook-site/conectar', (req, res) => {
  try {
    const { nome, webhookUrl, headers, metodo } = req.body;
    if (!webhookUrl) return res.json({ ok: false, error: 'URL do webhook obrigatoria.' });
    const db = loadDB();
    db.conexoes.siteIA = { nome: nome || 'Site IA', webhookUrl, headers: headers || {}, metodo: metodo || 'POST', conectadoEm: new Date().toISOString() };
    saveDB(db);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== SITES IA: Publicar via webhook ======
app.post('/api/publicar/site-ia', async (req, res) => {
  try {
    const { titulo, texto, imageUrl, dados } = req.body;
    const db = loadDB();
    const site = db.conexoes.siteIA;
    if (!site?.webhookUrl) return res.json({ ok: false, error: 'Site IA nao conectado.' });

    const payload = { titulo, texto, imageUrl, ...dados, timestamp: new Date().toISOString() };
    const r = await fetch(site.webhookUrl, {
      method: site.metodo || 'POST',
      headers: { 'Content-Type': 'application/json', ...site.headers },
      body: JSON.stringify(payload),
    });

    let respBody;
    try { respBody = await r.json(); } catch { respBody = await r.text(); }

    if (!r.ok) return res.json({ ok: false, error: `Webhook retornou ${r.status}: ${JSON.stringify(respBody).slice(0, 200)}` });

    site.ultimaPostagem = new Date().toISOString();
    saveDB(db);
    res.json({ ok: true, plataforma: 'siteIA', resposta: respBody });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== AGENDAMENTO: Publicação automática ======
app.post('/api/agendar', (req, res) => {
  try {
    const { plataformas, texto, imageUrl, titulo, agendadoPara, recorrencia } = req.body;
    if (!agendadoPara || !plataformas?.length) return res.json({ ok: false, error: 'Informe data/hora e pelo menos 1 plataforma.' });

    const db = loadDB();
    const agendamento = {
      id: Date.now(),
      plataformas,
      texto, imageUrl, titulo,
      agendadoPara,
      recorrencia: recorrencia || null,
      status: 'pendente',
      criadoEm: new Date().toISOString(),
    };
    db.agendamentos.push(agendamento);
    saveDB(db);

    res.json({ ok: true, agendamento });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/agendamentos', (req, res) => {
  const db = loadDB();
  res.json({ ok: true, agendamentos: db.agendamentos || [] });
});

app.post('/api/agendar/cancelar', (req, res) => {
  try {
    const { id } = req.body;
    const db = loadDB();
    db.agendamentos = (db.agendamentos || []).filter(a => a.id !== id);
    saveDB(db);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== CRON: Verificar agendamentos a cada minuto (apenas local) ======
if (!isVercel) cron.schedule('* * * * *', async () => {
  const db = loadDB();
  const agora = new Date();
  let mudou = false;

  for (const ag of (db.agendamentos || [])) {
    if (ag.status !== 'pendente') continue;
    const dataAg = new Date(ag.agendadoPara);
    if (dataAg > agora) continue;

    console.log(`[CRON] Publicando agendamento ${ag.id}...`);
    ag.status = 'publicando';

    for (const plat of ag.plataformas) {
      try {
        let routePath;
        if (plat === 'facebook') routePath = '/api/publicar/facebook';
        else if (plat === 'instagram') routePath = '/api/publicar/instagram';
        else if (plat === 'wix') routePath = '/api/publicar/wix';
        else if (plat === 'siteIA') routePath = '/api/publicar/site-ia';
        else continue;

        const r = await fetch(`http://localhost:${PORT}${routePath}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texto: ag.texto, imageUrl: ag.imageUrl, titulo: ag.titulo }),
        });
        const data = await r.json();
        console.log(`[CRON] ${plat}: ${data.ok ? 'OK' : data.error}`);
        ag[`resultado_${plat}`] = data;
      } catch (e) { console.log(`[CRON] ${plat} falhou: ${e.message}`); }
    }
    ag.status = 'publicado';
    ag.publicadoEm = new Date().toISOString();
    mudou = true;
  }
  if (mudou) saveDB(db);
});

// ====== ROTA: Publicar imediatamente em múltiplas plataformas ======
// Helper: simula req/res para chamar rotas internamente sem localhost
function callRoute(app, method, path, body) {
  return new Promise((resolve) => {
    const mockReq = { body, method: method.toUpperCase(), url: path, headers: { 'content-type': 'application/json' } };
    const mockRes = { json: (data) => resolve(data), status: () => mockRes };
    app.handle(mockReq, mockRes, () => resolve({ ok: false, error: 'Rota não encontrada' }));
  });
}

app.post('/api/publicar/multi', async (req, res) => {
  try {
    const { plataformas, texto, imageUrl, titulo } = req.body;
    const resultados = {};

    for (const plat of (plataformas || [])) {
      try {
        let routePath;
        if (plat === 'facebook') routePath = '/api/publicar/facebook';
        else if (plat === 'instagram') routePath = '/api/publicar/instagram';
        else if (plat === 'wix') routePath = '/api/publicar/wix';
        else if (plat === 'siteIA') routePath = '/api/publicar/site-ia';
        else continue;

        resultados[plat] = await callRoute(app, 'POST', routePath, { texto, imageUrl, titulo });
      } catch (e) { resultados[plat] = { ok: false, error: e.message }; }
    }
    res.json({ ok: true, resultados });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Carrossel completo com imagens ======
app.post('/api/carrossel/gerar', async (req, res) => {
  try {
    const { tema, numSlides, plataforma, estilo, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);
    const slides = numSlides || 5;

    // 1. Gerar textos e prompts de imagem para cada slide
    const system = `Voce e um social media e designer senior especializado em carrosseis virais para Instagram e redes sociais. Crie carrosseis com ganchos fortes, conteudo educativo ou persuasivo, e artes visuais impactantes. Portugues brasileiro.`;
    const user = `${ctx}

Crie um carrossel completo com ${slides} slides sobre: "${tema}"
Plataforma: ${plataforma || 'Instagram'}
Estilo visual: ${estilo || 'moderno e profissional'}

Para CADA slide entregue:
1. O texto que aparece NA IMAGEM (titulo grande, subtexto curto — max 20 palavras por slide)
2. Um prompt em INGLES para gerar a arte do slide com IA (descreva fundo, cores, layout, elementos visuais)

Regras do carrossel:
- Slide 1: CAPA com gancho forte que faz parar de rolar
- Slides 2-${slides-1}: Conteudo com dicas, passos ou informacoes (1 ideia por slide, texto curto e direto)
- Slide ${slides}: CTA final (salva, compartilha, comenta, link na bio)
- Todos os slides devem ter unidade visual (mesma paleta, estilo)

Entregue em JSON valido:
{
  "titulo": "titulo do carrossel",
  "legenda": "legenda completa para a publicacao com hashtags",
  "estiloVisual": "descricao do estilo visual unificado",
  "paleta": ["#hex1", "#hex2", "#hex3"],
  "slides": [
    {
      "numero": 1,
      "tipo": "capa | conteudo | cta",
      "textoImagem": "texto que aparece na imagem (curto e impactante)",
      "subtexto": "subtexto opcional menor",
      "promptImagem": "prompt em ingles detalhado para gerar a arte: descreva background, cores, layout, elementos graficos, tipografia. Estilo: ${estilo || 'modern, clean'}. Dimensoes: 1080x1350. Inclua espaco para texto overlay."
    }
  ]
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 3500);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (!resultado) return res.json({ ok: false, error: 'Erro ao gerar carrossel' });

    // 2. Gerar imagens para cada slide
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const models = ['gemini-2.0-flash-preview-image-generation', 'gemini-2.0-flash-exp'];
      for (let i = 0; i < resultado.slides.length; i++) {
        const slide = resultado.slides[i];
        const fullPrompt = `${slide.promptImagem}. Text overlay on image: "${slide.textoImagem}"${slide.subtexto ? `. Subtext: "${slide.subtexto}"` : ''}. Make the text readable, large and bold. Instagram carousel slide ${slide.numero} of ${resultado.slides.length}. 1080x1350 portrait.`;

        let generated = false;
        for (const model of models) {
          if (generated) break;
          try {
            const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
            }, 30000);
            const d = await r.json();
            if (d.error) continue;
            const imgPart = (d.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.mimeType?.startsWith('image/'));
            if (imgPart) {
              slide.imageUrl = `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
              slide.modelo = model;
              generated = true;
            }
          } catch (e) { console.log(`[CARROSSEL] Slide ${i+1} ${model} falhou: ${e.message}`); }
        }
        if (!generated) slide.imageUrl = null;
      }
    }

    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Campanha Completa de Marketing ======
app.post('/api/campanha/gerar', async (req, res) => {
  try {
    const { objetivo, tema, plataformas, orcamento, duracao, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);

    const system = `Voce e um estrategista de marketing digital senior e diretor criativo. Crie campanhas de marketing completas, com conceito criativo, copy para cada plataforma, cronograma, KPIs e direcao visual. Seja especifico e acionavel. Portugues brasileiro.`;
    const user = `${ctx}

Crie uma campanha de marketing COMPLETA:
Objetivo: ${objetivo || 'engajamento e conversao'}
Tema/Produto: ${tema}
Plataformas: ${(plataformas || ['Instagram', 'Facebook']).join(', ')}
Orcamento estimado: ${orcamento || 'a definir'}
Duracao: ${duracao || '1 semana'}

Entregue em JSON valido:
{
  "nomeCampanha": "nome criativo da campanha",
  "conceito": "descricao do conceito criativo e narrativa da campanha",
  "publicoAlvo": "segmento especifico para esta campanha",
  "mensagemChave": "a mensagem principal que queremos comunicar",
  "hashtags": "#campanha #especificas",
  "cronograma": [
    {"dia": "Dia 1", "acao": "descricao", "plataforma": "Instagram", "formato": "post/stories/reel"}
  ],
  "pecas": [
    {
      "plataforma": "Instagram Feed",
      "formato": "post unico / carrossel / stories / reel",
      "titulo": "titulo ou gancho",
      "texto": "copy completo pronto para publicar",
      "cta": "call to action",
      "hashtags": "#hashtags",
      "direcaoVisual": "descricao detalhada da imagem/video",
      "dimensoes": "1080x1080 / 1080x1920 / etc"
    }
  ],
  "emailMarketing": {
    "assunto": "subject line do email",
    "preheader": "texto preview",
    "corpo": "corpo do email em texto",
    "cta": "botao CTA",
    "remetente": "nome sugerido"
  },
  "kpis": ["KPI 1 com meta", "KPI 2 com meta"],
  "investimento": {"sugestao": "descricao de como alocar o orcamento", "divisao": [{"plataforma": "...", "percentual": "..."}]}
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 4000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Gerador de Google Ads ======
app.post('/api/googleads/gerar', async (req, res) => {
  try {
    const { produto, objetivo, publicoAlvo, quantidade, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);

    const system = `Voce e um especialista certificado em Google Ads com 10+ anos de experiencia. Crie anuncios otimizados para alta performance seguindo as melhores praticas do Google. Portugues brasileiro.`;
    const user = `${ctx}

Crie ${quantidade || 3} variacoes de anuncios Google Ads:
Produto/Servico: ${produto}
Objetivo: ${objetivo || 'conversao'}
Publico: ${publicoAlvo || 'definido pela empresa'}

Entregue em JSON valido:
{
  "anuncios": [
    {
      "tipo": "Search / Display / Performance Max",
      "titulos": ["titulo 1 (max 30 chars)", "titulo 2", "titulo 3"],
      "descricoes": ["descricao 1 (max 90 chars)", "descricao 2"],
      "extensoes": {
        "sitelinks": [{"titulo": "...", "descricao": "..."}],
        "callouts": ["destaque 1", "destaque 2"],
        "snippets": ["recurso 1", "recurso 2"]
      },
      "palavrasChave": ["keyword 1", "keyword 2", "keyword 3"],
      "palavrasNegativas": ["negativa 1"],
      "lancesugerido": "CPC sugerido",
      "dica": "dica de otimizacao"
    }
  ],
  "estrategia": "recomendacao geral de estrategia de lances e segmentacao",
  "orcamentoDiario": "sugestao de orcamento diario"
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 3000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Gerador de Email Marketing ======
app.post('/api/email/gerar', async (req, res) => {
  try {
    const { tipo, objetivo, tema, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);

    const system = `Voce e um especialista em email marketing e copywriting de conversao. Crie emails profissionais com altas taxas de abertura e clique. Use tecnicas de persuasao, urgencia e personalizacao. Portugues brasileiro.`;
    const user = `${ctx}

Crie um email marketing completo:
Tipo: ${tipo || 'promocional'}
Objetivo: ${objetivo || 'conversao'}
Tema: ${tema}

Entregue em JSON valido:
{
  "assunto": "subject line principal (max 60 chars)",
  "assuntosAlternativos": ["opcao A/B test 1", "opcao A/B test 2"],
  "preheader": "texto de preview (max 100 chars)",
  "remetente": {"nome": "...", "sugestaoEmail": "..."},
  "corpo": {
    "saudacao": "abertura personalizada",
    "introducao": "paragrafo de abertura que prende atencao",
    "conteudoPrincipal": "corpo do email com beneficios e proposta de valor",
    "prova": "depoimento, numero ou fato que gera credibilidade",
    "cta": {"texto": "texto do botao", "cor": "#hex sugerida"},
    "ps": "P.S. com urgencia ou bonus extra"
  },
  "designSugerido": {
    "header": "descricao do banner/header do email",
    "layout": "1 coluna / 2 colunas / hero image",
    "paleta": ["#hex1", "#hex2", "#hex3"],
    "imagensSugeridas": ["descricao imagem 1", "descricao imagem 2"]
  },
  "segmentacao": "para quem enviar este email",
  "melhorHorario": "dia e horario sugerido para envio",
  "metricas": {"taxaAberturaEsperada": "...", "taxaCliqueEsperada": "..."}
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 3000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Gerador de YouTube Thumbnails ======
app.post('/api/thumbnail/gerar', async (req, res) => {
  try {
    const { tituloVideo, tema, estilo, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);

    const system = `Voce e um designer de thumbnails do YouTube com milhoes de views. Crie briefings de thumbnails que geram alto CTR. Conhece psicologia visual, cores de alta conversao e composicao para mobile. Portugues brasileiro.`;
    const user = `${ctx}

Crie um briefing de thumbnail para YouTube:
Titulo do video: ${tituloVideo}
Tema: ${tema || tituloVideo}
Estilo: ${estilo || 'profissional e chamativo'}

Entregue em JSON valido:
{
  "conceito": "descricao do conceito visual da thumbnail",
  "dimensoes": "1280x720",
  "elementos": {
    "textoOverlay": "texto curto que aparece na thumbnail (max 5 palavras)",
    "fonteEstilo": "tipo de fonte, tamanho, cor, stroke/sombra",
    "expressaoRosto": "se tiver pessoa: qual expressao facial usar",
    "fundoDescricao": "descricao do background",
    "elementosGraficos": ["setas", "circulos", "emojis", "icones sugeridos"],
    "corDominante": "#hex - cor que domina a thumbnail",
    "contraste": "como criar contraste visual para destacar no feed"
  },
  "paleta": ["#hex1", "#hex2", "#hex3"],
  "composicao": "descricao de onde fica cada elemento (regra dos tercos, etc)",
  "promptImagem": "prompt em ingles para gerar a thumbnail com IA",
  "naoFazer": ["erro 1 a evitar", "erro 2"],
  "referenciasEstilo": "descricao de estilos de thumbnails populares similares"
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 2000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Photoshoot IA (produto → foto profissional) ======
app.post('/api/photoshoot/gerar', async (req, res) => {
  try {
    const { descricaoProduto, estilo, cenario, empresa } = req.body;
    const emp = empresa || loadDB().empresa;

    const promptEN = `Professional product photography, ${estilo || 'studio lighting, clean white background'}, ${descricaoProduto}, ${cenario || 'minimalist setting'}, commercial quality, high resolution, sharp focus, soft shadows, e-commerce ready, brand photography`;

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return res.json({ ok: false, error: 'GEMINI_API_KEY nao configurada. Necessaria para Photoshoot IA.' });
    }

    const models = ['gemini-2.0-flash-preview-image-generation', 'gemini-2.0-flash-exp'];
    for (const model of models) {
      try {
        const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: promptEN }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
        }, 30000);
        const d = await r.json();
        if (d.error) continue;
        const imgPart = (d.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.mimeType?.startsWith('image/'));
        if (imgPart) {
          const imageUrl = `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
          return res.json({ ok: true, imageUrl, modelo: model, promptUsado: promptEN });
        }
      } catch (e) { console.log(`[PHOTOSHOOT] ${model} falhou: ${e.message}`); }
    }
    res.json({ ok: false, error: 'Nao foi possivel gerar a foto. Tente novamente.' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Edição por linguagem natural ======
app.post('/api/editar/natural', async (req, res) => {
  try {
    const { conteudoOriginal, instrucao, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);

    const system = `Voce e um editor de conteudo profissional. O usuario vai te dar um texto e uma instrucao de edicao em linguagem natural. Aplique a edicao mantendo o tom e estilo da marca. Portugues brasileiro.`;
    const user = `${ctx}

CONTEUDO ORIGINAL:
${conteudoOriginal}

INSTRUCAO DE EDICAO:
${instrucao}

Aplique a edicao e retorne em JSON:
{
  "textoEditado": "o texto completo apos a edicao",
  "mudancas": ["descricao da mudanca 1", "descricao da mudanca 2"],
  "dicaExtra": "sugestao adicional opcional"
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 2000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Business DNA melhorado (extrai paleta, fontes, estilo) ======
app.post('/api/empresa/dna', async (req, res) => {
  try {
    const { site, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const scraped = site ? await scrapeSite(site) : (emp?.scraped || null);
    if (!scraped || scraped.error) return res.json({ ok: false, error: 'Nao foi possivel acessar o site.' });

    const system = `Voce e um especialista em branding e identidade visual. Analise o conteudo de um site e extraia a identidade visual e de marca com precisao. Portugues brasileiro.`;
    const user = `Analise este site e extraia o "DNA da marca":

SITE: ${scraped.url}
TITULO: ${scraped.title}
META: ${scraped.description}
H1: ${scraped.h1}
H2: ${scraped.h2}
CONTEUDO: ${(scraped.bodyText || '').slice(0, 3000)}

Entregue em JSON valido:
{
  "paleta": {
    "primaria": "#hex",
    "secundaria": "#hex",
    "acento": "#hex",
    "fundo": "#hex",
    "texto": "#hex"
  },
  "tipografia": {
    "titulos": "fonte sugerida para titulos baseada no estilo do site",
    "corpo": "fonte sugerida para corpo de texto",
    "estilo": "serif/sans-serif/display/etc"
  },
  "estiloVisual": "descricao do estilo visual geral (minimalista, corporativo, divertido, etc)",
  "mood": "descricao do mood/atmosfera da marca",
  "personalidade": ["adjetivo 1", "adjetivo 2", "adjetivo 3", "adjetivo 4"],
  "elementosRecorrentes": ["elemento visual 1 identificado", "elemento 2"],
  "tomComunicacao": "descricao detalhada do tom",
  "diferenciais": ["diferencial 1", "diferencial 2"],
  "publicoPercebido": "descricao do publico que o site parece mirar",
  "concorrenciaEstimada": "posicionamento percebido no mercado"
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 2500);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, dna: resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== ROTA: Gerador de Ideias por Nicho ======
app.post('/api/ideias/nicho', async (req, res) => {
  try {
    const { nicho, objetivo, quantidade, empresa } = req.body;
    const emp = empresa || loadDB().empresa;
    const ctx = buildEmpresaContext(emp);

    const system = `Voce e um estrategista de conteudo criativo e trend hunter. Gere ideias inovadoras, virais e acionaveis para marketing digital. Cada ideia deve ser unica e especifica o suficiente para ser executada imediatamente. Portugues brasileiro.`;
    const user = `${ctx}

Gere ${quantidade || 10} ideias de conteudo para:
Nicho: ${nicho}
Objetivo: ${objetivo || 'engajamento e autoridade'}

Entregue em JSON valido:
{
  "ideias": [
    {
      "titulo": "nome chamativo da ideia",
      "descricao": "descricao em 2-3 frases do que fazer",
      "formato": "post / carrossel / video / stories / reel / blog / email",
      "plataforma": "melhor plataforma para esta ideia",
      "dificuldade": "facil / medio / avancado",
      "potencialViral": "baixo / medio / alto",
      "gancho": "frase de abertura sugerida",
      "referencia": "descricao de um exemplo ou tendencia similar"
    }
  ],
  "tendencias": ["tendencia 1 do nicho", "tendencia 2"],
  "dicaExtra": "recomendacao geral para o nicho"
}
Responda APENAS com o JSON.`;

    const raw = await askClaude(system, user, 3000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    res.json({ ok: true, resultado });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== Health check ======
app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: MODEL, configurado: !!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-xxxx') });
});

// Exporta para Vercel Serverless
module.exports = app;

// Inicia servidor apenas em desenvolvimento local
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\nMarketing AI Studio rodando em http://localhost:${PORT}`);
    console.log(`Modelo: ${MODEL}`);
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-xxxx')) {
      console.log('\nAVISO: ANTHROPIC_API_KEY nao configurada. Edite o arquivo .env.\n');
    }
  });
}
