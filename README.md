# Fliperama

Hub Electron para gerenciar launchers e jogos no Linux via Wine e UMU/Proton.

## Visão geral

O Fliperama centraliza launchers, bibliotecas de jogos e ferramentas de
compatibilidade em uma única interface. Launchers Windows usam `umu-run` com
Proton/Wine; a Steam usa o cliente Linux nativo.

- **Plataforma-alvo:** Linux (XWayland default; Wayland nativo desativado por
  incompatibilidade com Electron 31 + `radv`).
- **Stack:** Electron 31 + React 18 + TypeScript + Vite + Zustand.
- **Runtime de jogos:** `umu-run` + Proton/Wine (não usa Lutris).
- **Steam:** cliente nativo (pacote distro), não roda via UMU.

## Recursos atuais

- **Bibliotecas unificadas** Steam / Epic / GOG (filtro "removidos da lista"
  persistente, sem flash no boot).
- **Launchers:** Steam, Battle.net, Ubisoft Connect, EA app, Epic Games e
  Rockstar Games Launcher.
- **GameMode** (`gamemoderun`) e CPU pinning configuráveis no painel do jogo.
- **Proton padrão** global (configurável por dropdown no RightPanel; padrão
  Proton Experimental).
- **Instalação de jogos:** Steam via cliente nativo, Epic via launcher nativo e
  GOG via `gogdl`, com acompanhamento de download no app.
- **Dependências de runtime:** `umu-run`, Wine, Winetricks, Proton, drivers
  Vulkan — instalador integrado (pkexec).
- **Loja:** promoções (Steam) + bundles (Humble / Fanatical) com hero banner
  carrossel e logos oficiais.
- **Updates via servidor próprio:** provider `generic` + `electron-updater`
  apontando para `https://files.fliperama.top/fliperama/`
  (Cloudflare Tunnel + servidor Python).
- **Tray + minimizar para bandeja** e autostart.
- **Trainers e Cheat Engine:** seleção de prefixo, varredura de executáveis e
  execução integrada; suporte opcional ao WeMod no fluxo de início do jogo.
- **Cache de imagens local** (`fliperaimg://`), thumbnails Steam, capa Epic/GOG
  com fallback Wikidata e pré-carregamento integrado à grade virtualizada.
- **Design system oficial:** tokens extraídos da landing page, fontes offline,
  auditorias automáticas e identidade visual compartilhada pela splash e UI.
- **Sistema de arquivos:** prefixos Wine em `~/Fliperama/umu`, jogos em
  `~/Fliperama/games` (ambos configuráveis).

## Comandos

```bash
npm install        # deps
npm run dev        # dev (renderer + main hot-reload)
npm run typecheck  # tsc --noEmit (node + web)
npm run build      # empacota out/{main,preload,renderer}
npm run dist       # gera release/Fliperama-<ver>.AppImage
npm run design:usage:audit  # rejeita literais visuais nas camadas migradas
npm run design:contrast     # verifica contrastes semânticos
npm run design:fonts:verify # verifica as fontes offline
npm run publish:server  # build + scp + validação sha512/HTTP no servidor
```

## Releases

Pipeline de release: `bump version` → `npm run publish:server`
(`scripts/publish-server.sh` faz build, scp, conferindo sha512 e HTTP 200).
O **app não é publicado via GitHub Releases** — o `latest-linux.yml` mora no
servidor e o feed é lido diretamente pelo `electron-updater`.

