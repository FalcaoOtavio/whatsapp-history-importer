# v0.1.0 — primeira versão / first release

## Português

Aplicativo de desktop que importa seu próprio histórico do WhatsApp e o guarda
localmente, com uma interface parecida com a do WhatsApp Web para navegar pelas
conversas.

**Tudo fica na sua máquina.** O servidor escuta apenas em `127.0.0.1`, não há
telemetria, e nenhum dado sai do computador além da conexão com o próprio
WhatsApp.

### O que esta versão faz

- Instalação em um comando: `python3 initial.py` prepara o venv, instala as
  dependências do Node e sobe o app.
- Pareamento por QR Code, como um dispositivo conectado do WhatsApp.
- Importa o histórico dos últimos 3 anos para um banco SQLite local.
- Baixa as mídias (imagens, vídeos, áudios, documentos e figurinhas) e gera
  miniaturas e formas de onda para os áudios.
- Interface com lista de conversas, balões de mensagem, imagens, vídeos e áudios.
- Tela de progresso ao vivo durante a sincronização.
- Sincronização automática diária às 01:00 (horário de Brasília).
- Espelhamento opcional para Postgres (`DATABASE_URL`) ou MongoDB (`MONGODB_URL`),
  também locais. O SQLite continua sendo a fonte canônica.

### Requisitos

Python 3.11 ou mais recente e Node.js 22 ou mais recente. O Node 22 é exigido
pelo `better-sqlite3`; versões anteriores travam.

### Limitações conhecidas

- O WhatsApp expira os links de mídia depois de um tempo, então anexos antigos
  podem não ser mais baixáveis. A mensagem e o texto continuam preservados.
- Sem ffmpeg não há miniaturas nem formas de onda; o resto funciona normalmente.
- Não há botão de sincronização manual na interface: a sincronização acontece ao
  conectar e no horário agendado.
- Testado em macOS (Apple Silicon) e Linux (Debian 12 em contêiner). Windows não
  foi verificado.
- Instalar o projeto dentro do iCloud Drive funciona, mas a primeira abertura é
  lenta: o iCloud sincroniza milhares de arquivos de `node_modules/`.

### Aviso

Projeto independente, sem nenhuma relação com o WhatsApp ou a Meta. Use apenas
com a sua própria conta. Licença MIT.

---

## English

A desktop app that imports your own WhatsApp history and keeps it locally, with
a WhatsApp Web-like interface for browsing your conversations.

**Everything stays on your machine.** The server listens on `127.0.0.1` only,
there is no telemetry, and no data leaves the computer apart from the connection
to WhatsApp itself.

### What this release does

- One-command install: `python3 initial.py` sets up the venv, installs the Node
  dependencies and launches the app.
- QR code pairing, as a WhatsApp linked device.
- Imports the last 3 years of history into a local SQLite database.
- Downloads media (images, videos, audio, documents and stickers) and generates
  thumbnails plus audio waveforms.
- UI with a chat list, message bubbles, images, videos and audio.
- Live progress screen while syncing.
- Automatic daily sync at 01:00 (Brasília time).
- Optional mirroring to Postgres (`DATABASE_URL`) or MongoDB (`MONGODB_URL`),
  also local. SQLite remains the canonical store.

### Requirements

Python 3.11 or newer and Node.js 22 or newer. Node 22 is required by
`better-sqlite3`; earlier versions crash.

### Known limitations

- WhatsApp expires media URLs after a while, so older attachments may no longer
  be downloadable. The message and its text are still preserved.
- Without ffmpeg there are no thumbnails or waveforms; everything else works.
- There is no manual sync button in the UI: syncing happens on connect and on
  the daily schedule.
- Tested on macOS (Apple Silicon) and Linux (Debian 12, in a container). Windows
  is unverified.
- Installing inside iCloud Drive works, but the first launch is slow: iCloud
  syncs the thousands of files under `node_modules/`.

### Disclaimer

Independent project, not affiliated with WhatsApp or Meta. Use it only with your
own account. MIT licensed.
