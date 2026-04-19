package com.condoconta.grabrecording

import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.Calendar
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import java.util.concurrent.TimeUnit

/**
 * Modelo de dados de uma gravação de chamada.
 */
data class CallRecording(
    val cdrId: String,
    val caller: String,
    val callee: String,
    val start: String,
    val end: String,
    val duration: String,
    val recordFile: String,
    val disposition: String
)

/**
 * Cliente para a API HTTPS do PBX Grandstream UCM6xxx.
 *
 * Fluxo de uso:
 *   1. login()                  → autentica (challenge → MD5 → cookie)
 *   2. getRecordingsWithAudio() → lista até 5 gravações dos últimos 2 dias
 *   3. getRecordInfosByCall()   → obtém filedir + filename do arquivo
 *   4. downloadRecording()      → baixa o arquivo WAV
 *   5. logout()                 → encerra sessão
 */
class PbxApiClient(
    private val pbxHost: String,
    private val pbxPort: Int = 8089,
    private val username: String,
    private val password: String
) {
    companion object {
        private const val TAG = "PbxApiClient"
        private const val API_VERSION = "1.0"
        private val JSON_TYPE = "application/json; charset=UTF-8".toMediaType()

        private val PBX_ERRORS = mapOf(
            -6  to "Cookie inválido ou sessão expirada.",
            -7  to "Versão de API incompatível.",
            -8  to "Parâmetro obrigatório ausente na requisição.",
            -9  to "Ação desconhecida.",
            -10 to "Permissão negada. Verifique as permissões do usuário de API.",
            -11 to "Falha na autenticação. Verifique usuário e senha.",
            -15 to "Recurso não encontrado.",
            -25 to "Arquivo não encontrado no PBX.",
            -30 to "Limite de sessões simultâneas atingido.",
            -37 to "Senha incorreta."
        )

        fun pbxErrorMsg(status: Int, fallback: String = "Erro desconhecido do PBX (código $status)"): String {
            return PBX_ERRORS[status]?.let { "$it (código $status)" } ?: fallback
        }
    }

    private val baseUrl get() = "https://$pbxHost:$pbxPort/api"

    private val httpClient: OkHttpClient by lazy { buildTrustAllClient() }

    private var sessionCookie: String? = null

    // ─────────────────────────────────────────────────────────────────────────
    // Autenticação
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Realiza o login completo: challenge → MD5 token → cookie de sessão.
     */
    suspend fun login() {
        val challenge = requestChallenge()
        Log.d(TAG, "Challenge recebido: $challenge")
        val token = md5("${challenge}${password}")
        sessionCookie = requestLogin(token)
        Log.d(TAG, "Login bem-sucedido. Cookie: $sessionCookie")
    }

    /**
     * Encerra a sessão no PBX.
     */
    suspend fun logout() {
        val cookie = sessionCookie ?: return
        try {
            val body = JSONObject().apply {
                put("request", JSONObject().apply {
                    put("action", "logout")
                    put("cookie", cookie)
                })
            }
            postJson(body.toString())
            Log.d(TAG, "Logout realizado com sucesso.")
        } catch (e: Exception) {
            Log.w(TAG, "Erro no logout (não crítico): ${e.message}")
        } finally {
            sessionCookie = null
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CDR — Busca gravações dos últimos 2 dias
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Busca registros CDR de ontem até hoje (paginado) e retorna até [maxResults]
     * chamadas que possuem gravação, ordenadas da mais recente para a mais antiga.
     */
    suspend fun getRecordingsWithAudio(maxResults: Int = 5): List<CallRecording> {
        val cookie = sessionCookie ?: throw IllegalStateException("Não autenticado. Chame login() primeiro.")

        // Data de ontem às 00:00 no fuso UTC-3
        val cal = Calendar.getInstance()
        cal.add(Calendar.DAY_OF_YEAR, -1)
        val yesterday = "%04d-%02d-%02d".format(
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH) + 1,
            cal.get(Calendar.DAY_OF_MONTH)
        )
        val startTime = "${yesterday}T00:00-03:00"

        val PAGE = 200
        val allRecords = mutableListOf<JSONObject>()
        var offset = 0

        // Paginação
        while (true) {
            val body = JSONObject().apply {
                put("request", JSONObject().apply {
                    put("action", "cdrapi")
                    put("cookie", cookie)
                    put("format", "json")
                    put("numRecords", PAGE)
                    put("offset", offset)
                    put("timeFilterType", "End")
                    put("startTime", startTime)
                })
            }

            val responseText = postJson(body.toString())
            Log.d(TAG, "CDR offset=$offset, resposta (500): ${responseText.take(500)}")

            val json = JSONObject(responseText)
            val status = json.optInt("status", -1)

            if (!json.has("cdr_root") && status != 0) {
                throw Exception(pbxErrorMsg(status, "Erro ao buscar CDR (status=$status)"))
            }

            val cdrArray = json.optJSONArray("cdr_root")
            val pageCount = cdrArray?.length() ?: 0

            for (i in 0 until pageCount) {
                allRecords.add(cdrArray!!.getJSONObject(i))
            }

            if (pageCount < PAGE) break
            offset += PAGE
        }

        Log.d(TAG, "Total de registros CDR recebidos: ${allRecords.size}")

        // Extrai entradas com gravação (trata registros planos e aninhados sub_cdr_*)
        val result = mutableListOf<CallRecording>()

        outer@ for (record in allRecords) {
            val entries: List<JSONObject> = if (record.has("main_cdr")) {
                // Registro aninhado: iterar sub_cdr_0, sub_cdr_1, ...
                val subs = mutableListOf<JSONObject>()
                val keys = record.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    if (key.startsWith("sub_cdr_")) {
                        val sub = record.optJSONObject(key)
                        if (sub != null) subs.add(sub)
                    }
                }
                subs
            } else {
                listOf(record)
            }

            for (entry in entries) {
                // Remove @ final que o PBX às vezes inclui
                val recFile = entry.optString("recordfiles", "").trim().trimEnd('@').trim()
                if (recFile.isEmpty()) continue

                result.add(
                    CallRecording(
                        cdrId      = entry.optString("AcctId", ""),
                        caller     = entry.optString("src", ""),
                        callee     = entry.optString("dst", ""),
                        start      = entry.optString("start", ""),
                        end        = entry.optString("end", ""),
                        duration   = entry.optString("duration", "0"),
                        recordFile = recFile,
                        disposition = entry.optString("disposition", "")
                    )
                )

                if (result.size >= maxResults * 10) break@outer  // limite de segurança
            }
        }

        // Ordena do mais recente para o mais antigo
        result.sortByDescending { it.start }

        Log.d(TAG, "Gravações encontradas: ${result.size}, retornando até $maxResults")
        return result.take(maxResults)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // getRecordInfosByCall — Obtém filedir + filename pelo AcctId
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Consulta o PBX pelo AcctId da chamada e retorna Pair(filedir, filename).
     * O filedir é sempre "monitor"; o filename é o nome limpo do arquivo WAV.
     */
    suspend fun getRecordInfosByCall(acctId: String): Pair<String, String> {
        val cookie = sessionCookie ?: throw IllegalStateException("Não autenticado. Chame login() primeiro.")

        val body = JSONObject().apply {
            put("request", JSONObject().apply {
                put("action", "getRecordInfosByCall")
                put("cookie", cookie)
                put("id", acctId)
            })
        }

        val responseText = postJson(body.toString())
        val json = JSONObject(responseText)
        val status = json.optInt("status", -1)

        if (status != 0) {
            throw Exception(pbxErrorMsg(status, "Erro ao obter informações de gravação (status=$status)"))
        }

        val response = json.optJSONObject("response")
            ?: throw Exception("Resposta inválida do PBX para getRecordInfosByCall")

        val rawPaths = response.optString("recordfiles", "").trim()
        if (rawPaths.isEmpty()) {
            throw Exception("PBX retornou sucesso mas sem arquivos para AcctId=$acctId")
        }

        val allPaths = rawPaths.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        val chosen = allPaths.last()
        val filename = if (chosen.contains("/")) chosen.substringAfterLast("/") else chosen

        Log.d(TAG, "getRecordInfosByCall: chosen=$chosen, filename=$filename")
        return Pair("monitor", filename)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RECAPI — Download do arquivo de áudio
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Baixa o arquivo de gravação e salva em [destDir].
     * Retorna o File salvo localmente.
     */
    suspend fun downloadRecording(
        filename: String,
        filedir: String = "monitor",
        destDir: File
    ): File {
        val cookie = sessionCookie ?: throw IllegalStateException("Não autenticado. Chame login() primeiro.")

        val body = JSONObject().apply {
            put("request", JSONObject().apply {
                put("action", "recapi")
                put("cookie", cookie)
                put("filedir", filedir)
                put("filename", filename)
            })
        }

        Log.d(TAG, "Baixando gravação: $filename (dir=$filedir)")

        val responseStream = postJsonForStream(body.toString())

        val localName = filename.substringAfterLast("/")
        val destFile = File(destDir, localName)
        destFile.parentFile?.mkdirs()

        responseStream.use { input ->
            destFile.outputStream().use { output ->
                val buffer = ByteArray(8192)
                var bytesRead: Int
                var totalBytes = 0L
                while (input.read(buffer).also { bytesRead = it } != -1) {
                    output.write(buffer, 0, bytesRead)
                    totalBytes += bytesRead
                }
                Log.d(TAG, "Download concluído: $totalBytes bytes → ${destFile.absolutePath}")
            }
        }

        if (!destFile.exists() || destFile.length() == 0L) {
            throw Exception("Arquivo baixado está vazio ou não existe: ${destFile.absolutePath}")
        }

        return destFile
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers privados
    // ─────────────────────────────────────────────────────────────────────────

    private suspend fun requestChallenge(): String {
        val body = JSONObject().apply {
            put("request", JSONObject().apply {
                put("action", "challenge")
                put("user", username)
                put("version", API_VERSION)
            })
        }
        val responseText = postJson(body.toString())
        val json = JSONObject(responseText)
        val status = json.optInt("status", -1)
        if (status != 0) {
            throw Exception(pbxErrorMsg(status, "Falha no challenge (status=$status)"))
        }
        return json.getJSONObject("response").getString("challenge")
    }

    private suspend fun requestLogin(token: String): String {
        val body = JSONObject().apply {
            put("request", JSONObject().apply {
                put("action", "login")
                put("user", username)
                put("token", token)
            })
        }
        val responseText = postJson(body.toString())
        val json = JSONObject(responseText)
        val status = json.optInt("status", -1)
        if (status != 0) {
            val msg = when (status) {
                -11 -> "Senha incorreta ou usuário sem permissão de API."
                -37 -> {
                    val remain = json.optString("remain_num", "")
                    if (remain.isNotEmpty()) "Senha incorreta. Tentativas restantes: $remain."
                    else "Senha incorreta."
                }
                else -> pbxErrorMsg(status)
            }
            throw Exception(msg)
        }
        return json.getJSONObject("response").getString("cookie")
    }

    private fun postJson(jsonBody: String): String {
        val request = Request.Builder()
            .url(baseUrl)
            .post(jsonBody.toRequestBody(JSON_TYPE))
            .header("Content-Type", "application/json; charset=UTF-8")
            .header("Connection", "close")
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("HTTP ${response.code}: ${response.message}")
            }
            return response.body?.string() ?: throw Exception("Resposta vazia do PBX")
        }
    }

    private fun postJsonForStream(jsonBody: String): InputStream {
        val request = Request.Builder()
            .url(baseUrl)
            .post(jsonBody.toRequestBody(JSON_TYPE))
            .header("Content-Type", "application/json; charset=UTF-8")
            .header("Connection", "close")
            .build()

        val response = httpClient.newCall(request).execute()
        if (!response.isSuccessful) {
            throw Exception("HTTP ${response.code} ao baixar gravação: ${response.message}")
        }

        val contentType = response.header("Content-Type", "") ?: ""
        if (contentType.contains("application/json")) {
            val errorBody = response.body?.string() ?: ""
            try {
                val json = JSONObject(errorBody)
                val status = json.optInt("status", -1)
                throw Exception(pbxErrorMsg(status, "PBX recusou o download do arquivo."))
            } catch (e: Exception) {
                if (e.message?.contains("PBX") == true) throw e
                throw Exception("PBX retornou JSON inesperado em vez do arquivo de áudio.")
            }
        }

        return response.body?.byteStream()
            ?: throw Exception("Stream do arquivo de áudio está vazio")
    }

    private fun md5(input: String): String {
        val md = MessageDigest.getInstance("MD5")
        val digest = md.digest(input.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun buildTrustAllClient(): OkHttpClient {
        val trustAllManager = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }
        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf<TrustManager>(trustAllManager), null)
        return OkHttpClient.Builder()
            .sslSocketFactory(sslContext.socketFactory, trustAllManager)
            .hostnameVerifier { _, _ -> true }
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}
