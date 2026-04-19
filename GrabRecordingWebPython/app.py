"""
Grab Recording - Flask backend passo a passo.
"""

import hashlib
import json
import logging
import os
import tempfile
from datetime import date, timedelta
from pathlib import Path

import requests
import urllib3
from flask import Flask, Response, abort, jsonify, request, send_file

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__, static_folder="public", static_url_path="")
PORT = int(os.environ.get("PORT", 5000))

AUDIO_CACHE_DIR = Path(tempfile.gettempdir()) / "grab-recording"
AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.DEBUG,
    format="[%(asctime)s.%(msecs)03d] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# Tabela de codigos de erro da API Grandstream UCM
PBX_ERRORS = {
    -6:  "Cookie invalido ou sessao expirada. Reinicie o fluxo.",
    -7:  "Versao de API incompativel.",
    -8:  "Parametro obrigatorio ausente na requisicao.",
    -9:  "Acao desconhecida.",
    -10: "Permissao negada. Verifique se o usuario da API tem permissao para esta acao.",
    -11: "Falha na autenticacao. Verifique usuario e senha.",
    -15: "Recurso nao encontrado.",
    -25: "Arquivo nao encontrado no PBX. Verifique filedir e filename.",
    -30: "Limite de sessoes simultaneas atingido.",
    -37: "Senha incorreta.",
}

def pbx_error_msg(status, fallback=""):
    if status in PBX_ERRORS:
        return f"{PBX_ERRORS[status]} (codigo {status})"
    return fallback or f"Erro desconhecido do PBX (codigo {status})"

def pbx_url(host, port):
    return f"https://{host}:{port}/api"

def md5(s):
    return hashlib.md5(s.encode()).hexdigest()

def pbx_post(url, payload, stream=False, timeout=30):
    req_body = {"request": payload}
    logging.info("-> POST %s  %s", url, json.dumps(payload)[:300])
    resp = requests.post(
        url, json=req_body,
        headers={"Content-Type": "application/json; charset=UTF-8"},
        verify=False, timeout=timeout, stream=stream,
    )
    resp.raise_for_status()
    detail = {
        "request":  {"url": url, "body": req_body},
        "response": {"httpStatus": resp.status_code, "headers": dict(resp.headers)},
    }
    if not stream:
        data = resp.json()
        detail["response"]["body"] = data
        logging.info("<- %s  %s", resp.status_code, json.dumps(data)[:300])
        return detail, data
    return detail, resp

def ok(**kwargs):
    return jsonify({"ok": True, **kwargs})

def err(msg, **kwargs):
    return jsonify({"ok": False, "error": msg, **kwargs})

@app.route("/")
def index():
    return app.send_static_file("index.html")


# ---------------------------------------------------------------------------
# ETAPA 1 — Challenge
# ---------------------------------------------------------------------------
@app.route("/api/step/challenge", methods=["POST"])
def step_challenge():
    b        = request.json or {}
    host     = b.get("host", "").strip()
    port     = b.get("port", "8089")
    username = b.get("username", "").strip()

    if not host:
        return err("Informe o endereco IP ou hostname do PBX.")
    if not username:
        return err("Informe o nome de usuario da API do PBX.")

    try:
        detail, data = pbx_post(
            pbx_url(host, port),
            {"action": "challenge", "user": username, "version": "1.0"},
        )
        status = data.get("status")
        if status != 0:
            return err(pbx_error_msg(status, f"Challenge rejeitado pelo PBX (codigo {status})."), detail=detail)

        challenge = data["response"]["challenge"]
        return ok(challenge=challenge, detail=detail)

    except requests.exceptions.ConnectionError:
        return err(
            f"Nao foi possivel conectar ao PBX em {host}:{port}. "
            "Verifique se o IP esta correto, se a porta 8089 esta acessivel e se o PBX esta ligado."
        )
    except requests.exceptions.Timeout:
        return err(
            f"O PBX em {host}:{port} nao respondeu em 30 segundos. "
            "Verifique conectividade de rede e firewall."
        )
    except requests.exceptions.SSLError as e:
        return err(f"Erro de SSL ao conectar ao PBX: {e}. O certificado autoassinado nao foi aceito.")
    except Exception as e:
        return err(f"Erro inesperado no challenge: {e}")


