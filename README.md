# Marketing AI Studio

Web app de gestão avançada com IA (Claude Opus 4.6) para design gráfico, marketing e social media.

## O que o app faz (v1 - MVP)

1. **Empresa & Marca** — Cadastra a empresa, lê o site automaticamente e gera um diagnóstico de marketing completo (posicionamento, persona, pontos fortes/fracos, tom de voz, ações imediatas).
2. **Gerador de Conteúdo & Copywriting** — Cria posts, carrosséis, legendas, copy de anúncios e posts de blog com gancho, CTA e sugestão visual, sempre considerando o perfil da empresa.
3. **Calendário Editorial** — Gera planejamento mensal com datas comemorativas brasileiras, frequência e plataformas configuráveis.
4. **Concorrentes & Tendências** — Analisa até 5 concorrentes (lê os sites deles), extrai tendências, palavras-chave e oportunidades de diferenciação.

Próximas versões podem incluir: gerador de imagens com DALL-E, editor de imagem, campanhas completas de Google/Meta Ads, integração com Instagram, lembretes automáticos.

## Pré-requisitos

- **Node.js 18 ou superior** — baixe em https://nodejs.org (instale a versão LTS)
- **Uma chave da Claude API** — crie em https://console.anthropic.com (é pago por uso, bem barato para uso pessoal)

## Instalação (passo a passo)

Abra o Terminal (Mac) ou PowerShell (Windows) e rode:

```bash
# 1. Entre na pasta do projeto
cd "marketing-ai-studio"

# 2. Instale as dependências
npm install

# 3. Copie o arquivo de configuração
cp .env.example .env
# (no Windows use: copy .env.example .env)

# 4. Abra o arquivo .env em qualquer editor (Bloco de Notas serve)
# e cole sua chave da Claude API no lugar de sk-ant-xxxx...

# 5. Inicie o servidor
npm start
```

O terminal vai mostrar: `Marketing AI Studio rodando em http://localhost:3004`

Abra esse endereço no navegador e pronto.

## Como usar

1. Comece pelo módulo **Empresa & Marca** — preencha os dados da empresa da sua esposa. Se você colocar o site, o app lê automaticamente. Clique em "Analisar com IA".
2. Com o perfil cadastrado, os outros módulos usam esse contexto automaticamente. Vá para **Gerador de Conteúdo** e gere posts já no tom da marca.
3. **Calendário Editorial** gera um mês inteiro de planejamento com datas comemorativas.
4. **Concorrentes & Tendências** — cole os sites dos concorrentes e receba um raio-X competitivo.

## Estrutura de arquivos

```
marketing-ai-studio/
├── server/index.js      # backend (Node + Express + Claude API)
├── public/
│   ├── index.html       # interface
│   ├── styles.css       # visual
│   └── app.js           # lógica do frontend
├── data/db.json         # banco de dados local (criado automaticamente)
├── .env                 # sua API key (você cria a partir do .env.example)
├── .env.example
└── package.json
```

## Custos

Cada análise usa a Claude API. Estimativa por chamada: entre US$ 0.02 e US$ 0.15 dependendo do tamanho. Uso normal de um designer solo: menos de US$ 10/mês.

## Problemas comuns

- **"ANTHROPIC_API_KEY nao configurada"** — você esqueceu de editar o `.env` com a chave real.
- **Erro ao ler site** — alguns sites bloqueiam scraping. Preencha a descrição manualmente.
- **Porta ocupada** — edite `.env` e mude para outra porta, ex: `PORT=3005`.

## Roadmap (próximas features)

- [ ] Gerador de imagens (DALL-E / Stable Diffusion)
- [ ] Editor de imagem básico
- [ ] Campanhas completas para Google Ads e Meta Ads
- [ ] Integração direta com Instagram/Facebook para publicar
- [ ] Upload de documentos e imagens da empresa (contexto persistente)
- [ ] Lembretes por email/WhatsApp
- [ ] Multi-usuário com login

---

Construído com Claude Opus 4.6.
