'use strict';

// ── MD5 em JS puro (Web Crypto API nao suporta MD5) ──────────────────────────
// Baseado em implementacao public domain de Joseph Myers
function md5(str) {
  function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    return ((x >> 16) + (y >> 16) + (lsw >> 16)) << 16 | lsw & 0xffff;
  }
  function bitRotateLeft(num, cnt) { return num << cnt | num >>> (32 - cnt); }
  function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn(b & c | ~b & d, a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn(b & d | c & ~d, a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }

  const bytes = new TextEncoder().encode(str);
  const len8  = bytes.length;
  const len32 = Math.ceil((len8 + 9) / 64) * 16;
  const M     = new Int32Array(len32);
  for (let i = 0; i < len8; i++) M[i >> 2] |= bytes[i] << (i % 4 * 8);
  M[len8 >> 2] |= 0x80 << (len8 % 4 * 8);
  M[len32 - 2]  = len8 * 8;

  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < len32; i += 16) {
    const [oa, ob, oc, od] = [a, b, c, d];
    a=md5ff(a,b,c,d,M[i],7,-680876936);    d=md5ff(d,a,b,c,M[i+1],12,-389564586);
    c=md5ff(c,d,a,b,M[i+2],17,606105819);  b=md5ff(b,c,d,a,M[i+3],22,-1044525330);
    a=md5ff(a,b,c,d,M[i+4],7,-176418897);  d=md5ff(d,a,b,c,M[i+5],12,1200080426);
    c=md5ff(c,d,a,b,M[i+6],17,-1473231341);b=md5ff(b,c,d,a,M[i+7],22,-45705983);
    a=md5ff(a,b,c,d,M[i+8],7,1770035416);  d=md5ff(d,a,b,c,M[i+9],12,-1958414417);
    c=md5ff(c,d,a,b,M[i+10],17,-42063);    b=md5ff(b,c,d,a,M[i+11],22,-1990404162);
    a=md5ff(a,b,c,d,M[i+12],7,1804603682); d=md5ff(d,a,b,c,M[i+13],12,-40341101);
    c=md5ff(c,d,a,b,M[i+14],17,-1502002290);b=md5ff(b,c,d,a,M[i+15],22,1236535329);
    a=md5gg(a,b,c,d,M[i+1],5,-165796510);  d=md5gg(d,a,b,c,M[i+6],9,-1069501632);
    c=md5gg(c,d,a,b,M[i+11],14,643717713); b=md5gg(b,c,d,a,M[i],20,-373897302);
    a=md5gg(a,b,c,d,M[i+5],5,-701558691);  d=md5gg(d,a,b,c,M[i+10],9,38016083);
    c=md5gg(c,d,a,b,M[i+15],14,-660478335);b=md5gg(b,c,d,a,M[i+4],20,-405537848);
    a=md5gg(a,b,c,d,M[i+9],5,568446438);   d=md5gg(d,a,b,c,M[i+14],9,-1019803690);
    c=md5gg(c,d,a,b,M[i+3],14,-187363961); b=md5gg(b,c,d,a,M[i+8],20,1163531501);
    a=md5gg(a,b,c,d,M[i+13],5,-1444681467);d=md5gg(d,a,b,c,M[i+2],9,-51403784);
    c=md5gg(c,d,a,b,M[i+7],14,1735328473); b=md5gg(b,c,d,a,M[i+12],20,-1926607734);
    a=md5hh(a,b,c,d,M[i+5],4,-378558);     d=md5hh(d,a,b,c,M[i+8],11,-2022574463);
    c=md5hh(c,d,a,b,M[i+11],16,1839030562);b=md5hh(b,c,d,a,M[i+14],23,-35309556);
    a=md5hh(a,b,c,d,M[i+1],4,-1530992060); d=md5hh(d,a,b,c,M[i+4],11,1272893353);
    c=md5hh(c,d,a,b,M[i+7],16,-155497632); b=md5hh(b,c,d,a,M[i+10],23,-1094730640);
    a=md5hh(a,b,c,d,M[i+13],4,681279174);  d=md5hh(d,a,b,c,M[i],11,-358537222);
    c=md5hh(c,d,a,b,M[i+3],16,-722521979); b=md5hh(b,c,d,a,M[i+6],23,76029189);
    a=md5hh(a,b,c,d,M[i+9],4,-640364487);  d=md5hh(d,a,b,c,M[i+12],11,-421815835);
    c=md5hh(c,d,a,b,M[i+15],16,530742520); b=md5hh(b,c,d,a,M[i+2],23,-995338651);
    a=md5ii(a,b,c,d,M[i],6,-198630844);    d=md5ii(d,a,b,c,M[i+7],10,1126891415);
    c=md5ii(c,d,a,b,M[i+14],15,-1416354905);b=md5ii(b,c,d,a,M[i+5],21,-57434055);
    a=md5ii(a,b,c,d,M[i+12],6,1700485571); d=md5ii(d,a,b,c,M[i+3],10,-1894986606);
    c=md5ii(c,d,a,b,M[i+10],15,-1051523);  b=md5ii(b,c,d,a,M[i+1],21,-2054922799);
    a=md5ii(a,b,c,d,M[i+8],6,1873313359);  d=md5ii(d,a,b,c,M[i+15],10,-30611744);
    c=md5ii(c,d,a,b,M[i+6],15,-1560198380);b=md5ii(b,c,d,a,M[i+13],21,1309151649);
    a=md5ii(a,b,c,d,M[i+4],6,-145523070);  d=md5ii(d,a,b,c,M[i+11],10,-1120210379);
    c=md5ii(c,d,a,b,M[i+2],15,718787259);  b=md5ii(b,c,d,a,M[i+9],21,-343485551);
    a=safeAdd(a,oa); b=safeAdd(b,ob); c=safeAdd(c,oc); d=safeAdd(d,od);
  }

  const hex = [a, b, c, d].map(n =>
    Array.from({length: 4}, (_, i) => ((n >> i*8) & 0xff).toString(16).padStart(2,'0')).join('')
  ).join('');
  return hex;
}