# ---------------------------------------------------------------------------
# ETAPA 2 — Login
# ---------------------------------------------------------------------------
@app.route("/api/step/login", methods=["POST"])
def step_login():
    b         = request.json or {}
    host      = b.get("host", "").strip()
    port      = b.get("port", "8089")
    username  = b.get("username", "").strip()
    password  = b.get("password", "").strip()
    challenge = b.get("challenge", "").strip()

    if not challenge:
        return err("Token de challenge ausente. Execute a etapa Challenge primeiro.")
    if not password:
        return err("Informe a senha da API do PBX.")

    token = md5(f"{challenge}{password}")
    try:
        detail, data = pbx_post(
            pbx_url(host, port),
            {"action": "login", "user": username, "token": token},
        )
        status = data.get("status")
        if status != 0:
            msg = pbx_error_msg(status)
            if status == -11:
                msg = "Senha incorreta ou usuario sem permissao de API. Verifique as credenciais no PBX."
            return err(msg, detail=detail)

        cookie = data["response"]["cookie"]
        return ok(cookie=cookie, token=token, detail=detail)

    except requests.exceptions.ConnectionError:
        return err(f"Conexao perdida com o PBX em {host}:{port} durante o login.")
    except requests.exceptions.Timeout:
        return err("Timeout durante o login. Tente novamente.")
    except Exception as e:
        return err(f"Erro inesperado no login: {e}")


