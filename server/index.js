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
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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

// ====== Helper: raspar conteudo de um site ======
async function scrapeSite(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 MarketingAIStudio/1.0' },
    });
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
    const contextoEmpresa = emp
      ? `Empresa: ${emp.nome}. Segmento: ${emp.segmento}. Publico: ${emp.publico}. Descricao: ${emp.descricao || ''}. Tom de voz: ${emp.analise?.tomDeVoz || 'profissional e acessivel'}. Posicionamento: ${emp.analise?.posicionamento || ''}.`
      : 'Empresa ainda nao cadastrada.';

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
    const contextoEmpresa = emp
      ? `Empresa: ${emp.nome}. Segmento: ${emp.segmento}. Publico: ${emp.publico}. Tom: ${emp.analise?.tomDeVoz || ''}.`
      : 'Empresa generica de design/marketing.';

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
    const contextoEmpresa = emp
      ? `Nossa empresa: ${emp.nome} (${emp.segmento}). Publico: ${emp.publico}.`
      : '';

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
    const ctx = emp ? `Empresa: ${emp.nome}. Tom: ${emp.analise?.tomDeVoz || 'profissional'}.` : '';

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
    const ctx = emp ? `Empresa: ${emp.nome}. Segmento: ${emp.segmento}. Tom: ${emp.analise?.tomDeVoz || 'profissional'}.` : '';

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
    const genDir = path.join(__dirname, '..', 'public', 'generated');
    fs.mkdirSync(genDir, { recursive: true });

    // Helper: salvar imagem base64 em arquivo
    function salvarImagem(base64, ext = 'png') {
      const imgName = `img_${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(genDir, imgName), Buffer.from(base64, 'base64'));
      return `/generated/${imgName}`;
    }

    // Helper: gerar com Gemini (NanoBanana)
    async function tentarGemini() {
      if (!geminiKey) return null;
      const models = ['gemini-2.0-flash-preview-image-generation', 'gemini-2.0-flash-exp'];
      for (const model of models) {
        try {
          console.log(`[IMG] Tentando ${model}...`);
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: imgPrompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
          });
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
        const r = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'dall-e-3', prompt: imgPrompt, n: 1, size: '1024x1024', quality: 'standard', response_format: 'b64_json' }),
        });
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
    const ctx = emp ? `Empresa: ${emp.nome}. Segmento: ${emp.segmento}. Publico: ${emp.publico}.` : '';

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
    const ctx = emp ? `Empresa: ${emp.nome}. Segmento: ${emp.segmento}. Publico: ${emp.publico}.` : '';

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
    const ctx = emp ? `Empresa: ${emp.nome}. Segmento: ${emp.segmento}. Tom: ${emp.analise?.tomDeVoz || ''}.` : '';

    const system = `Voce e um diretor de arte e designer senior. Crie briefings visuais detalhados e profissionais que um designer grafico consiga executar perfeitamente. Inclua especificacoes tecnicas, referencias de estilo e direcao criativa. Portugues brasileiro.`;
    const user = `${ctx}

Crie um briefing completo de design para:
Tipo: ${tipo || 'post Instagram'}
Tema: ${tema}
Plataforma: ${plataforma || 'Instagram'}
Texto/copy: ${texto || 'nao definido'}

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
    const ctx = emp ? `Empresa: ${emp.nome}. Tom: ${emp.analise?.tomDeVoz || 'profissional'}.` : '';

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
    const user = `Empresa: ${emp.nome}. Segmento: ${emp.segmento}. Publico: ${emp.publico}. Descricao: ${emp.descricao || ''}. Tom: ${emp.analise?.tomDeVoz || 'profissional'}. Localizacao: ${emp.localizacao || ''}.

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

// ====== Helper: upload imagem para URL pública (necessário para APIs) ======
async function getImageAsBase64(imgPath) {
  const fullPath = path.join(__dirname, '..', 'public', imgPath);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath).toString('base64');
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

    // Se for config do Meta, salva no .env
    if (plataforma === 'meta_config' && dados.appId && dados.appSecret) {
      const envPath = path.join(__dirname, '..', '.env');
      let envContent = fs.readFileSync(envPath, 'utf-8');
      envContent = envContent.replace(/META_APP_ID=.*/, `META_APP_ID=${dados.appId}`);
      envContent = envContent.replace(/META_APP_SECRET=.*/, `META_APP_SECRET=${dados.appSecret}`);
      fs.writeFileSync(envPath, envContent);
      // Atualiza process.env em runtime
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
      const imgFullUrl = imageUrl.startsWith('http') ? imageUrl : `http://localhost:${PORT}${imageUrl}`;
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

    const imgFullUrl = imageUrl.startsWith('http') ? imageUrl : `http://localhost:${PORT}${imageUrl}`;

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

// ====== CRON: Verificar agendamentos a cada minuto ======
cron.schedule('* * * * *', async () => {
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
        let endpoint;
        if (plat === 'facebook') endpoint = `http://localhost:${PORT}/api/publicar/facebook`;
        else if (plat === 'instagram') endpoint = `http://localhost:${PORT}/api/publicar/instagram`;
        else if (plat === 'wix') endpoint = `http://localhost:${PORT}/api/publicar/wix`;
        else if (plat === 'siteIA') endpoint = `http://localhost:${PORT}/api/publicar/site-ia`;
        else continue;

        const r = await fetch(endpoint, {
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
app.post('/api/publicar/multi', async (req, res) => {
  try {
    const { plataformas, texto, imageUrl, titulo } = req.body;
    const resultados = {};

    for (const plat of (plataformas || [])) {
      try {
        let endpoint;
        if (plat === 'facebook') endpoint = `http://localhost:${PORT}/api/publicar/facebook`;
        else if (plat === 'instagram') endpoint = `http://localhost:${PORT}/api/publicar/instagram`;
        else if (plat === 'wix') endpoint = `http://localhost:${PORT}/api/publicar/wix`;
        else if (plat === 'siteIA') endpoint = `http://localhost:${PORT}/api/publicar/site-ia`;
        else continue;

        const r = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texto, imageUrl, titulo }),
        });
        resultados[plat] = await r.json();
      } catch (e) { resultados[plat] = { ok: false, error: e.message }; }
    }
    res.json({ ok: true, resultados });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ====== Health check ======
app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: MODEL, configurado: !!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-xxxx') });
});

app.listen(PORT, () => {
  console.log(`\nMarketing AI Studio rodando em http://localhost:${PORT}`);
  console.log(`Modelo: ${MODEL}`);
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-xxxx')) {
    console.log('\nAVISO: ANTHROPIC_API_KEY nao configurada. Edite o arquivo .env.\n');
  }
});
