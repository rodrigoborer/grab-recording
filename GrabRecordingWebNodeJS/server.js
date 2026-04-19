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

// ── Cache de audio ────────────────────────────────────────────────────────────
const AUDIO_CACHE_DIR = path.join(os.tmpdir(), 'grab-recording');
if (!fs.existsSync(AUDIO_CACHE_DIR)) fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });

// ── Axios sem verificacao SSL (certificado autoassinado do UCM) ───────────────
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const pbxAxios   = axios.create({ httpsAgent });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Tabela de erros do PBX ────────────────────────────────────────────────────
const PBX_ERRORS = {
  '-6':  'Cookie invalido ou sessao expirada. Reinicie o fluxo.',
  '-7':  'Versao de API incompativel.',
  '-8':  'Parametro obrigatorio ausente na requisicao.',
  '-9':  'Acao desconhecida.',
  '-10': 'Permissao negada. Verifique se o usuario da API tem permissao para esta acao.',
  '-11': 'Falha na autenticacao. Verifique usuario e senha.',
  '-15': 'Recurso nao encontrado.',
  '-25': 'Arquivo nao encontrado no PBX. Verifique filedir e filename.',
  '-30': 'Limite de sessoes simultaneas atingido.',
  '-37': 'Senha incorreta.',
};

function pbxErrorMsg(status, fallback) {
  const msg = PBX_ERRORS[String(status)];
  if (msg) return `${msg} (codigo ${status})`;
  return fallback || `Erro desconhecido do PBX (codigo ${status})`;
}

function pbxUrl(host, port) {
  return `https://${host}:${port}/api`;
}

function md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

async function pbxPost(url, payload, stream = false) {
  const body   = { request: payload };
  const detail = { request: { url, body } };

  const resp = await pbxAxios.post(url, body, {
    headers:      { 'Content-Type': 'application/json; charset=UTF-8' },
    responseType: stream ? 'stream' : 'json',
    timeout:      stream ? 120_000 : 30_000,
  });

  detail.response = { httpStatus: resp.status, headers: Object.fromEntries(Object.entries(resp.headers)) };
  if (!stream) detail.response.body = resp.data;

  return [detail, stream ? resp : resp.data];
}

function ok(res, data = {})       { return res.json({ ok: true,  ...data }); }
function err(res, msg, data = {}) { return res.json({ ok: false, error: msg, ...data }); }


// ── ETAPA 1 — Challenge ───────────────────────────────────────────────────────
app.post('/api/step/challenge', async (req, res) => {
  const { host = '', port = 8089, username = '' } = req.body || {};

  if (!host.trim())     return err(res, 'Informe o endereco IP ou hostname do PBX.');
  if (!username.trim()) return err(res, 'Informe o nome de usuario da API do PBX.');

  try {
    const [detail, data] = await pbxPost(
      pbxUrl(host.trim(), port),
      { action: 'challenge', user: username.trim(), version: '1.0' }
    );
    if (data.status !== 0)
      return err(res, pbxErrorMsg(data.status, `Challenge rejeitado pelo PBX (codigo ${data.status}).`), { detail });

    return ok(res, { challenge: data.response.challenge, detail });
  } catch (e) {
    if (['ECONNREFUSED','ENOTFOUND'].includes(e.code))
      return err(res, `Nao foi possivel conectar ao PBX em ${host}:${port}. Verifique se o IP esta correto, se a porta esta acessivel e se o PBX esta ligado.`);
    if (['ETIMEDOUT','ECONNABORTED'].includes(e.code))
      return err(res, `O PBX em ${host}:${port} nao respondeu em 30 segundos. Verifique conectividade e firewall.`);
    return err(res, `Erro inesperado no challenge: ${e.message}`);
  }
});


// ── ETAPA 2 — Login ───────────────────────────────────────────────────────────
app.post('/api/step/login', async (req, res) => {
  const { host = '', port = 8089, username = '', password = '', challenge = '' } = req.body || {};

  if (!challenge) return err(res, 'Token de challenge ausente. Execute a etapa Challenge primeiro.');
  if (!password)  return err(res, 'Informe a senha da API do PBX.');

  const token = md5(`${challenge}${password}`);

  try {
    const [detail, data] = await pbxPost(
      pbxUrl(host.trim(), port),
      { action: 'login', user: username, token }
    );
    if (data.status !== 0) {
      let msg = pbxErrorMsg(data.status);
      if (data.status === -11) msg = 'Senha incorreta ou usuario sem permissao de API. Verifique as credenciais no PBX.';
      if (data.status === -37) {
        const remain = data.remain_num != null ? ` Tentativas restantes: ${data.remain_num}.` : '';
        msg = `Senha incorreta.${remain}`;
      }
      return err(res, msg, { detail });
    }
    return ok(res, { cookie: data.response.cookie, token, detail });
  } catch (e) {
    return err(res, `Erro inesperado no login: ${e.message}`);
  }
});


