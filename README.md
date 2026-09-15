# WhatsApp History Importer

Aplicativo desktop de uso pessoal que importa o histórico do seu WhatsApp
(conversas individuais e grupos) para um banco de dados local e exibe tudo em
uma interface no estilo do WhatsApp Web. Tudo roda no seu computador.

*Personal-use desktop app that imports your WhatsApp history (1:1 chats and
groups) into a local database and shows it in a WhatsApp-Web-style UI.
Everything runs on your own machine.*

![Interface do WhatsApp History Importer: lista de conversas à esquerda, balões de mensagem à direita](docs/screenshot.png)

> **Aviso / Disclaimer:** este projeto não é afiliado ao WhatsApp LLC nem à Meta
> Platforms, Inc. Use apenas com a sua própria conta. Leia [DISCLAIMER.md](DISCLAIMER.md).

---

## Português (PT-BR)

### Requisitos

| Requisito | Versão | Observação |
| --- | --- | --- |
| Python | ≥ 3.11 | usado pelo lançador e pelo agendador |
| Node.js | ≥ 18 | usado pelo processo que fala com o WhatsApp |
| ffmpeg | — | baixado automaticamente pelo `initial.py` |

Testado em macOS e Linux.

### Início rápido (3 passos)

```bash
git clone https://github.com/FalcaoOtavio/whatsapp-history-importer.git
cd whatsapp-history-importer
python3 initial.py
```

O `initial.py` cuida de tudo: cria a `.venv`, instala as dependências Python,
roda `npm ci` no backend, baixa o ffmpeg e abre a janela do aplicativo.

Para apenas conferir os pré-requisitos sem abrir a janela:

```bash
python3 initial.py --check            # verifica e instala
python3 initial.py --check --skip-ffmpeg   # pula o download do ffmpeg
```

### Primeiro uso

1. A janela abre mostrando um **QR Code**.
2. No celular: **WhatsApp → Configurações → Dispositivos conectados → Conectar dispositivo**.
3. Aponte a câmera para o QR Code. A importação do histórico começa sozinha e o
   progresso aparece na tela.

Depois de pareado, a sessão fica salva em `auth_info/` — nas próximas vezes o
aplicativo já abre conectado, sem QR Code.

### O que o aplicativo faz

- Importa conversas individuais e grupos, com texto, imagens, vídeos, áudios e
  documentos.
- Guarda tudo em **SQLite** (`whatsapp-history.sqlite3`), o banco canônico.
- Exibe o histórico em uma interface estilo WhatsApp Web, navegável por teclado
  e testada com `axe-core`.
- **Sincroniza todo dia à 01:00 (horário de Brasília)** para trazer as mensagens
  novas. A próxima execução é mostrada no terminal ao abrir o app.
- A tela de sincronização acompanha o progresso em tempo real, conversa a
  conversa.

### Onde ficam os seus dados

| Caminho | Conteúdo |
| --- | --- |
| `whatsapp-history.sqlite3` | mensagens, conversas e metadados |
| `.media/` | imagens, vídeos, áudios e documentos baixados |
| `auth_info/` | credenciais da sessão do WhatsApp |

Nada disso é versionado (veja o `.gitignore`) e nada sai do seu computador: não
há telemetria nem servidores de terceiros. O servidor interno escuta apenas em
`127.0.0.1`.

### Bancos opcionais

Além do SQLite, o histórico pode ser espelhado em Postgres e/ou MongoDB. Basta
definir as variáveis de ambiente antes de abrir o app — se não definir, nada
muda:

```bash
export DATABASE_URL="postgres://usuario:senha@localhost:5432/whatsapp"
export MONGODB_URL="mongodb://localhost:27017/whatsapp"
python3 initial.py
```

### Desenvolvimento

```bash
# Python (lançador + agendador)
./.venv/bin/python -m pytest launcher/tests/ -q
./.venv/bin/python -m ruff check launcher initial.py

# Backend (sidecar Node/TypeScript)
cd backend && npm run lint && npx tsc --noEmit && npm test

# Frontend (interface)
cd frontend && npm run lint && npm test
```

Para provar que a instalação funciona do zero, em um clone limpo:

```bash
scripts/verify-install.sh
```

A captura de tela do README é gerada a partir do HTML, do CSS e das funções de
renderização reais, com dados fictícios:

```bash
node scripts/make-screenshot.mjs
```

### Licença

[MIT](LICENSE).

---

## English (EN)

### Requirements

| Requirement | Version | Note |
| --- | --- | --- |
| Python | ≥ 3.11 | runs the launcher and the scheduler |
| Node.js | ≥ 18 | runs the process that talks to WhatsApp |
| ffmpeg | — | downloaded automatically by `initial.py` |

Tested on macOS and Linux.

### Quickstart (3 steps)

```bash
git clone https://github.com/FalcaoOtavio/whatsapp-history-importer.git
cd whatsapp-history-importer
python3 initial.py
```

`initial.py` does everything: creates `.venv`, installs the Python
dependencies, runs `npm ci` in the backend, downloads ffmpeg and opens the app
window.

To check prerequisites without opening the window:

```bash
python3 initial.py --check              # verify and install
python3 initial.py --check --skip-ffmpeg   # skip the ffmpeg download
```

### First run

1. The window opens showing a **QR code**.
2. On your phone: **WhatsApp → Settings → Linked devices → Link a device**.
3. Point the camera at the QR code. History import starts on its own and
   progress is shown on screen.

Once paired, the session is stored in `auth_info/` — later runs open already
connected, with no QR code.

### What it does

- Imports 1:1 chats and groups, including text, images, videos, audio and
  documents.
- Stores everything in **SQLite** (`whatsapp-history.sqlite3`), the canonical
  database.
- Shows the history in a WhatsApp-Web-style UI: keyboard navigable and checked
  with `axe-core`.
- **Syncs daily at 01:00 (America/Sao_Paulo)** to pull new messages. The next
  run time is printed to the terminal on startup.
- The sync screen follows progress live, chat by chat.

### Where your data lives

| Path | Contents |
| --- | --- |
| `whatsapp-history.sqlite3` | messages, chats and metadata |
| `.media/` | downloaded images, videos, audio and documents |
| `auth_info/` | WhatsApp session credentials |

None of it is committed (see `.gitignore`) and none of it leaves your machine:
no telemetry, no third-party servers. The internal server listens on
`127.0.0.1` only.

### Optional databases

Besides SQLite, history can be mirrored to Postgres and/or MongoDB. Just set the
environment variables before launching — leave them unset and nothing changes:

```bash
export DATABASE_URL="postgres://user:password@localhost:5432/whatsapp"
export MONGODB_URL="mongodb://localhost:27017/whatsapp"
python3 initial.py
```

### Development

```bash
# Python (launcher + scheduler)
./.venv/bin/python -m pytest launcher/tests/ -q
./.venv/bin/python -m ruff check launcher initial.py

# Backend (Node/TypeScript sidecar)
cd backend && npm run lint && npx tsc --noEmit && npm test

# Frontend (UI)
cd frontend && npm run lint && npm test
```

To prove a from-scratch install works, against a clean clone:

```bash
scripts/verify-install.sh
```

The README screenshot is generated from the real HTML, CSS and render
functions, with synthetic data:

```bash
node scripts/make-screenshot.mjs
```

### License

[MIT](LICENSE).
