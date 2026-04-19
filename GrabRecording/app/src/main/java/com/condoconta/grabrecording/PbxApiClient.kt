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
 * Fluxo de autenticação:
 *   1. challenge  → recebe string aleatória
 *   2. login      → envia MD5(challenge + password) → recebe cookie
 *   3. cdrapi     → lista chamadas com arquivos de gravação
 *   4. recapi     → baixa o arquivo de áudio
 *   5. logout     → encerra sessão
 */
class PbxApiClient(
    private val pbxHost: String,   // Ex: "192.168.1.100"
    private val pbxPort: Int = 8089,
    private val username: String,
    private val password: String
) {
    companion object {
        private const val TAG = "PbxApiClient"
        private const val API_VERSION = "1.0"
        private val JSON_TYPE = "application/json; charset=UTF-8".toMediaType()
    }

    private val baseUrl get() = "https://$pbxHost:$pbxPort/api"

    // OkHttpClient que aceita certificados autoassinados do PBX
    private val httpClient: OkHttpClient by lazy {
        buildTrustAllClient()
    }

    private var sessionCookie: String? = null

    // ─────────────────────────────────────────────────────────────────────────
    // Autenticação
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Realiza o login completo: challenge → MD5 token → cookie.
     * Lança exceção se falhar.
     */
    suspend fun login() {
        val challenge = requestChallenge()
        Log.d(TAG, "Challenge recebido: $challenge")

        val token = md5("${challenge}${password}")
        Log.d(TAG, "Token MD5 gerado: $token")

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
            Log.w(TAG, "Erro no logout: ${e.message}")
        } finally {
            sessionCookie = null
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CDR — Busca a última chamada gravada
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Busca os registros CDR e retorna a última chamada que possui gravação.
     * Retorna null se nenhuma chamada gravada for encontrada.
     */
    suspend fun getLastRecording(
        numRecords: Int = 100,
        onlyAnswered: Boolean = true
    ): CallRecording? {
        val cookie = sessionCookie ?: throw IllegalStateException("Não autenticado. Chame login() primeiro.")

        val body = JSONObject().apply {
            put("request", JSONObject().apply {
                put("action", "cdrapi")
                put("cookie", cookie)
                put("format", "json")
                put("numRecords", numRecords)
                // Ordena do mais recente para o mais antigo
                put("timeFilterType", "End")
            })
        }

        val responseText = postJson(body.toString())
        Log.d(TAG, "CDR response (primeiros 500 chars): ${responseText.take(500)}")

        return parseCdrResponse(responseText, onlyAnswered)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RECAPI — Faz o download do arquivo de áudio
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Baixa o arquivo de gravação e salva no diretório de cache do app.
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

        val destFile = File(destDir, filename)
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
                Log.d(TAG, "Download concluído: ${totalBytes} bytes → ${destFile.absolutePath}")
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
            val msg = json.optString("response", "Erro desconhecido")
            throw Exception("Falha no challenge (status=$status): $msg")
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
            val msg = json.optString("response", "Credenciais inválidas")
            throw Exception("Falha no login (status=$status): $msg")
        }

        return json.getJSONObject("response").getString("cookie")
    }

    private fun parseCdrResponse(responseText: String, onlyAnswered: Boolean): CallRecording? {
        return try {
            val json = JSONObject(responseText)

            val status = json.optInt("status", -1)
            if (status != 0) {
                Log.w(TAG, "CDR retornou status de erro: $status")
                return null
            }

            val cdrArray = json.optJSONArray("cdr_root") ?: return null

            // Percorre do último para o primeiro (mais recente primeiro)
            for (i in cdrArray.length() - 1 downTo 0) {
                val entry = cdrArray.getJSONObject(i)

                val recordFile = entry.optString("recordfiles", "")
                if (recordFile.isBlank()) continue  // sem gravação, pula

                val disposition = entry.optString("disposition", "")
                if (onlyAnswered && disposition.uppercase() != "ANSWERED") continue

                return CallRecording(
                    cdrId = entry.optString("AcctId", ""),
                    caller = entry.optString("src", ""),
                    callee = entry.optString("dst", ""),
                    start = entry.optString("start", ""),
                    end = entry.optString("end", ""),
                    duration = entry.optString("duration", "0"),
                    recordFile = recordFile,
                    disposition = disposition
                )
            }

            Log.d(TAG, "Nenhuma chamada com gravação encontrada nos $cdrArray.length() registros.")
            null
        } catch (e: Exception) {
            Log.e(TAG, "Erro ao parsear CDR: ${e.message}", e)
            null
        }
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

        val contentType = response.header("Content-Type", "")
        if (contentType?.contains("application/json") == true) {
            // O PBX retornou JSON em vez de áudio — provavelmente um erro
            val errorBody = response.body?.string() ?: ""
            throw Exception("PBX retornou erro em vez do arquivo de áudio: $errorBody")
        }

        return response.body?.byteStream()
            ?: throw Exception("Stream do arquivo de áudio está vazio")
    }

    /**
     * Gera MD5 de uma string.
     */
    private fun md5(input: String): String {
        val md = MessageDigest.getInstance("MD5")
        val digest = md.digest(input.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    /**
     * Cria um OkHttpClient que aceita certificados SSL autoassinados.
     * Necessário porque o UCM6xxx usa certificado autoassinado por padrão.
     */
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
            .readTimeout(120, TimeUnit.SECONDS)  // Download pode demorar
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}