# ---------------------------------------------------------------------------
# ETAPA 3 — CDR
# ---------------------------------------------------------------------------
@app.route("/api/step/cdr", methods=["POST"])
def step_cdr():
    b      = request.json or {}
    host   = b.get("host", "").strip()
    port   = b.get("port", "8089")
    cookie = b.get("cookie", "").strip()
    url    = pbx_url(host, port)
    PAGE   = 200

    if not cookie:
        return err("Cookie de sessao ausente. Execute as etapas Challenge e Login primeiro.")

    try:
        all_records  = []
        pages_detail = []
        last_detail  = {}
        offset = 0

        today      = date.today().strftime("%Y-%m-%d")
        yesterday  = (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")
        start_time = f"{yesterday}T00:00-03:00"

        while True:
            detail, data = pbx_post(url, {
                "action": "cdrapi", "cookie": cookie, "format": "json",
                "numRecords": PAGE, "offset": offset,
                "timeFilterType": "End", "startTime": start_time,
            })
            last_detail = detail
            pages_detail.append({"offset": offset, "httpStatus": detail["response"]["httpStatus"]})

            status = data.get("status", 0)
            cdr_root_present = "cdr_root" in data
            if not cdr_root_present and status != 0:
                msg = pbx_error_msg(status)
                if status == -6:
                    msg = "Sessao expirada durante a busca de CDR. Reinicie o fluxo."
                elif status == -10:
                    msg = "Sem permissao para acessar CDR. Verifique as permissoes do usuario de API no PBX."
                return err(msg, detail=detail)

            page_records = data.get("cdr_root") or []
            all_records.extend(page_records)

            if len(page_records) < PAGE:
                break
            offset += PAGE

        def iter_sub_entries(r):
            """Yields every individual CDR entry that may contain a recording.
            For nested records (main_cdr + sub_cdr_N) yields each sub_cdr_N.
            For flat records yields the record itself."""
            if "main_cdr" in r:
                for key, val in r.items():
                    if key.startswith("sub_cdr_") and isinstance(val, dict):
                        yield val
            else:
                yield r

        # Collect every sub-entry that has a non-empty recordfiles
        all_entries_with_rec = []
        for r in all_records:
            for entry in iter_sub_entries(r):
                rec_file = (entry.get("recordfiles") or "").strip().rstrip("@").strip()
                if rec_file:
                    all_entries_with_rec.append({
                        "cdrId":       entry.get("AcctId", ""),
                        "caller":      entry.get("src", ""),
                        "callee":      entry.get("dst", ""),
                        "start":       entry.get("start", ""),
                        "duration":    entry.get("duration", "0"),
                        "disposition": entry.get("disposition", ""),
                        "recordFile":  rec_file,
                    })

        all_entries_with_rec.sort(key=lambda x: x["start"], reverse=True)

        if len(all_records) == 0:
            return err(
                f"Nenhuma chamada encontrada de {yesterday} ate hoje ({today}). "
                "Verifique se ha chamadas registradas no PBX neste periodo.",
                totalRecords=0, totalPages=len(pages_detail),
                detail={"request": last_detail.get("request"), "response": last_detail.get("response"), "allPages": pages_detail},
            )

        if not all_entries_with_rec:
            return err(
                f"Foram encontradas {len(all_records)} chamadas de {yesterday} ate hoje, mas nenhuma possui gravacao. "
                "Verifique se a gravacao automatica esta ativa no PBX.",
                totalRecords=len(all_records), totalPages=len(pages_detail),
                recordsWithAudio=0,
                detail={"request": last_detail.get("request"), "response": last_detail.get("response"), "allPages": pages_detail},
            )

        top_recordings = all_entries_with_rec[:5]
        return ok(
            totalRecords=len(all_records),
            totalPages=len(pages_detail),
            recordsWithAudio=len(all_entries_with_rec),
            recordings=top_recordings,
            detail={
                "request":  last_detail["request"],
                "response": last_detail["response"],
                "allPages": pages_detail,
            },
        )
    except requests.exceptions.Timeout:
        return err("Timeout ao buscar CDR. O PBX demorou demais para responder.")
    except Exception as e:
        return err(f"Erro inesperado ao buscar CDR: {e}")


# ---------------------------------------------------------------------------
# ETAPA 4 — getRecordInfosByCall
# ---------------------------------------------------------------------------
@app.route("/api/step/recinfo", methods=["POST"])
def step_recinfo():
    b       = request.json or {}
    host    = b.get("host", "").strip()
    port    = b.get("port", "8089")
    cookie  = b.get("cookie", "").strip()
    acct_id = str(b.get("acctId", "")).strip()

    if not acct_id or acct_id == "None":
        return err("AcctId ausente. A etapa CDR nao retornou um registro valido.")

    try:
        detail, data = pbx_post(
            pbx_url(host, port),
            {"action": "getRecordInfosByCall", "cookie": cookie, "id": acct_id},
        )
        status = data.get("status")
        if status != 0:
            msg = pbx_error_msg(status)
            if status == -15:
                msg = f"Registro de gravacao nao encontrado no PBX para AcctId={acct_id}. A chamada pode nao ter sido gravada."
            return err(msg, detail=detail)

        raw_paths = (data.get("response", {}).get("recordfiles") or "").strip()
        if not raw_paths:
            return err(
                f"O PBX retornou sucesso mas sem arquivos para AcctId={acct_id}. "
                "A gravacao pode ter sido apagada ou ainda estar sendo processada.",
                detail=detail,
            )

        all_paths = [p.strip() for p in raw_paths.split(",") if p.strip()]
        chosen    = all_paths[-1]

        filename = chosen.rsplit("/", 1)[-1] if "/" in chosen else chosen
        filedir  = "monitor"

        return ok(
            allPaths=all_paths,
            chosen=chosen,
            filedir=filedir,
            filename=filename,
            detail=detail,
        )
    except requests.exceptions.Timeout:
        return err("Timeout ao buscar informacoes da gravacao. Tente novamente.")
    except Exception as e:
        return err(f"Erro inesperado ao buscar informacoes da gravacao: {e}")



# ---------------------------------------------------------------------------
# ETAPA 5 — Download (recapi)
# ---------------------------------------------------------------------------
@app.route("/api/step/download", methods=["POST"])
def step_download():
    b        = request.json or {}
    host     = b.get("host", "").strip()
    port     = b.get("port", "8089")
    cookie   = b.get("cookie", "").strip()
    filedir  = b.get("filedir", "").strip()
    filename = b.get("filename", "").strip()

    if not filename:
        return err("Nome do arquivo ausente. A etapa getRecordInfosByCall nao retornou um filename valido.")
    if not filedir:
        return err("Diretorio do arquivo ausente. A etapa getRecordInfosByCall nao retornou um filedir valido.")

    url        = pbx_url(host, port)
    local_name = Path(filename).name
    dest_path  = AUDIO_CACHE_DIR / local_name
    payload    = {"action": "recapi", "cookie": cookie, "filedir": filedir, "filename": filename}

    try:
        detail, resp = pbx_post(url, payload, stream=True, timeout=120)
        content_type = resp.headers.get("Content-Type", "")
        detail["response"]["contentType"] = content_type

        if "application/json" in content_type:
            raw = resp.text
            detail["response"]["body"] = raw
            try:
                body_json = json.loads(raw)
                status = body_json.get("status")
                msg = pbx_error_msg(status, f"O PBX recusou o download do arquivo '{filename}'.")
            except Exception:
                msg = f"O PBX retornou JSON inesperado em vez do arquivo de audio."
            return err(msg, raw=raw, detail=detail)

        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)

        file_size = dest_path.stat().st_size
        if file_size == 0:
            dest_path.unlink(missing_ok=True)
            return err("O PBX enviou um arquivo vazio. A gravacao pode estar corrompida ou indisponivel.")

        detail["response"]["fileSizeBytes"] = file_size
        return ok(
            filename=local_name,
            fileSizeBytes=file_size,
            audioUrl=f"/api/audio/{local_name}",
            detail=detail,
        )
    except requests.exceptions.Timeout:
        return err(
            f"Timeout ao baixar o arquivo '{filename}'. "
            "O arquivo pode ser muito grande ou a conexao esta lenta. Tente novamente."
        )
    except OSError as e:
        return err(f"Erro ao salvar o arquivo localmente: {e}")
    except Exception as e:
        return err(f"Erro inesperado no download: {e}")


