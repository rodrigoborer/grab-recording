'use strict';

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Cache de áudio ─────────────────────────────────────────────────────────
const AUDIO_CACHE_DIR = path.join(os.tmpdir(), 'grab-recording');
if (!fs.existsSync(AUDIO_CACHE_DIR)) fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });

// ── Axios sem verificação SSL (certificado autoassinado do UCM) ────────────
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const pbxAxios   = axios.create({ httpsAgent, timeout: 30_000 });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────────────────────
// Logger com timestamp
// ─────────────────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString().replace('T', ' ').substring(0, 23);
}
function log(label, ...args) {
  console.log(`[${ts()}] ${label}`, ...args);
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming NDJSON — envia uma linha JSON por vez ao browser
// ─────────────────────────────────────────────────────────────────────────────
function makeStream(res) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  return function send(obj) {
    const line = JSON.stringify(obj) + '\n';
    log(`[STREAM →]`, JSON.stringify(obj).substring(0, 200));
    res.write(line);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers PBX
// ─────────────────────────────────────────────────────────────────────────────
function md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}
function pbxUrl(host, port) {
  return `https://${host}:${port}/api`;
}

async function pbxPost(url, payload, send) {
  const body = { request: payload };
  log(`  → POST ${url}`, JSON.stringify(payload).substring(0, 300));
  send({ type: 'request', url, payload });

  const res = await pbxAxios.post(url, body, {
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Connection': 'close' }
  });

  log(`  ← HTTP ${res.status}`, JSON.stringify(res.data).substring(0, 500));
  send({ type: 'response', status: res.status, body: res.data });

  return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/fetch  — stream NDJSON com todas as etapas
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/fetch', async (req, res) => {
  const { host, port = 8089, username, password } = req.body;
  const send = makeStream(res);

  if (!host || !username || !password) {
    send({ type: 'error', step: 'validation', msg: 'Informe host, username e password.' });
    return res.end();
  }

  const url = pbxUrl(host, Number(port));
  log(`\n${'='.repeat(60)}`);
  log(`Nova sessão: ${username}@${host}:${port}`);
  log(`URL base: ${url}`);

  send({ type: 'info', step: 'init', msg: `Iniciando conexão com ${host}:${port}` });
  send({ type: 'info', step: 'init', msg: `URL da API: ${url}` });

  let cookie;
  try {
    // ── 1. Challenge ────────────────────────────────────────────────────────
    send({ type: 'step', step: 'challenge', msg: 'Enviando requisição de challenge...' });
    let data;
    try {
      data = await pbxPost(url, { action: 'challenge', user: username, version: '1.0' }, send);
    } catch (err) {
      const detail = err.code === 'ECONNREFUSED' ? 'Conexão recusada — verifique o IP e a porta.'
        : err.code === 'ETIMEDOUT'    ? 'Timeout — servidor não respondeu em 30s.'
        : err.code === 'ENOTFOUND'    ? 'Host não encontrado — verifique o endereço IP.'
        : err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ? 'Certificado SSL inválido (já deveria ser ignorado).'
        : err.message;
      send({ type: 'error', step: 'challenge', msg: `Falha na conexão: ${detail}`, code: err.code, raw: String(err) });
      return res.end();
    }

    if (data.status !== 0) {
      send({ type: 'error', step: 'challenge', msg: `Challenge retornou status=${data.status}`, body: data });
      return res.end();
    }
    const challenge = data.response.challenge;
    send({ type: 'ok', step: 'challenge', msg: `Challenge recebido: ${challenge}` });

    // ── 2. Login ────────────────────────────────────────────────────────────
    const token = md5(`${challenge}${password}`);
    send({ type: 'info', step: 'login', msg: `Token MD5 gerado: ${token}` });
    send({ type: 'step', step: 'login', msg: 'Enviando login...' });

    data = await pbxPost(url, { action: 'login', user: username, token }, send);
    if (data.status !== 0) {
      send({ type: 'error', step: 'login', msg: `Login falhou (status=${data.status}) — verifique usuário/senha`, body: data });
      return res.end();
    }
    cookie = data.response.cookie;
    send({ type: 'ok', step: 'login', msg: `Autenticado! Cookie: ${cookie}` });

    // ── 3. CDR ──────────────────────────────────────────────────────────────
    send({ type: 'step', step: 'cdr', msg: 'Buscando registros CDR (últimos 200)...' });
    data = await pbxPost(url, {
      action: 'cdrapi', cookie, format: 'json', numRecords: 200, timeFilterType: 'End'
    }, send);

    // Alguns modelos UCM omitem "status" na resposta CDR quando bem-sucedido.
    // Aceita se cdr_root está presente, mesmo sem status=0.
    if (!('cdr_root' in data) && data.status !== 0) {
      send({ type: 'error', step: 'cdr', msg: `CDR falhou (status=${data.status})`, body: data });
      return res.end();
    }

    const records = data.cdr_root || [];
    send({ type: 'info', step: 'cdr', msg: `${records.length} registro(s) retornado(s)` });

    // Suporte a dois formatos de resposta do UCM:
    // - Plano:   record.src, record.recordfiles, ...
    // - Aninhado: record.main_cdr.src, record.main_cdr.recordfiles, ...
    const cdrFields = r => r.main_cdr || r;

    const withRec = records.filter(r => (cdrFields(r).recordfiles || '').trim());
    send({ type: 'info', step: 'cdr', msg: `${withRec.length} registro(s) com gravação` });

    let recording = null;
    for (let i = records.length - 1; i >= 0; i--) {
      const f = cdrFields(records[i]);
      const recFile = (f.recordfiles || '').trim();
      if (recFile) {
        recording = {
          cdrId: f.AcctId || '', caller: f.src || '', callee: f.dst || '',
          start: f.start || '', end: f.end || '', duration: f.duration || '0',
          disposition: f.disposition || '', recordFile: recFile
        };
        break;
      }
    }

    if (!recording) {
      send({ type: 'error', step: 'cdr', msg: 'Nenhuma chamada com gravação encontrada. Verifique se a gravação automática está ativa no PBX.' });
      return res.end();
    }
    send({ type: 'ok', step: 'cdr', msg: `Gravação encontrada: ${recording.recordFile}`, data: recording });

    // ── 4. getRecordInfosByCall — obtém o caminho real do arquivo ───────────
    const acctId = recording.cdrId;
    send({ type: 'step', step: 'recinfo', msg: `Consultando getRecordInfosByCall (AcctId=${acctId})...` });
    const recInfo = await pbxPost(url, {
      action: 'getRecordInfosByCall', cookie, id: String(acctId)
    }, send);

    if (recInfo.status !== 0) {
      send({ type: 'error', step: 'recinfo',
             msg: `getRecordInfosByCall falhou (status=${recInfo.status})`, body: recInfo });
      return res.end();
    }

    const rawPaths = ((recInfo.response || {}).recordfiles || '').trim();
    if (!rawPaths) {
      send({ type: 'error', step: 'recinfo',
             msg: 'getRecordInfosByCall não retornou nenhum arquivo.', body: recInfo });
      return res.end();
    }

    // Pode haver múltiplos arquivos separados por vírgula — pega o último
    const allPaths  = rawPaths.split(',').map(p => p.trim()).filter(Boolean);
    const chosenPath = allPaths[allPaths.length - 1];
    send({ type: 'ok', step: 'recinfo',
           msg: `Arquivo(s) encontrado(s): ${rawPaths}`,
           data: { chosen: chosenPath, all: allPaths } });

    // Separa filedir (ex: "2024-10") do nome do arquivo
    let filedir, filename;
    if (chosenPath.includes('/')) {
      const slashIdx = chosenPath.lastIndexOf('/');
      filedir  = chosenPath.substring(0, slashIdx);
      filename = chosenPath.substring(slashIdx + 1);
    } else {
      filedir  = 'monitor';
      filename = chosenPath;
    }
    send({ type: 'info', step: 'recinfo', msg: `filedir=${filedir}  filename=${filename}` });

    // ── 5. Download recapi ──────────────────────────────────────────────────
    const destPath = path.join(AUDIO_CACHE_DIR, filename);
    send({ type: 'step', step: 'download', msg: `Baixando arquivo: ${filename}` });
    send({ type: 'info', step: 'download', msg: `Destino local: ${destPath}` });

    const recPayload = { action: 'recapi', cookie, filedir, filename };
    send({ type: 'request', url, payload: recPayload });
    log(`  → POST recapi filedir=${filedir} filename=${filename}`);

    const audioRes = await pbxAxios.post(url,
      { request: recPayload },
      { headers: { 'Content-Type': 'application/json; charset=UTF-8' }, responseType: 'stream', timeout: 120_000 }
    );

    send({ type: 'response', status: audioRes.status, headers: audioRes.headers });
    log(`  ← HTTP ${audioRes.status} Content-Type: ${audioRes.headers['content-type']}`);

    const contentType = audioRes.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      const chunks = [];
      for await (const chunk of audioRes.data) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      send({ type: 'error', step: 'download', msg: 'PBX retornou JSON em vez do arquivo de áudio', raw: body });
      return res.end();
    }

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destPath);
      audioRes.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const fileSize = fs.statSync(destPath).size;
    send({ type: 'ok', step: 'download', msg: `Download concluído: ${fileSize} bytes` });

    // ── 5. Logout ───────────────────────────────────────────────────────────
    try {
      send({ type: 'step', step: 'logout', msg: 'Encerrando sessão...' });
      await pbxPost(url, { action: 'logout', cookie }, send);
      send({ type: 'ok', step: 'logout', msg: 'Logout realizado.' });
    } catch (_) {
      send({ type: 'info', step: 'logout', msg: 'Logout ignorado (não crítico).' });
    }
    cookie = null;

    // ── Resultado final ─────────────────────────────────────────────────────
    send({ type: 'done', recording, audioFile: filename, fileSizeBytes: fileSize });

  } catch (err) {
    log(`[ERRO INESPERADO]`, err.message, err.stack);
    send({ type: 'error', step: 'unknown', msg: `Erro inesperado: ${err.message}`, raw: String(err) });
  } finally {
    if (cookie) {
      try { await pbxPost(pbxUrl(host, Number(port)), { action: 'logout', cookie }, () => {}); } catch (_) {}
    }
    res.end();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audio/:filename  — serve o arquivo com suporte a range requests
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/audio/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(AUDIO_CACHE_DIR, filename);
  log(`[AUDIO] Servindo: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    log(`[AUDIO] Não encontrado: ${filePath}`);
    return res.status(404).json({ error: 'Arquivo não encontrado no cache. Faça o fetch novamente.' });
  }

  const stat    = fs.statSync(filePath);
  const ext     = path.extname(filename).toLowerCase();
  const mimeMap = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
  const mime    = mimeMap[ext] || 'audio/wav';
  const range   = req.headers.range;

  if (range) {
    const parts     = range.replace(/bytes=/, '').split('-');
    const start     = parseInt(parts[0], 10);
    const end       = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = (end - start) + 1;
    log(`[AUDIO] Range ${start}-${end}/${stat.size}`);
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes', 'Content-Length': chunkSize, 'Content-Type': mime
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    log(`[AUDIO] Completo ${stat.size} bytes`);
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Grab Recording rodando em http://localhost:${PORT}`);
  console.log(`   Cache de áudio: ${AUDIO_CACHE_DIR}\n`);
});
