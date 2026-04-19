package com.condoconta.grabrecording

import android.app.Application
import android.media.MediaPlayer
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

sealed class UiState {
    object Idle : UiState()
    data class Loading(val message: String) : UiState()
    data class SelectRecording(val recordings: List<CallRecording>) : UiState()
    data class RecordingReady(val recording: CallRecording, val file: File) : UiState()
    data class Playing(val recording: CallRecording, val file: File) : UiState()
    data class Paused(val recording: CallRecording, val file: File) : UiState()
    data class Error(val message: String) : UiState()
}

class MainViewModel(application: Application) : AndroidViewModel(application) {

    companion object {
        private const val TAG = "MainViewModel"
    }

    private val _uiState = MutableLiveData<UiState>(UiState.Idle)
    val uiState: LiveData<UiState> = _uiState

    private var mediaPlayer: MediaPlayer? = null
    private var currentFile: File? = null
    private var currentRecording: CallRecording? = null

    // Cliente PBX mantido entre as etapas de busca e seleção
    private var pbxClient: PbxApiClient? = null

    // ─────────────────────────────────────────────────────────────────────────
    // Etapa 1: Busca — autentica e lista as gravações disponíveis
    // ─────────────────────────────────────────────────────────────────────────

    fun fetchRecordings(
        pbxHost: String,
        pbxPort: Int,
        username: String,
        password: String
    ) {
        viewModelScope.launch {
            // Encerra cliente anterior se houver
            withContext(Dispatchers.IO) { pbxClient?.logout() }
            pbxClient = null

            val client = PbxApiClient(
                pbxHost   = pbxHost.trim(),
                pbxPort   = pbxPort,
                username  = username.trim(),
                password  = password
            )

            try {
                _uiState.value = UiState.Loading("Autenticando no PBX...")
                withContext(Dispatchers.IO) { client.login() }

                _uiState.value = UiState.Loading("Buscando gravações dos últimos 2 dias...")
                val recordings = withContext(Dispatchers.IO) {
                    client.getRecordingsWithAudio(maxResults = 5)
                }

                if (recordings.isEmpty()) {
                    withContext(Dispatchers.IO) { client.logout() }
                    _uiState.value = UiState.Error(
                        "Nenhuma chamada gravada encontrada nos últimos 2 dias.\n" +
                        "Verifique se a gravação automática está ativada no PBX."
                    )
                    return@launch
                }

                // Guarda o cliente ativo para usar na etapa de seleção
                pbxClient = client
                _uiState.value = UiState.SelectRecording(recordings)

            } catch (e: Exception) {
                Log.e(TAG, "Erro ao buscar gravações: ${e.message}", e)
                withContext(Dispatchers.IO) { client.logout() }
                _uiState.value = UiState.Error(e.message ?: "Falha desconhecida")
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Etapa 2: Seleção — baixa a gravação escolhida pelo usuário
    // ─────────────────────────────────────────────────────────────────────────

    fun selectAndDownload(recording: CallRecording) {
        val client = pbxClient ?: run {
            _uiState.value = UiState.Error("Sessão expirada. Faça a busca novamente.")
            return
        }

        viewModelScope.launch {
            try {
                _uiState.value = UiState.Loading("Obtendo informações do arquivo...")
                val (filedir, filename) = withContext(Dispatchers.IO) {
                    client.getRecordInfosByCall(recording.cdrId)
                }

                _uiState.value = UiState.Loading("Baixando gravação: $filename...")
                val cacheDir = getApplication<Application>().cacheDir
                val audioDir = File(cacheDir, "recordings").also { it.mkdirs() }

                val audioFile = withContext(Dispatchers.IO) {
                    client.downloadRecording(
                        filename = filename,
                        filedir  = filedir,
                        destDir  = audioDir
                    )
                }

                currentRecording = recording
                currentFile = audioFile
                _uiState.value = UiState.RecordingReady(recording, audioFile)

            } catch (e: Exception) {
                Log.e(TAG, "Erro ao baixar gravação: ${e.message}", e)
                _uiState.value = UiState.Error(e.message ?: "Falha ao baixar gravação")
            } finally {
                withContext(Dispatchers.IO) { client.logout() }
                pbxClient = null
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Controle do player de áudio
    // ─────────────────────────────────────────────────────────────────────────

    fun playPause() {
        val file      = currentFile      ?: return
        val recording = currentRecording ?: return
        val player    = mediaPlayer

        if (player == null || !player.isPlaying) {
            if (player == null) {
                startPlayback(file, recording)
            } else {
                player.start()
                _uiState.value = UiState.Playing(recording, file)
            }
        } else {
            player.pause()
            _uiState.value = UiState.Paused(recording, file)
        }
    }

    fun stopPlayback() {
        releasePlayer()
        val recording = currentRecording
        val file      = currentFile
        if (recording != null && file != null) {
            _uiState.value = UiState.RecordingReady(recording, file)
        }
    }

    fun getPlaybackProgress(): Int = try {
        mediaPlayer?.let {
            if (it.duration > 0) (it.currentPosition * 100 / it.duration) else 0
        } ?: 0
    } catch (e: Exception) { 0 }

    fun getDuration(): Int        = try { mediaPlayer?.duration        ?: 0 } catch (e: Exception) { 0 }
    fun getCurrentPosition(): Int = try { mediaPlayer?.currentPosition ?: 0 } catch (e: Exception) { 0 }

    fun seekTo(positionMs: Int) {
        try { mediaPlayer?.seekTo(positionMs) } catch (e: Exception) {
            Log.w(TAG, "Erro no seekTo: ${e.message}")
        }
    }

    val isPlaying: Boolean get() = try { mediaPlayer?.isPlaying == true } catch (e: Exception) { false }

    private fun startPlayback(file: File, recording: CallRecording) {
        releasePlayer()
        try {
            val player = MediaPlayer().apply {
                setDataSource(file.absolutePath)
                setOnCompletionListener {
                    _uiState.postValue(UiState.RecordingReady(recording, file))
                    releasePlayer()
                }
                setOnErrorListener { _, what, extra ->
                    Log.e(TAG, "MediaPlayer error: what=$what extra=$extra")
                    _uiState.postValue(UiState.Error("Erro ao reproduzir áudio (what=$what)"))
                    releasePlayer()
                    true
                }
                prepare()
                start()
            }
            mediaPlayer = player
            _uiState.value = UiState.Playing(recording, file)
        } catch (e: Exception) {
            Log.e(TAG, "Erro ao iniciar playback: ${e.message}", e)
            _uiState.value = UiState.Error("Não foi possível reproduzir o arquivo: ${e.message}")
        }
    }

    private fun releasePlayer() {
        try {
            mediaPlayer?.let { if (it.isPlaying) it.stop(); it.release() }
        } catch (e: Exception) {
            Log.w(TAG, "Erro ao liberar player: ${e.message}")
        }
        mediaPlayer = null
    }

    override fun onCleared() {
        super.onCleared()
        releasePlayer()
        viewModelScope.launch(Dispatchers.IO) { pbxClient?.logout() }
    }
}