// ── ETAPA 3 — CDR ─────────────────────────────────────────────────────────────
app.post('/api/step/cdr', async (req, res) => {
  const { host = '', port = 8089, cookie = '' } = req.body || {};

  if (!cookie) return err(res, 'Cookie de sessao ausente. Execute as etapas Challenge e Login primeiro.');

  const url  = pbxUrl(host.trim(), port);
  const PAGE = 200;

  const now       = new Date();
  const today     = now.toISOString().slice(0, 10);
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const startTime = `${yesterday}T00:00-03:00`;

  const allRecords  = [];
  const pagesDetail = [];
  let lastDetail    = {};
  let offset        = 0;

  try {
    while (true) {
      const [detail, data] = await pbxPost(url, {
        action: 'cdrapi', cookie, format: 'json',
        numRecords: PAGE, offset,
        timeFilterType: 'End', startTime,
      });
      lastDetail = detail;
      pagesDetail.push({ offset, httpStatus: detail.response.httpStatus });

      const status      = data.status;
      const hasCdrRoot  = 'cdr_root' in data;
      if (!hasCdrRoot && status !== 0) {
        let msg = pbxErrorMsg(status);
        if (status === -6)  msg = 'Sessao expirada durante a busca de CDR. Reinicie o fluxo.';
        if (status === -10) msg = 'Sem permissao para acessar CDR. Verifique as permissoes do usuario de API no PBX.';
        return err(res, msg, { detail });
      }

      const pageRecords = data.cdr_root || [];
      allRecords.push(...pageRecords);
      if (pageRecords.length < PAGE) break;
      offset += PAGE;
    }

    // Itera sub-entradas de registros aninhados (main_cdr + sub_cdr_N) e registros planos
    function* iterSubEntries(r) {
      if ('main_cdr' in r) {
        for (const [key, val] of Object.entries(r))
          if (key.startsWith('sub_cdr_') && val && typeof val === 'object') yield val;
      } else {
        yield r;
      }
    }

    const allEntriesWithRec = [];
    for (const r of allRecords) {
      for (const entry of iterSubEntries(r)) {
        const recFile = (entry.recordfiles || '').trim().replace(/@+$/, '').trim();
        if (recFile) {
          allEntriesWithRec.push({
            cdrId:       entry.AcctId    || '',
            caller:      entry.src       || '',
            callee:      entry.dst       || '',
            start:       entry.start     || '',
            duration:    entry.duration  || '0',
            disposition: entry.disposition || '',
            recordFile:  recFile,
          });
        }
      }
    }

    allEntriesWithRec.sort((a, b) => b.start.localeCompare(a.start));

    const baseDetail = {
      request:  lastDetail.request,
      response: lastDetail.response,
      allPages: pagesDetail,
    };

    if (allRecords.length === 0)
      return err(res,
        `Nenhuma chamada encontrada de ${yesterday} ate hoje (${today}). Verifique se ha chamadas registradas no PBX neste periodo.`,
        { totalRecords: 0, totalPages: pagesDetail.length, detail: baseDetail }
      );

    if (allEntriesWithRec.length === 0)
      return err(res,
        `Foram encontradas ${allRecords.length} chamadas de ${yesterday} ate hoje, mas nenhuma possui gravacao. Verifique se a gravacao automatica esta ativa no PBX.`,
        { totalRecords: allRecords.length, totalPages: pagesDetail.length, recordsWithAudio: 0, detail: baseDetail }
      );

    return ok(res, {
      totalRecords:     allRecords.length,
      totalPages:       pagesDetail.length,
      recordsWithAudio: allEntriesWithRec.length,
      recordings:       allEntriesWithRec.slice(0, 5),
      detail:           baseDetail,
    });
  } catch (e) {
    return err(res, `Erro inesperado ao buscar CDR: ${e.message}`);
  }
});


