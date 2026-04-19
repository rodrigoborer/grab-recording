# Deploy — GrabRecording no Debian 13

Guia completo para instalar, configurar e manter o serviço rodando 24/7.

---

## 1. Pré-requisitos no servidor

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-pip python3-venv git curl ufw
```

Verifique a versão do Python (precisa ser 3.10+):

```bash
python3 --version
```

---

## 2. Copiar os arquivos para o servidor

Crie o diretório da aplicação:

```bash
sudo mkdir -p /opt/grabrecording
sudo chown $USER:$USER /opt/grabrecording
```

Copie os arquivos do projeto (escolha uma das opções):

**Opção A — via SCP do seu computador Windows:**
```bash
# Execute no PowerShell/terminal do Windows:
scp -r "C:\Users\rodri\OneDrive\Área de Trabalho\Claude\API\Grab Recording\GrabRecordingWebPython\*" usuario@IP_DO_SERVIDOR:/opt/grabrecording/
```

**Opção B — via pendrive/transferência manual:**  
Copie os arquivos `app.py`, `requirements.txt` e a pasta `public/` para `/opt/grabrecording/`.

A estrutura final deve ser:
```
/opt/grabrecording/
├── app.py
├── requirements.txt
└── public/
    └── index.html
```

---

## 3. Ambiente virtual Python e dependências

```bash
cd /opt/grabrecording
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Teste se a aplicação sobe corretamente:

```bash
python app.py
# Deve exibir: Running on http://0.0.0.0:5000
# Pressione Ctrl+C para parar
```

---

## 4. Criar o serviço systemd

O systemd é o gerenciador de serviços do Debian. Ele garante que o app suba automaticamente no boot e reinicie em caso de falha.

Crie o arquivo de serviço:

```bash
sudo nano /etc/systemd/system/grabrecording.service
```

Cole o conteúdo abaixo (ajuste `User` para o seu usuário do sistema):

```ini
[Unit]
Description=GrabRecording - Download de gravações do PBX
After=network.target

[Service]
Type=simple
User=SEU_USUARIO
WorkingDirectory=/opt/grabrecording
ExecStart=/opt/grabrecording/venv/bin/python app.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

> **Atenção:** substitua `SEU_USUARIO` pelo usuário Linux que você usa no servidor  
> (ex.: `User=rodrigo` ou `User=www-data`)

---

## 5. Ativar e iniciar o serviço

```bash
# Recarregar o systemd para reconhecer o novo serviço
sudo systemctl daemon-reload

# Habilitar para iniciar automaticamente no boot
sudo systemctl enable grabrecording

# Iniciar agora
sudo systemctl start grabrecording

# Verificar se está rodando
sudo systemctl status grabrecording
```

A saída esperada mostra `Active: active (running)`.

---

## 6. Comandos úteis do serviço

| Ação | Comando |
|------|---------|
| Ver status | `sudo systemctl status grabrecording` |
| Ver logs em tempo real | `sudo journalctl -u grabrecording -f` |
| Ver logs do dia | `sudo journalctl -u grabrecording --since today` |
| Reiniciar | `sudo systemctl restart grabrecording` |
| Parar | `sudo systemctl stop grabrecording` |
| Desabilitar no boot | `sudo systemctl disable grabrecording` |

---

## 7. Firewall — liberar a porta 5000

```bash
# Ativar o firewall (se ainda não estiver ativo)
sudo ufw enable

# Liberar SSH para não perder acesso remoto
sudo ufw allow ssh

# Liberar a porta da aplicação
sudo ufw allow 5000/tcp

# Verificar regras
sudo ufw status
```

Acesse a aplicação pelo navegador:
```
http://IP_DO_SERVIDOR:5000
```

---

## 8. (Recomendado) Expor na porta 80 com Nginx

Por padrão o Flask roda na porta 5000. Para acessar sem digitar a porta no navegador (`http://IP_DO_SERVIDOR`), use o Nginx como proxy reverso.

```bash
sudo apt install -y nginx
```

Crie o arquivo de configuração:

```bash
sudo nano /etc/nginx/sites-available/grabrecording
```

Conteúdo:

```nginx
server {
    listen 80;
    server_name _;          # aceita qualquer IP/hostname

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
}
```

Ative o site e reinicie o Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/grabrecording /etc/nginx/sites-enabled/
sudo nginx -t                      # testa a configuração
sudo systemctl enable nginx
sudo systemctl restart nginx

# Abrir porta 80 no firewall
sudo ufw allow 80/tcp
```

Agora acesse só com:
```
http://IP_DO_SERVIDOR
```

---

## 9. Atualizar a aplicação no futuro

Sempre que você modificar `app.py` ou `index.html`, basta:

```bash
# Copie os novos arquivos para /opt/grabrecording/
# Depois reinicie o serviço:
sudo systemctl restart grabrecording
```

---

## 10. Resumo rápido (checklist)

- [ ] `apt install python3 python3-venv ufw`
- [ ] Arquivos copiados para `/opt/grabrecording/`
- [ ] `python3 -m venv venv && pip install -r requirements.txt`
- [ ] Arquivo `/etc/systemd/system/grabrecording.service` criado
- [ ] `systemctl enable grabrecording && systemctl start grabrecording`
- [ ] `ufw allow 5000/tcp` (ou `80/tcp` se usar Nginx)
- [ ] Acesso confirmado pelo navegador