// ── Erros do PBX ─────────────────────────────────────────────────────────────
const PBX_ERRORS = {
  '-6':  'Cookie invalido ou sessao expirada. Reinicie o fluxo.',
  '-7':  'Versao de API incompativel.',
  '-8':  'Parametro obrigatorio ausente na requisicao.',
  '-9':  'Acao desconhecida.',
  '-10': 'Permissao negada. Verifique as permissoes do usuario de API no PBX.',
  '-11': 'Falha na autenticacao. Verifique usuario e senha.',
  '-15': 'Recurso nao encontrado.',
  '-25': 'Arquivo nao encontrado no PBX.',
  '-30': 'Limite de sessoes simultaneas atingido.',
  '-37': 'Senha incorreta.',
};

function pbxErrorMsg(status, fallback) {
  const msg = PBX_ERRORS[String(status)];
  if (msg) return `${msg} (codigo ${status})`;
  return fallback || `Erro desconhecido do PBX (codigo ${status})`;
}

function pbxUrl(host, port) {
  const p = parseInt(port, 10);
  return p === 443 ? `https://${host}/api` : `https://${host}:${port}/api`;
}

async function pbxPost(url, payload) {
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body:    JSON.stringify({ request: payload }),
  });
  return resp;
}

function okJson(data = {})       { return Response.json({ ok: true,  ...data }); }
function errJson(msg, data = {}) { return Response.json({ ok: false, error: msg, ...data }); }

// ── ETAPA 1 — Challenge ───────────────────────────────────────────────────────
async function handleChallenge(req) {
  const { host = '', port = 443, username = '' } = await req.json();
  if (!host.trim())     return errJson('Informe o hostname do Cloudflare Tunnel (ex: pbx.seudominio.com).');
  if (!username.trim()) return errJson('Informe o nome de usuario da API do PBX.');

  try {
    const resp = await pbxPost(pbxUrl(host.trim(), port), { action: 'challenge', user: username.trim(), version: '1.0' });
    const data = await resp.json();
    if (data.status !== 0) return errJson(pbxErrorMsg(data.status, `Challenge rejeitado (codigo ${data.status}).`));
    return okJson({ challenge: data.response.challenge });
  } catch (e) {
    return errJson(`Erro ao conectar ao PBX: ${e.message}. Verifique se o Cloudflare Tunnel esta ativo.`);
  }
}

// ── ETAPA 2 — Login ───────────────────────────────────────────────────────────
async function handleLogin(req) {
  const { host = '', port = 443, username = '', password = '', challenge = '' } = await req.json();
  if (!challenge) return errJson('Token de challenge ausente. Execute a etapa Challenge primeiro.');
  if (!password)  return errJson('Informe a senha da API do PBX.');

  const token = md5(`${challenge}${password}`);
  try {
    const resp = await pbxPost(pbxUrl(host.trim(), port), { action: 'login', user: username, token });
    const data = await resp.json();
    if (data.status !== 0) {
      let msg = pbxErrorMsg(data.status);
      if (data.status === -11) msg = 'Senha incorreta ou usuario sem permissao de API.';
      if (data.status === -37) {
        const remain = data.remain_num != null ? ` Tentativas restantes: ${data.remain_num}.` : '';
        msg = `Senha incorreta.${remain}`;
      }
      return errJson(msg);
    }
    return okJson({ cookie: data.response.cookie, token });
  } catch (e) {
    return errJson(`Erro inesperado no login: ${e.message}`);
  }
}