// ── ETAPA 4 — getRecordInfosByCall ────────────────────────────────────────────
app.post('/api/step/recinfo', async (req, res) => {
  const { host = '', port = 8089, cookie = '', acctId } = req.body || {};

  if (!acctId) return err(res, 'AcctId ausente. A etapa CDR nao retornou um registro valido.');

  try {
    const [detail, data] = await pbxPost(
      pbxUrl(host.trim(), port),
      { action: 'getRecordInfosByCall', cookie, id: String(acctId) }
    );
    if (data.status !== 0) {
      let msg = pbxErrorMsg(data.status);
      if (data.status === -15)
        msg = `Registro de gravacao nao encontrado no PBX para AcctId=${acctId}. A chamada pode nao ter sido gravada.`;
      return err(res, msg, { detail });
    }

    const rawPaths = ((data.response || {}).recordfiles || '').trim();
    if (!rawPaths)
      return err(res,
        `O PBX retornou sucesso mas sem arquivos para AcctId=${acctId}. A gravacao pode ter sido apagada ou ainda estar sendo processada.`,
        { detail }
      );

    const allPaths = rawPaths.split(',').map(p => p.trim()).filter(Boolean);
    const chosen   = allPaths[allPaths.length - 1];
    const filename = chosen.includes('/') ? chosen.split('/').pop() : chosen;
    const filedir  = 'monitor';

    return ok(res, { allPaths, chosen, filedir, filename, detail });
  } catch (e) {
    return err(res, `Erro inesperado ao buscar informacoes da gravacao: ${e.message}`);
  }
});


// ── ETAPA 5 — Download (recapi) ───────────────────────────────────────────────
app.post('/api/step/download', async (req, res) => {
  const { host = '', port = 8089, cookie = '', filedir = '', filename = '' } = req.body || {};

  if (!filename) return err(res, 'Nome do arquivo ausente. A etapa getRecordInfosByCall nao retornou um filename valido.');
  if (!filedir)  return err(res, 'Diretorio do arquivo ausente. A etapa getRecordInfosByCall nao retornou um filedir valido.');

  const url       = pbxUrl(host.trim(), port);
  const localName = path.basename(filename);
  const destPath  = path.join(AUDIO_CACHE_DIR, localName);
  const payload   = { action: 'recapi', cookie, filedir, filename };

  try {
    const [detail, resp] = await pbxPost(url, payload, true);
    const contentType = resp.headers['content-type'] || '';
    detail.response.contentType = contentType;

    if (contentType.includes('application/json')) {
      const chunks = [];
      for await (const chunk of resp.data) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      detail.response.body = raw;
      let msg;
      try {
        const bodyJson = JSON.parse(raw);
        msg = pbxErrorMsg(bodyJson.status, `O PBX recusou o download do arquivo '${filename}'.`);
      } catch (_) {
        msg = 'O PBX retornou JSON inesperado em vez do arquivo de audio.';
      }
      return err(res, msg, { raw, detail });
    }

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destPath);
      resp.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const fileSize = fs.statSync(destPath).size;
    if (fileSize === 0) {
      fs.unlinkSync(destPath);
      return err(res, 'O PBX enviou um arquivo vazio. A gravacao pode estar corrompida ou indisponivel.');
    }

    detail.response.fileSizeBytes = fileSize;
    return ok(res, { filename: localName, fileSizeBytes: fileSize, audioUrl: `/api/audio/${localName}`, detail });
  } catch (e) {
    return err(res, `Erro inesperado no download: ${e.message}`);
  }
});


// ── ETAPA 6 — Logout ──────────────────────────────────────────────────────────
app.post('/api/step/logout', async (req, res) => {
  const { host = '', port = 8089, cookie = '' } = req.body || {};
  try {
    const [detail] = await pbxPost(pbxUrl(host.trim(), port), { action: 'logout', cookie });
    return ok(res, { detail });
  } catch (e) {
    return res.json({ ok: true, warning: `Logout nao realizado (nao critico): ${e.message}` });
  }
});


// ── Servir audio com suporte a Range ──────────────────────────────────────────
app.get('/api/audio/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(AUDIO_CACHE_DIR, filename);

  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: 'Arquivo nao encontrado.' });

  const stat  = fs.statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const parts  = range.replace(/bytes=/, '').split('-');
    const start  = parseInt(parts[0], 10);
    const end    = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const length = end - start + 1;
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': length,
      'Content-Type':   'audio/wav',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type':   'audio/wav',
      'Accept-Ranges':  'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});


app.listen(PORT, () => {
  console.log(`\nServidor iniciado -> http://localhost:${PORT}`);
  console.log(`Cache de audio: ${AUDIO_CACHE_DIR}\n`);
});