# ---------------------------------------------------------------------------
# ETAPA 6 — Logout
# ---------------------------------------------------------------------------
@app.route("/api/step/logout", methods=["POST"])
def step_logout():
    b      = request.json or {}
    host   = b.get("host", "").strip()
    port   = b.get("port", "8089")
    cookie = b.get("cookie", "").strip()
    try:
        detail, _ = pbx_post(pbx_url(host, port), {"action": "logout", "cookie": cookie})
        return ok(detail=detail)
    except Exception as e:
        # Logout nao e critico — retorna ok com aviso
        return ok(warning=f"Logout nao realizado (nao critico): {e}")


# ---------------------------------------------------------------------------
# Servir audio com suporte a Range
# ---------------------------------------------------------------------------
@app.route("/api/audio/<path:filename>")
def serve_audio(filename):
    filepath = AUDIO_CACHE_DIR / filename
    if not filepath.exists():
        abort(404)
    file_size    = filepath.stat().st_size
    range_header = request.headers.get("Range")
    if range_header:
        ranges     = range_header.replace("bytes=", "").split("-")
        byte_start = int(ranges[0]) if ranges[0] else 0
        byte_end   = int(ranges[1]) if len(ranges) > 1 and ranges[1] else file_size - 1
        byte_end   = min(byte_end, file_size - 1)
        length     = byte_end - byte_start + 1
        def generate():
            with open(filepath, "rb") as f:
                f.seek(byte_start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(8192, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
        resp = Response(generate(), 206, mimetype="audio/wav", direct_passthrough=True)
        resp.headers["Content-Range"]  = f"bytes {byte_start}-{byte_end}/{file_size}"
        resp.headers["Accept-Ranges"]  = "bytes"
        resp.headers["Content-Length"] = str(length)
        return resp
    return send_file(filepath, mimetype="audio/wav")


if __name__ == "__main__":
    print(f"Servidor iniciado -> http://localhost:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=True)