// ── ETAPA 3 — CDR ─────────────────────────────────────────────────────────────
async function handleCdr(req) {
  const { host = '', port = 443, cookie = '' } = await req.json();
  if (!cookie) return errJson('Cookie de sessao ausente.');

  const url  = pbxUrl(host.trim(), port);
  const PAGE = 200;

  const now       = new Date();
  const yesterday = new Date(now - 86_400_000);
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const startTime = `${fmt(yesterday)}T00:00-03:00`;

  const allRecords  = [];
  const pagesDetail = [];
  let offset = 0;

  try {
    while (true) {
      const resp = await pbxPost(url, {
        action: 'cdrapi', cookie, format: 'json',
        numRecords: PAGE, offset,
        timeFilterType: 'End', startTime,
      });
      const data = await resp.json();
      pagesDetail.push({ offset, httpStatus: resp.status });

      const hasCdrRoot = 'cdr_root' in data;
      if (!hasCdrRoot && data.status !== 0) {
        let msg = pbxErrorMsg(data.status);
        if (data.status === -6)  msg = 'Sessao expirada durante a busca de CDR. Reinicie o fluxo.';
        if (data.status === -10) msg = 'Sem permissao para acessar CDR.';
        return errJson(msg);
      }

      const pageRecords = data.cdr_root || [];
      allRecords.push(...pageRecords);
      if (pageRecords.length < PAGE) break;
      offset += PAGE;
    }

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

    const today = fmt(now);

    if (allRecords.length === 0)
      return errJson(
        `Nenhuma chamada encontrada de ${fmt(yesterday)} ate hoje (${today}).`,
        { totalRecords: 0, totalPages: pagesDetail.length, detail: { allPages: pagesDetail } }
      );

    if (allEntriesWithRec.length === 0)
      return errJson(
        `Foram encontradas ${allRecords.length} chamadas, mas nenhuma possui gravacao.`,
        { totalRecords: allRecords.length, totalPages: pagesDetail.length, recordsWithAudio: 0, detail: { allPages: pagesDetail } }
      );

    return okJson({
      totalRecords:     allRecords.length,
      totalPages:       pagesDetail.length,
      recordsWithAudio: allEntriesWithRec.length,
      recordings:       allEntriesWithRec.slice(0, 5),
      detail:           { allPages: pagesDetail },
    });
  } catch (e) {
    return errJson(`Erro inesperado ao buscar CDR: ${e.message}`);
  }
}

// ── ETAPA 4 — getRecordInfosByCall ────────────────────────────────────────────
async function handleRecinfo(req) {
  const { host = '', port = 443, cookie = '', acctId } = await req.json();
  if (!acctId) return errJson('AcctId ausente.');

  try {
    const resp = await pbxPost(pbxUrl(host.trim(), port), { action: 'getRecordInfosByCall', cookie, id: String(acctId) });
    const data = await resp.json();
    if (data.status !== 0) {
      let msg = pbxErrorMsg(data.status);
      if (data.status === -15) msg = `Gravacao nao encontrada no PBX para AcctId=${acctId}.`;
      return errJson(msg);
    }

    const rawPaths = ((data.response || {}).recordfiles || '').trim();
    if (!rawPaths) return errJson(`PBX retornou sucesso mas sem arquivos para AcctId=${acctId}.`);

    const allPaths = rawPaths.split(',').map(p => p.trim()).filter(Boolean);
    const chosen   = allPaths[allPaths.length - 1];
    const filename = chosen.includes('/') ? chosen.split('/').pop() : chosen;
    const filedir  = 'monitor';

    return okJson({ allPaths, chosen, filedir, filename });
  } catch (e) {
    return errJson(`Erro inesperado ao buscar informacoes da gravacao: ${e.message}`);
  }
}

// ── ETAPA 5 — Download (recapi) — stream direto para o cliente ────────────────
async function handleDownload(req) {
  const { host = '', port = 443, cookie = '', filedir = '', filename = '' } = await req.json();
  if (!filename) return errJson('Nome do arquivo ausente.');
  if (!filedir)  return errJson('Diretorio do arquivo ausente.');

  try {
    const resp = await pbxPost(pbxUrl(host.trim(), port), { action: 'recapi', cookie, filedir, filename });
    const contentType = resp.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const raw  = await resp.text();
      let msg = 'O PBX recusou o download do arquivo.';
      try {
        const bodyJson = JSON.parse(raw);
        msg = pbxErrorMsg(bodyJson.status, msg);
      } catch (_) {}
      return errJson(msg, { raw });
    }

    // Retorna o audio diretamente ao navegador
    const audioHeaders = new Headers({
      'Content-Type':        'audio/wav',
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control':       'no-store',
    });
    if (resp.headers.has('content-length')) {
      audioHeaders.set('Content-Length', resp.headers.get('content-length'));
    }

    return new Response(resp.body, { status: 200, headers: audioHeaders });
  } catch (e) {
    return errJson(`Erro inesperado no download: ${e.message}`);
  }
}

