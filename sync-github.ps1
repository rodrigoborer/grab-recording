# sync-github.ps1 - Sincroniza a pasta local com o repositorio GitHub

Set-Location $PSScriptRoot

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  GrabRecording - Sync com GitHub" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Verifica se ha mudancas
$status = git status --porcelain
if (-not $status) {
    Write-Host "Nenhuma mudanca detectada. Repositorio ja esta atualizado." -ForegroundColor Green
    Write-Host ""
    Read-Host "Pressione Enter para fechar"
    exit
}

# Mostra os arquivos alterados
Write-Host "Arquivos alterados:" -ForegroundColor Yellow
git status --short
Write-Host ""

# Pede mensagem de commit
$msg = Read-Host "Descricao das mudancas (deixe vazio para usar a data/hora)"
if (-not $msg) {
    $msg = "chore: atualizacao $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

Write-Host ""
Write-Host "Enviando para o GitHub..." -ForegroundColor Cyan

git add .
git commit -m $msg
git push

Write-Host ""
if ($LASTEXITCODE -eq 0) {
    Write-Host "Sincronizado com sucesso!" -ForegroundColor Green
    Write-Host "Repositorio: https://github.com/rodrigoborer/grab-recording" -ForegroundColor Cyan
} else {
    Write-Host "Erro ao sincronizar. Verifique sua conexao e o token do GitHub." -ForegroundColor Red
}

Write-Host ""
Read-Host "Pressione Enter para fechar"