Release atual: **v0.3.0** — [AppImage](https://files.fliperama.top/fliperama/Fliperama-0.3.0.AppImage) · [feed](https://files.fliperama.top/fliperama/latest-linux.yml).

Configuração em `package.json`:

```jsonc
"build": {
  "publish": [{ "provider": "generic", "url": "https://files.fliperama.top/fliperama/" }],
  "artifactName": "Fliperama-${version}.${ext}"
}
```

### GitHub Releases: prefixos pré-configurados (não são o app)

As releases do repositório no GitHub — como
[built-prefixes-v1](https://github.com/rafaelcarpeta/fliperamabr/releases/tag/built-prefixes-v1) —
**não são o aplicativo** e não são usadas pelo `electron-updater`. Elas
contêm **prefixos Wine pré-configurados** (built prefixes) que o Fliperama
baixa em runtime.

**Finalidade**

Cada zip é um prefixo Wine já preparado contendo:

- **.NET Framework 4.8** instalado (`registry NDP` + `Microsoft.NET` +
  DLLs de runtime em `drive_c/windows`);
- **instalador WeMod** embutido (marcador `.wemod_installer`).

Quando um jogo entra no fluxo WeMod e o prefixo dele ainda não tem .NET 4.8,
o Fliperama baixa o built prefix **correspondente ao Proton que vai rodar o
jogo** e faz um *merge inteligente* no prefixo destino: copia apenas o
essencial (registry `NDP` + `drive_c/windows`), ignorando os overrides DX
nativos (`d3d11`, `d3d12`, `dxgi`, `d3d9`, `mscoree`) para não
quebrar o Proton do jogo.

**Alinhamento por Proton**

| Proton do jogo | Built prefix usado |
|---|---|
| GE-Proton (ex.: GE-Proton11-3 / 11-5) | `GE-Proton11-5.zip` |
| Proton Experimental (Steam ou launcher) | `Proton-Experimental-11.0-20260814b.zip` |
| CachyOS Proton (Steam ou launcher) | `proton-cachyos-11.0-20260703-slr-x86_64.zip` |
| UMU-Proton (default) ou sem correspondência | `GE-Proton10.1.zip` (fallback, do repositório de origem) |

A escolha vem do `config_info` do compatdata para jogos Steam ou do default
de Proton configurado por launcher (GOG/Epic/...); a busca é **cache local →
release do fliperamabr → fallback**. Por isso esses arquivos só fazem sentido
junto do app: baixar e usar um deles manualmente exige descompactar dentro de
um prefixo Wine existente — sozinhos, não são instaláveis nem executáveis.

## Servidor de arquivos (`note`)

- Pasta: `~/arquivos/fliperama/`.
- HTTP: `serve_arquivos.py` em `:3002` (dual-stack, listagem 403).
- HTTPS público pelo Cloudflare Tunnel em `https://files.fliperama.top/`;
  origem HTTP local na porta `3002`.
- Suporte a `Range` (download diferencial/resumível do `electron-updater`).

## Stack e arquitetura

- `src/main/` — backend Electron (IPC, atualizações, biblioteca, downloads,
  backends Epic/GOG, Steam, Proton, Wine/UMU, trainers, WeMod, Wikidata e preços).
- `src/preload/index.ts` — `contextBridge` expondo `window.api` (sandbox
  ativo, `contextIsolation: true`, `nodeIntegration: false`).
- `src/renderer/` — UI React. `store.ts` Zustand (hidrata `hidden`/`removed`
  no boot para evitar flash dos ocultos).
- `src/renderer/src/design-system/` — tokens, fontes, primitivas, playground e
  camadas incrementais de migração visual.
- Workers (`vdf-worker.js`) — parsing de VDF e filtros pesados fora do
  event loop (`pool.ts`).
- `src/main/perf.ts` — instrumentação `[perf] ...` para medições de boot.

## Updater no app

`electron-updater` é configurado com `autoDownload=false` por padrão — o
usuário precisa clicar **verificar e atualizar** em Configurações →
Atualizações. Há também um toggle **Atualização automática** (quando
ligado, baixa em background e instala ao fechar).

## Updates futuros (roadmap)

- **Big picture (suporte a gamepad):** layout otimizado para TV/grandes telas,
  navegação por controle.
- **Gerenciar arquivos locais:** mover instalação do jogo entre discos /
  pastas sem reinstalar.
- **Goverlay:** instalar/executar o `goverlay` e adicionar automaticamente
  `%command%` em `~/.local/share/goverlay/gameconfig/global/bgmod` para
  aplicar overlay por jogo.
- **CPU pining:** detectar topologia de CPUs (P/E cores) e fixar processos a
  cores específicas.
- **Monitoramento de conquistas:** integrar APIs de achievements (Steam,
  GOG).
- **Monitoramento de tempo de jogo:** métricas detalhadas por jogo/período.
- **Save Game em nuvem:** sincronização de saves (Steam Cloud, Google Drive,
  etc.).
- **Port para Windows:** build `electron-builder --windows` + testes da stack
  UMU/Wine em ambiente Windows.

## Aviso

O projeto continua em desenvolvimento. Releases oficiais são publicadas pelo
feed próprio acima. Configurações avançadas de Proton, diretórios, contas e
dependências ficam em **Configurações**; opções específicas de execução ficam
no painel do jogo.