// ── ETAPA 6 — Logout ──────────────────────────────────────────────────────────
async function handleLogout(req) {
  const { host = '', port = 443, cookie = '' } = await req.json();
  try {
    await pbxPost(pbxUrl(host.trim(), port), { action: 'logout', cookie });
    return okJson();
  } catch (e) {
    return Response.json({ ok: true, warning: `Logout nao realizado (nao critico): ${e.message}` });
  }
}

// ── Frontend HTML ─────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Grab Recording — PBX</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; }
  .container { max-width: 860px; margin: 0 auto; padding: 20px 12px; }
  h1 { font-size: 1.3rem; font-weight: 700; color: #7dd3fc; margin-bottom: 16px; }
  h1 span { color: #94a3b8; font-weight: 400; font-size: .85rem; margin-left: 6px; }
  .conn-card { background: #1e2130; border: 1px solid #2d3148; border-radius: 10px; padding: 16px; margin-bottom: 20px; }
  .conn-card h2 { font-size: .85rem; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8; margin-bottom: 12px; }
  .fields { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 10px; }
  .fields label { display: flex; flex-direction: column; gap: 4px; font-size: .8rem; color: #94a3b8; }
  .fields input { background: #0f1117; border: 1px solid #2d3148; border-radius: 6px; padding: 8px 10px; color: #e2e8f0; font-size: 1rem; outline: none; transition: border-color .15s; width: 100%; }
  .fields input:focus { border-color: #7dd3fc; }
  .conn-hint { font-size: .75rem; color: #64748b; margin-top: 8px; }
  .conn-actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
  .btn { padding: 10px 18px; border: none; border-radius: 8px; font-size: .9rem; font-weight: 600; cursor: pointer; transition: opacity .15s, transform .1s; display: inline-flex; align-items: center; justify-content: center; gap: 6px; touch-action: manipulation; }
  .btn:active { transform: scale(.97); }
  .btn:disabled { opacity: .4; cursor: not-allowed; }
  .btn-primary { background: #3b82f6; color: #fff; }
  .btn-success { background: #22c55e; color: #fff; }
  .btn-warning { background: #f59e0b; color: #000; }
  .btn-ghost   { background: #1e2130; border: 1px solid #2d3148; color: #94a3b8; }
  .btn-sm { padding: 8px 14px; font-size: .82rem; }
  .steps { display: flex; flex-direction: column; gap: 10px; }
  .step-card { border-radius: 10px; border: 1px solid #2d3148; overflow: hidden; transition: border-color .2s; }
  .step-card.active  { border-color: #3b82f6; }
  .step-card.done    { border-color: #22c55e44; }
  .step-card.failed  { border-color: #ef444488; }
  .step-card.waiting { opacity: .45; }
  .step-header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #1e2130; cursor: pointer; user-select: none; }
  .step-badge { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: .75rem; font-weight: 700; flex-shrink: 0; }
  .badge-waiting { background: #2d3148; color: #64748b; }
  .badge-active  { background: #3b82f6; color: #fff; }
  .badge-done    { background: #22c55e; color: #fff; }
  .badge-failed  { background: #ef4444; color: #fff; }
  .badge-loading { background: #f59e0b; color: #000; animation: pulse .8s infinite alternate; }
  @keyframes pulse { from { opacity: .6; } to { opacity: 1; } }
  .step-title { font-size: .88rem; font-weight: 600; flex: 1; }
  .step-summary { font-size: .75rem; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .step-chevron { color: #4b5563; font-size: .8rem; transition: transform .2s; flex-shrink: 0; }
  .step-card.open .step-chevron { transform: rotate(180deg); }
  .step-body { background: #13161f; padding: 14px; display: none; }
  .step-card.open .step-body { display: block; }
  .detail-section { margin-bottom: 12px; }
  .detail-section h4 { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: #64748b; margin-bottom: 6px; }
  .json-box { background: #0a0c12; border: 1px solid #1e2539; border-radius: 6px; padding: 10px; font-family: monospace; font-size: .72rem; line-height: 1.6; color: #93c5fd; white-space: pre-wrap; word-break: break-all; max-height: 280px; overflow-y: auto; }
  .kv-grid { display: grid; grid-template-columns: auto 1fr; gap: 5px 10px; font-size: .8rem; }
  .kv-key { color: #94a3b8; white-space: nowrap; }
  .kv-val { color: #e2e8f0; font-family: monospace; word-break: break-all; }
  .kv-val.good { color: #4ade80; } .kv-val.bad { color: #f87171; }
  .step-actions { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
  .step-error { color: #f87171; font-size: .82rem; background: #2d0f0f; border: 1px solid #7f1d1d; border-radius: 6px; padding: 8px 12px; margin-top: 10px; line-height: 1.5; }
  .audio-card { background: #1e2130; border: 1px solid #22c55e44; border-radius: 10px; padding: 16px; margin-top: 16px; }
  .audio-card h3 { font-size: .85rem; text-transform: uppercase; letter-spacing: .06em; color: #22c55e; margin-bottom: 12px; }
  .audio-meta { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: .8rem; margin-bottom: 14px; }
  .audio-meta .k { color: #94a3b8; } .audio-meta .v { color: #e2e8f0; }
  .player-wrap { display: flex; flex-direction: column; gap: 12px; }
  .seekbar { width: 100%; height: 8px; -webkit-appearance: none; appearance: none; border-radius: 4px; background: #2d3148; outline: none; cursor: pointer; }
  .seekbar::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 50%; background: #3b82f6; }
  .player-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .time-label { font-size: .8rem; color: #64748b; min-width: 80px; }
  .vol-wrap { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .vol-wrap label { font-size: .75rem; color: #64748b; }
  .vol-slider { width: 70px; }
  .rec-list { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
  .rec-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: #1e2130; border: 1px solid #2d3148; border-radius: 8px; }
  .rec-row.rec-selected { border-color: #22c55e; background: #0d2318; }
  .rec-info { flex: 1; min-width: 0; }
  .rec-date { font-size: .82rem; color: #e2e8f0; font-weight: 600; display: block; }
  .rec-meta { font-size: .75rem; color: #94a3b8; display: block; margin-top: 2px; }
  @media (max-width: 600px) {
    .fields { grid-template-columns: 1fr 1fr; }
    .rec-row { flex-direction: column; align-items: stretch; gap: 8px; }
    .rec-row .btn { width: 100%; }
    .conn-actions { flex-direction: column; }
    .conn-actions .btn { width: 100%; }
    .step-summary { display: none; }
  }
</style>
</head>
<body>
<div class="container">
  <h1>🎙 Grab Recording <span>PBX Grandstream UCM · Cloudflare Worker</span></h1>

  <div class="conn-card">
    <h2>Conexao</h2>
    <div class="fields">
      <label>Hostname (Tunnel) <input id="f-host" placeholder="pbx.seudominio.com" autocomplete="off"/></label>
      <label>Porta <input id="f-port" placeholder="443" value="443"/></label>
      <label>Usuario <input id="f-user" placeholder="admin" autocomplete="off"/></label>
      <label>Senha <input id="f-pass" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"/></label>
    </div>
    <p class="conn-hint">Use o hostname do seu Cloudflare Tunnel (ex: pbx.seudominio.com) com porta 443.</p>
    <div class="conn-actions">
      <button class="btn btn-success" onclick="startAuto()">&#9889; Iniciar</button>
      <button class="btn btn-primary" onclick="startFlow()">&#9654; Debug</button>
      <button class="btn btn-ghost"   onclick="resetFlow()">&#8634; Reiniciar</button>
    </div>
  </div>

  <div class="steps" id="steps-container"></div>

  <div class="audio-card" id="audio-card" style="display:none">
    <h3>&#10003; Gravacao pronta</h3>
    <div class="audio-meta" id="audio-meta"></div>
    <div class="player-wrap">
      <input type="range" class="seekbar" id="seekbar" value="0" min="0" step="0.1"/>
      <div class="player-controls">
        <button class="btn btn-ghost btn-sm" onclick="skip(-10)">&#9194; 10s</button>
        <button class="btn btn-primary btn-sm" id="play-btn" onclick="togglePlay()">&#9654; Play</button>
        <button class="btn btn-ghost btn-sm" onclick="skip(10)">10s &#9193;</button>
        <span class="time-label" id="time-label">0:00 / 0:00</span>
        <div class="vol-wrap">
          <label>Vol</label>
          <input type="range" class="vol-slider" id="vol-slider" min="0" max="1" step="0.05" value="1" oninput="audio.volume=this.value"/>
        </div>
      </div>
    </div>
    <audio id="audio-el" preload="metadata"></audio>
  </div>
</div>

<script>
const S = { host:'', port:'443', username:'', password:'', challenge:'', cookie:'', audioUrl:'', selectedRecording: null };
let _selectResolve = null;

const CRED_KEY = 'pbx_creds_worker';
function saveCreds() { localStorage.setItem(CRED_KEY, JSON.stringify({host:S.host,port:S.port,username:S.username,password:S.password})); }
function loadCreds() {
  try {
    const c = JSON.parse(localStorage.getItem(CRED_KEY)||'{}');
    if(c.host)     { S.host=c.host;         document.getElementById('f-host').value=c.host; }
    if(c.port)     { S.port=c.port;         document.getElementById('f-port').value=c.port; }
    if(c.username) { S.username=c.username; document.getElementById('f-user').value=c.username; }
    if(c.password) { S.password=c.password; document.getElementById('f-pass').value=c.password; }
  } catch(_) {}
}

const STEPS = [
  { id:'challenge', label:'Challenge',            desc:'Obtem token de autenticacao do PBX' },
  { id:'login',     label:'Login',                desc:'Autentica com usuario e senha (MD5)' },
  { id:'cdr',       label:'CDR',                  desc:'Busca registros de chamadas dos ultimos 2 dias' },
  { id:'select',    label:'Selecionar gravacao',  desc:'Escolha qual gravacao deseja baixar' },
  { id:'recinfo',   label:'getRecordInfosByCall', desc:'Obtem o caminho do arquivo usando o AcctId' },
  { id:'download',  label:'Download (recapi)',    desc:'Baixa e transmite o arquivo de audio' },
  { id:'logout',    label:'Logout',               desc:'Encerra a sessao no PBX' },
];

let stepStates = {}, stepData = {};

function renderAll() {
  const c = document.getElementById('steps-container');
  c.innerHTML = '';
  STEPS.forEach((step, idx) => c.appendChild(buildCard(step, idx+1, stepStates[step.id]||'waiting', stepData[step.id])));
}

function buildCard(step, num, st, data) {
  const div = document.createElement('div');
  div.className = 'step-card ' + st;
  div.id = 'card-' + step.id;
  if (['active','failed','loading'].includes(st)) div.classList.add('open');
  const bc = {waiting:'badge-waiting',active:'badge-active',loading:'badge-loading',done:'badge-done',failed:'badge-failed'}[st];
  const bs = {waiting:num,active:num,loading:'&hellip;',done:'&#10003;',failed:'&#10007;'}[st];
  div.innerHTML = \`
    <div class="step-header" onclick="toggleCard('\${step.id}')">
      <div class="step-badge \${bc}">\${bs}</div>
      <div class="step-title">\${esc(step.label)}</div>
      <div class="step-summary">\${buildSummary(step.id,st,data)}</div>
      <div class="step-chevron">&#9660;</div>
    </div>
    <div class="step-body" id="body-\${step.id}">\${buildBody(step,st,data)}</div>\`;
  return div;
}

function buildSummary(id, st, data) {
  if (st==='waiting') return 'aguardando...';
  if (st==='loading') return '<span style="color:#f59e0b">executando...</span>';
  if (!data) return '';
  if (!data.ok) return '<span style="color:#f87171">'+esc(data.error||'erro')+'</span>';
  const m = {
    challenge: ()=> 'challenge: '+esc(data.challenge),
    login:     ()=> 'cookie obtido',
    cdr:       ()=> { const n=data.recordsWithAudio||0; return n+' gravacao(oes) encontrada(s)'; },
    select:    ()=> { const s=data?.selected; return s ? esc(s.start)+' | '+s.duration+'s' : 'aguardando selecao'; },
    recinfo:   ()=> esc(data.chosen||''),
    download:  ()=> data.fileSizeBytes ? (data.fileSizeBytes/1024).toFixed(1)+' KB' : 'ok',
    logout:    ()=> 'ok',
  };
  return m[id] ? m[id]() : '';
}

function buildBody(step, st, data) {
  if (st==='waiting') return '<p style="color:#64748b;font-size:.83rem">'+esc(step.desc)+'</p>';
  if (st==='loading') return '<p style="color:#f59e0b;font-size:.83rem">&#9203; Aguardando resposta da API...</p>';
  if (step.id === 'select') return buildSelectBody(st, data);
  if (!data) return '';
  let html = '';
  if (!data.ok) {
    html += '<div class="step-error">&#10060; '+esc(data.error||'Erro')+'</div>';
    html += '<div class="step-actions"><button class="btn btn-warning" onclick="runStep(\''+step.id+'\')">&#8634; Tentar novamente</button></div>';
    return html;
  }
  html += buildKV(step.id, data);
  html += buildNextBtn(step.id);
  return html;
}

function buildKV(id, data) {
  const tables = {
    challenge: [['Challenge token', data.challenge]],
    login:     [['Cookie', data.cookie], ['Token MD5', data.token]],
    cdr: ()=> {
      const pages = data.detail?.allPages || [];
      return [
        ['Paginas buscadas', String(data.totalPages??'-')],
        ['Total CDRs', String(data.totalRecords)],
        ['Com gravacao', String(data.recordsWithAudio), data.recordsWithAudio>0?'good':'bad'],
      ];
    },
    recinfo: [['Escolhido', data.chosen], ['filedir', data.filedir,'good'], ['filename', data.filename,'good']],
    download: [['Arquivo', data.filename], ['Tamanho', data.fileSizeBytes?(data.fileSizeBytes/1024).toFixed(1)+' KB':'-']],
    logout: [['Status','Sessao encerrada']],
  };
  let pairs = tables[id];
  if (typeof pairs === 'function') pairs = pairs();
  if (!pairs?.length) return '';
  let html = '<div class="detail-section"><h4>Valores extraidos</h4><div class="kv-grid">';
  pairs.forEach(([k,v,cls]) => {
    html += '<span class="kv-key">'+esc(String(k))+'</span><span class="kv-val '+(cls||'')+'">'+esc(String(v??''))+'</span>';
  });
  return html + '</div></div>';
}

function buildNextBtn(id) {
  const next = {challenge:'login',login:'cdr',cdr:'select',select:'recinfo',recinfo:'download',download:'logout',logout:null};
  const nextId = next[id];
  if (id==='cdr' && !stepData.cdr?.recordings?.length)
    return '<div class="step-actions"><span style="color:#f87171;font-size:.83rem">Nenhuma gravacao encontrada.</span></div>';
  if (id==='select' && !stepData.select?.selected) return '';
  if (id==='logout')
    return '<div class="step-actions"><button class="btn btn-success" onclick="showAudio()">&#127925; Ouvir gravacao</button></div>';
  if (!nextId) return '';
  const label = STEPS.find(s=>s.id===nextId)?.label||nextId;
  return '<div class="step-actions"><button class="btn btn-success" onclick="runStep(\''+nextId+'\')">&#9654; Proximo: '+esc(label)+'</button></div>';
}

async function runStep(id) {
  readForm(); saveCreds();
  if (id === 'select') {
    S.selectedRecording = null;
    stepData['select'] = null;
    setStepState('select', 'active');
    renderAll(); scroll('select');
    await new Promise(resolve => { _selectResolve = resolve; });
    return;
  }
  setStepState(id, 'loading');
  renderAll(); scroll(id);
  try {
    const result = await callStep(id);
    stepData[id] = result;
    setStepState(id, result.ok ? 'done' : 'failed');
  } catch(e) {
    stepData[id] = { ok:false, error:String(e) };
    setStepState(id, 'failed');
  }
  renderAll(); scroll(id);
  if (id==='logout' && stepData[id]?.ok) showAudio();
}

function selectRecording(idx) {
  const rec = stepData.cdr?.recordings?.[idx];
  if (!rec) return;
  S.selectedRecording = rec;
  stepData['select'] = { ok: true, selected: rec };
  setStepState('select', 'done');
  renderAll(); scroll('select');
  if (_selectResolve) { _selectResolve(); _selectResolve = null; }
}

function buildSelectBody(st, data) {
  const recordings = stepData.cdr?.recordings || [];
  if (!recordings.length) return '<div class="step-error">Nenhuma gravacao disponivel.</div>';
  const selected = data?.selected;
  let html = '<div class="detail-section"><h4>Selecione uma gravacao</h4><div class="rec-list">';
  recordings.forEach((rec, idx) => {
    const isSel = selected && selected.cdrId === rec.cdrId;
    html += '<div class="rec-row'+(isSel?' rec-selected':'')+'">'+
      '<div class="rec-info">'+
        '<span class="rec-date">'+esc(rec.start)+'</span>'+
        '<span class="rec-meta">'+esc(rec.caller)+' &rarr; '+esc(rec.callee)+' &nbsp;|&nbsp; '+esc(rec.duration)+'s &nbsp;|&nbsp; '+esc(rec.disposition)+'</span>'+
      '</div>'+
      '<button class="btn btn-sm '+(isSel?'btn-success':'btn-primary')+'" onclick="selectRecording('+idx+')">'+(isSel?'&#10003; Selecionado':'Selecionar')+'</button>'+
    '</div>';
  });
  html += '</div></div>';
  if (selected) html += buildNextBtn('select');
  return html;
}

async function callStep(id) {
  const base = { host:S.host, port:S.port, username:S.username, password:S.password };
  const ri   = stepData.recinfo || {};
  const bodies = {
    challenge: base,
    login:     { ...base, challenge: S.challenge },
    cdr:       { host:S.host, port:S.port, cookie:S.cookie },
    recinfo:   { host:S.host, port:S.port, cookie:S.cookie, acctId: S.selectedRecording?.cdrId },
    download:  { host:S.host, port:S.port, cookie:S.cookie, filedir: ri.filedir, filename: ri.filename },
    logout:    { host:S.host, port:S.port, cookie:S.cookie },
  };

  // Download: o Worker retorna audio binario diretamente
  if (id === 'download') {
    const resp = await fetch('/api/step/download', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(bodies['download'])
    });
    const ct = resp.headers.get('content-type') || '';
    if (ct.startsWith('audio/') || ct === 'application/octet-stream') {
      const blob = await resp.blob();
      const audioUrl = URL.createObjectURL(blob);
      const filename = ri.filename || 'recording.wav';
      S.audioUrl = audioUrl;
      return { ok: true, filename, fileSizeBytes: blob.size, audioUrl };
    }
    // Resposta de erro em JSON
    return await resp.json();
  }

  const resp = await fetch('/api/step/'+id, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(bodies[id]||base)
  });
  const json = await resp.json();
  if (json.ok) {
    if (id==='challenge') S.challenge = json.challenge;
    if (id==='login')     S.cookie    = json.cookie;
  }
  return json;
}

function startFlow() {
  readForm();
  if (!S.host||!S.username||!S.password) { alert('Preencha Host, Usuario e Senha.'); return; }
  resetFlow(false);
  STEPS.forEach((s,i) => { stepStates[s.id] = i===0 ? 'active' : 'waiting'; });
  renderAll();
  runStep('challenge');
}

async function startAuto() {
  readForm();
  if (!S.host||!S.username||!S.password) { alert('Preencha Host, Usuario e Senha.'); return; }
  resetFlow(false);
  STEPS.forEach((s,i) => { stepStates[s.id] = i===0 ? 'active' : 'waiting'; });
  renderAll();
  for (const step of STEPS) {
    await runStep(step.id);
    if (!stepData[step.id]?.ok) break;
  }
}

function resetFlow(full=true) {
  if (full) {
    Object.assign(S, {challenge:'',cookie:'',selectedRecording:null});
    if (S.audioUrl) { URL.revokeObjectURL(S.audioUrl); S.audioUrl = ''; }
  }
  _selectResolve = null;
  stepStates={}; stepData={};
  STEPS.forEach(s => stepStates[s.id]='waiting');
  document.getElementById('audio-card').style.display='none';
  renderAll();
}

function setStepState(id, st) {
  stepStates[id] = st;
  if (st==='done') {
    const idx = STEPS.findIndex(s=>s.id===id);
    if (idx>=0 && idx+1<STEPS.length) stepStates[STEPS[idx+1].id]='active';
  }
}

function scroll(id) { setTimeout(()=>document.getElementById('card-'+id)?.scrollIntoView({behavior:'smooth',block:'nearest'}),50); }
function toggleCard(id) { document.getElementById('card-'+id)?.classList.toggle('open'); }
function readForm() {
  S.host=document.getElementById('f-host').value.trim();
  S.port=document.getElementById('f-port').value.trim()||'443';
  S.username=document.getElementById('f-user').value.trim();
  S.password=document.getElementById('f-pass').value;
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const audio   = document.getElementById('audio-el');
const seekbar = document.getElementById('seekbar');

function showAudio() {
  const dl  = stepData.download;
  const cdr = S.selectedRecording;
  if (!dl?.ok || !dl.audioUrl) return;
  const card = document.getElementById('audio-card');
  card.style.display='block';
  card.scrollIntoView({behavior:'smooth'});
  document.getElementById('audio-meta').innerHTML = [
    ['Arquivo', dl.filename], ['Tamanho', (dl.fileSizeBytes/1024).toFixed(1)+' KB'],
    cdr&&['Origem', cdr.caller], cdr&&['Destino', cdr.callee],
    cdr&&['Inicio', cdr.start],  cdr&&['Duracao', cdr.duration+' s'],
  ].filter(Boolean).map(([k,v])=>'<span class="k">'+esc(k)+'</span><span class="v">'+esc(String(v??''))+'</span>').join('');
  audio.src = dl.audioUrl;
  audio.load();
}

audio.addEventListener('timeupdate',()=>{
  if(!audio.duration) return;
  seekbar.value=(audio.currentTime/audio.duration)*100;
  document.getElementById('time-label').textContent=fmt(audio.currentTime)+' / '+fmt(audio.duration);
});
audio.addEventListener('ended',()=>{ document.getElementById('play-btn').textContent='&#9654; Play'; });
seekbar.addEventListener('input',()=>{ if(audio.duration) audio.currentTime=(seekbar.value/100)*audio.duration; });
function togglePlay(){ if(audio.paused){audio.play();document.getElementById('play-btn').textContent='&#9646;&#9646; Pause';}
                       else{audio.pause();document.getElementById('play-btn').textContent='&#9654; Play';} }
function skip(s){ audio.currentTime=Math.max(0,audio.currentTime+s); }
function fmt(t){ if(!t||isNaN(t))return'0:00'; const m=Math.floor(t/60),s=Math.floor(t%60); return m+':'+s.toString().padStart(2,'0'); }

loadCreds();
resetFlow();
</script>
</body>
</html>`;

// ── Roteador principal ────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // Frontend
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    // API
    if (method === 'POST') {
      if (path === '/api/step/challenge') return handleChallenge(request);
      if (path === '/api/step/login')     return handleLogin(request);
      if (path === '/api/step/cdr')       return handleCdr(request);
      if (path === '/api/step/recinfo')   return handleRecinfo(request);
      if (path === '/api/step/download')  return handleDownload(request);
      if (path === '/api/step/logout')    return handleLogout(request);
    }

    return new Response('Not found', { status: 404 });
  }
};
