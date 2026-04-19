package com.condoconta.grabrecording

import android.content.SharedPreferences
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.ViewModelProvider
import com.google.android.material.button.MaterialButton
import com.condoconta.grabrecording.databinding.ActivityMainBinding
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var viewModel: MainViewModel
    private lateinit var prefs: SharedPreferences

    private val handler = Handler(Looper.getMainLooper())
    private val progressRunnable = object : Runnable {
        override fun run() {
            updateSeekBar()
            handler.postDelayed(this, 500)
        }
    }

    companion object {
        private const val PREFS_NAME = "pbx_config"
        private const val KEY_HOST   = "pbx_host"
        private const val KEY_PORT   = "pbx_port"
        private const val KEY_USER   = "pbx_user"
        private const val KEY_PASS   = "pbx_pass"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        viewModel = ViewModelProvider(this)[MainViewModel::class.java]
        prefs     = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)

        restoreConfig()
        setupListeners()
        observeViewModel()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(progressRunnable)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Setup
    // ─────────────────────────────────────────────────────────────────────────

    private fun restoreConfig() {
        binding.etHost.setText(prefs.getString(KEY_HOST, ""))
        binding.etPort.setText(prefs.getString(KEY_PORT, "8089"))
        binding.etUser.setText(prefs.getString(KEY_USER, ""))
        binding.etPass.setText(prefs.getString(KEY_PASS, ""))
    }

    private fun saveConfig() {
        prefs.edit()
            .putString(KEY_HOST, binding.etHost.text.toString())
            .putString(KEY_PORT, binding.etPort.text.toString())
            .putString(KEY_USER, binding.etUser.text.toString())
            .putString(KEY_PASS, binding.etPass.text.toString())
            .apply()
    }

    private fun setupListeners() {
        binding.btnFetch.setOnClickListener {
            val host    = binding.etHost.text.toString().trim()
            val portStr = binding.etPort.text.toString().trim()
            val user    = binding.etUser.text.toString().trim()
            val pass    = binding.etPass.text.toString()

            if (host.isEmpty() || user.isEmpty() || pass.isEmpty()) {
                showError("Preencha o IP/host, usuário e senha do PBX.")
                return@setOnClickListener
            }

            val port = portStr.toIntOrNull() ?: 8089
            saveConfig()
            viewModel.fetchRecordings(host, port, user, pass)
        }

        binding.btnPlayPause.setOnClickListener { viewModel.playPause() }

        binding.btnStop.setOnClickListener { viewModel.stopPlayback() }

        binding.seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar, progress: Int, fromUser: Boolean) {
                if (fromUser) {
                    val duration = viewModel.getDuration()
                    if (duration > 0) viewModel.seekTo(progress * duration / 100)
                }
            }
            override fun onStartTrackingTouch(seekBar: SeekBar) {}
            override fun onStopTrackingTouch(seekBar: SeekBar) {}
        })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Observação do ViewModel
    // ─────────────────────────────────────────────────────────────────────────

    private fun observeViewModel() {
        viewModel.uiState.observe(this) { state ->
            when (state) {
                is UiState.Idle -> showIdle()

                is UiState.Loading -> showLoading(state.message)

                is UiState.SelectRecording -> showRecordingList(state.recordings)

                is UiState.RecordingReady -> {
                    showRecordingReady(state.recording, state.file)
                    handler.removeCallbacks(progressRunnable)
                    binding.seekBar.progress = 0
                    binding.tvTime.text = "00:00 / ${formatDuration(state.recording.duration.toLongOrNull() ?: 0L)}"
                }

                is UiState.Playing -> {
                    showRecordingReady(state.recording, state.file)
                    binding.btnPlayPause.text = "⏸ Pausar"
                    binding.btnStop.visibility  = View.VISIBLE
                    binding.seekBar.visibility  = View.VISIBLE
                    binding.tvTime.visibility   = View.VISIBLE
                    handler.post(progressRunnable)
                }

                is UiState.Paused -> {
                    showRecordingReady(state.recording, state.file)
                    binding.btnPlayPause.text = "▶ Continuar"
                    handler.removeCallbacks(progressRunnable)
                }

                is UiState.Error -> showError(state.message)
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers de UI
    // ─────────────────────────────────────────────────────────────────────────

    private fun showIdle() {
        binding.progressBar.visibility       = View.GONE
        binding.tvStatus.text                = "Configure o PBX e toque em \"Buscar Gravações\""
        binding.tvStatus.visibility          = View.VISIBLE
        binding.cardRecordingList.visibility = View.GONE
        binding.cardRecording.visibility     = View.GONE
        binding.layoutPlayer.visibility      = View.GONE
        binding.btnFetch.isEnabled           = true
    }

    private fun showLoading(message: String) {
        binding.progressBar.visibility       = View.VISIBLE
        binding.tvStatus.text                = message
        binding.tvStatus.visibility          = View.VISIBLE
        binding.cardRecordingList.visibility = View.GONE
        binding.cardRecording.visibility     = View.GONE
        binding.layoutPlayer.visibility      = View.GONE
        binding.btnFetch.isEnabled           = false
    }

    private fun showRecordingList(recordings: List<CallRecording>) {
        binding.progressBar.visibility       = View.GONE
        binding.tvStatus.visibility          = View.GONE
        binding.cardRecording.visibility     = View.GONE
        binding.layoutPlayer.visibility      = View.GONE
        binding.btnFetch.isEnabled           = true

        val container = binding.llRecordingItems
        container.removeAllViews()

        recordings.forEachIndexed { _, rec ->
            // Container de cada linha
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 12, 0, 12)
            }

            // Bloco de info (data, rota, duração)
            val info = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val tvDate = TextView(this).apply {
                text = rec.start
                textSize = 13f
                setTextColor(getColor(R.color.text_primary))
                setTypeface(null, android.graphics.Typeface.BOLD)
            }

            val tvMeta = TextView(this).apply {
                text = "${rec.caller} → ${rec.callee}  |  ${formatDuration(rec.duration.toLongOrNull() ?: 0L)}  |  ${rec.disposition}"
                textSize = 12f
                setTextColor(getColor(R.color.text_secondary))
            }

            info.addView(tvDate)
            info.addView(tvMeta)

            // Botão Selecionar
            val btn = MaterialButton(this).apply {
                text = "Selecionar"
                textSize = 12f
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).also { it.marginStart = 8 }
                setOnClickListener { viewModel.selectAndDownload(rec) }
            }

            row.addView(info)
            row.addView(btn)
            container.addView(row)

            // Divisória entre linhas (exceto na última)
            if (rec != recordings.last()) {
                val divider = View(this).apply {
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, 1
                    )
                    setBackgroundColor(getColor(android.R.color.darker_gray))
                    alpha = 0.2f
                }
                container.addView(divider)
            }
        }

        binding.cardRecordingList.visibility = View.VISIBLE
    }

    private fun showRecordingReady(recording: CallRecording, file: File) {
        binding.progressBar.visibility       = View.GONE
        binding.tvStatus.visibility          = View.GONE
        binding.cardRecordingList.visibility = View.GONE
        binding.btnFetch.isEnabled           = true

        binding.cardRecording.visibility = View.VISIBLE
        binding.tvCaller.text      = "De: ${recording.caller}"
        binding.tvCallee.text      = "Para: ${recording.callee}"
        binding.tvDate.text        = "Início: ${recording.start}"
        binding.tvDuration.text    = "Duração: ${formatDuration(recording.duration.toLongOrNull() ?: 0L)}"
        binding.tvFilename.text    = "Arquivo: ${recording.recordFile}"
        binding.tvDisposition.text = "Status: ${recording.disposition}"

        binding.layoutPlayer.visibility   = View.VISIBLE
        binding.tvFileSize.text           = "Tamanho: ${formatBytes(file.length())}"
        binding.btnPlayPause.text         = if (viewModel.isPlaying) "⏸ Pausar" else "▶ Reproduzir"
        binding.btnStop.visibility        = if (viewModel.isPlaying) View.VISIBLE else View.GONE
        binding.seekBar.visibility        = if (viewModel.isPlaying) View.VISIBLE else View.GONE
        binding.tvTime.visibility         = if (viewModel.isPlaying) View.VISIBLE else View.GONE
    }

    private fun showError(message: String) {
        binding.progressBar.visibility       = View.GONE
        binding.tvStatus.text                = "❌ $message"
        binding.tvStatus.visibility          = View.VISIBLE
        binding.cardRecordingList.visibility = View.GONE
        binding.cardRecording.visibility     = View.GONE
        binding.layoutPlayer.visibility      = View.GONE
        binding.btnFetch.isEnabled           = true
        handler.removeCallbacks(progressRunnable)
    }

    private fun updateSeekBar() {
        val duration = viewModel.getDuration()
        val position = viewModel.getCurrentPosition()
        if (duration > 0) {
            binding.seekBar.progress = (position * 100 / duration)
            binding.tvTime.text = "${formatMs(position.toLong())} / ${formatMs(duration.toLong())}"
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Formatação
    // ─────────────────────────────────────────────────────────────────────────

    private fun formatDuration(seconds: Long): String {
        val min = seconds / 60
        val sec = seconds % 60
        return "%02d:%02d".format(min, sec)
    }

    private fun formatMs(ms: Long): String {
        val totalSec = ms / 1000
        val min = totalSec / 60
        val sec = totalSec % 60
        return "%02d:%02d".format(min, sec)
    }

    private fun formatBytes(bytes: Long): String = when {
        bytes >= 1_048_576 -> "%.1f MB".format(bytes / 1_048_576.0)
        bytes >= 1_024     -> "%.1f KB".format(bytes / 1_024.0)
        else               -> "$bytes B"
    }
}
