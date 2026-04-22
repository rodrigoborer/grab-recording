# GrabRecording

Ferramenta para baixar e reproduzir gravacoes de chamadas telefonicas a partir de um PBX **Grandstream UCM6xxx** via HTTPS API.

O projeto existe em quatro implementacoes independentes, descritas abaixo.

---

## Como funciona

O PBX Grandstream UCM6xxx expoe uma API HTTPS com autenticacao challenge/response (hash MD5). O fluxo de uso e:

1. **Challenge** -- obtém um token temporario do PBX
2. **Login** -- autentica com usuario + MD5(challenge + senha) e recebe um cookie de sessao
3. **CDR** -- busca registros de chamadas dos ultimos 2 dias (paginado, 200 por vez)
4. **Selecao** -- o usuario escolhe qual gravacao deseja baixar (ate 5 mais recentes)
5. **getRecordInfosByCall** -- obtem o caminho do arquivo WAV usando o AcctId do CDR
6. **recapi** -- baixa o arquivo de audio
7. **Logout** -- encerra a sessao no PBX

---

## Versoes

### Android (`/GrabRecording`)

Aplicativo Android nativo desenvolvido em **Kotlin**.

- Interface grafica para inserir IP/porta/usuario/senha do PBX
- Executa o fluxo completo de autenticacao e download
- Reproduz o audio diretamente no dispositivo
- Arquivos principais:
  - `app/src/main/java/com/condoconta/grabrecording/MainActivity.kt` -- tela principal
  - `app/src/main/java/com/condoconta/grabrecording/MainViewModel.kt` -- logica de negocio
  - `app/src/main/java/com/condoconta/grabrecording/PbxApiClient.kt` -- cliente da API do PBX

---

### Web Node.js (`/GrabRecordingWebNodeJS`)

Aplicacao web com backend em **Node.js + Express** e frontend em HTML/JS.

- Acesso via navegador em qualquer dispositivo da rede local
- Backend faz as chamadas HTTPS ao PBX (contorna restricoes de CORS e certificado autoassinado)
- Dependencias: `express`, `axios`
- Arquivos principais:
  - `server.js` -- servidor Express e proxy para a API do PBX
  - `public/index.html` -- interface web

**Para executar:**
```bash
npm install
npm start
```

---

### Web Python (`/GrabRecordingWebPython`)

Aplicacao web com backend em **Python + Flask** e frontend em HTML/JS.

- Versao mais completa e atualizada do projeto
- Interface wizard passo a passo com visualizacao de cada requisicao/resposta
- Modos de operacao: **Iniciar** (automatico) e **Debug** (passo a passo)
- Selecao interativa entre as ultimas 5 gravacoes disponiveis
- Player de audio integrado com controle de seek e volume
- Layout responsivo para uso em smartphones
- Dependencias: `flask`, `requests`
- Arquivos principais:
  - `app.py` -- servidor Flask e logica de comunicacao com o PBX
  - `public/index.html` -- interface web
  - `requirements.txt` -- dependencias Python
  - `DEPLOY.md` -- guia completo de instalacao em servidor Debian

**Para executar (desenvolvimento):**
```bash
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
# Acesse http://localhost:5000
```

---

## Estrutura de arquivos

```
Grab Recording/
├── README.md
├── IPPBX-HTTPS-API-Documentation-Center.pdf   # Documentacao oficial da API Grandstream
│
├── GrabRecording/                          # Versao Android (Kotlin)
│   └── app/src/main/java/com/condoconta/grabrecording/
│       ├── MainActivity.kt
│       ├── MainViewModel.kt
│       └── PbxApiClient.kt
│
├── GrabRecordingWebNodeJS/                 # Versao Web (Node.js)
│   ├── server.js
│   ├── package.json
│   └── public/
│       └── index.html
│
├── GrabRecordingWebPython/                 # Versao Web (Python) -- mais completa
│   ├── app.py
│   ├── requirements.txt
│   ├── DEPLOY.md
│   └── public/
│       └── index.html
│
└── GrabRecordingWorker/                    # Versao Cloudflare Worker (serverless)
    ├── worker.js
    └── wrangler.toml
```

---

### Cloudflare Worker (`/GrabRecordingWorker`)

Versao **serverless** que roda na borda da rede Cloudflare, sem custo operacional (plano gratuito).

- Arquivo unico `worker.js` — sem dependencias externas
- O Worker faz proxy das requisicoes HTTPS para o PBX atraves de um **Cloudflare Tunnel**
- Audio transmitido diretamente do PBX ao navegador via streaming (sem armazenar em disco)
- Implementacao MD5 em JS puro (Web Crypto API nao suporta MD5)
- Interface identica as versoes Python e Node.js (wizard passo a passo com player de audio)
- Arquivos principais:
  - `worker.js` — Worker completo (logica + frontend inline)
  - `wrangler.toml` — configuracao do Wrangler CLI

**Pre-requisito:** Cloudflare Tunnel apontando para o PBX local com HTTPS habilitado.

**Para fazer deploy:**
```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

**Para testar localmente:**
```bash
wrangler dev
# Acesse http://localhost:8787
```

---

## Requisitos da API do PBX

- PBX Grandstream UCM6xxx com API HTTPS habilitada (porta padrao: 8089)
- Usuario de API criado no PBX com permissoes de CDR e gravacoes
- Gravacao automatica de chamadas ativada no PBX
