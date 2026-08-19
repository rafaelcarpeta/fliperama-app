import { useEffect, useRef, useState } from "react"
import { useStore } from "../store"
import { artFor } from "../launcherArt"
import { useI18n } from "../i18n/useI18n"
import { cachedImgUrl } from "../imgUrl"
import LauncherTabs from "./LauncherTabs"
import ArtModal from "./ArtModal"
import { useClickOutside } from "../useClickOutside"
import { matchTrainer } from "../store"

function gogSlug(name: string): string {
  return name
    .replace(/[\u2122\u00ae\u00a9]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u0307\u0309-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function DotsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <circle cx="8" cy="3" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="8" cy="13" r="1.4" />
    </svg>
  )
}

function Switch({
  label,
  title,
  on,
  onChange,
  disabled,
}: {
  label: string
  title: string
  on: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="switch-row">
      <span>{label}</span>
      <button
        className={`switch ${on ? "on" : ""} ${disabled ? "disabled" : ""}`}
        onClick={() => onChange(!on)}
        aria-pressed={on}
        disabled={disabled}
        title={title}
      >
        <i />
      </button>
    </div>
  )
}

const REVIEW_LABEL_KEYS: Record<string, string> = {
  "Overwhelmingly Positive": "reviews.overwhelminglyPositive",
  "Very Positive": "reviews.veryPositive",
  "Positive": "reviews.positive",
  "Mostly Positive": "reviews.mostlyPositive",
  "Mixed": "reviews.mixed",
  "Mostly Negative": "reviews.mostlyNegative",
  "Very Negative": "reviews.veryNegative",
  "Overwhelmingly Negative": "reviews.overwhelminglyNegative",
}

function reviewKey(label: string): string {
  return REVIEW_LABEL_KEYS[label] ?? label
}

function reviewClass(label: string): "pos" | "mix" | "neg" {
  const neg = ["Mostly Negative", "Very Negative", "Overwhelmingly Negative"]
  const mix = ["Mixed"]
  if (neg.includes(label)) return "neg"
  if (mix.includes(label)) return "mix"
  return "pos"
}

export default function RightPanel(): JSX.Element {
  const { t } = useI18n()
  const games = useStore((s) => s.games)
  const launchers = useStore((s) => s.launchers)
  const selected = useStore((s) => s.selected)
  const details = useStore((s) => s.details)
  const fetchDetails = useStore((s) => s.fetchDetails)
  const steamResolve = useStore((s) => s.steamResolve)
  const backendDetails = useStore((s) => s.backendDetails)
  const resolveBackendDetails = useStore((s) => s.resolveBackendDetails)
  const play = useStore((s) => s.play)
  const install = useStore((s) => s.install)
  const playGame = useStore((s) => s.playGame)
  const installGame = useStore((s) => s.installGame)
  const uninstallGame = useStore((s) => s.uninstallGame)
  const moveGame = useStore((s) => s.moveGame)
  const askConfirm = useStore((s) => s.askConfirm)
  const applyGameArt = useStore((s) => s.applyGameArt)
  const running = useStore((s) => s.running)
  const openSite = useStore((s) => s.openSite)
  const refresh = useStore((s) => s.refresh)
  const setStatus = useStore((s) => s.setStatus)
  const protons = useStore((s) => s.protons)
  const hidden = useStore((s) => s.hidden)
  const toggleHidden = useStore((s) => s.toggleHidden)
  const removeGame = useStore((s) => s.removeGame)
  const downloads = useStore((s) => s.downloads)
  const wemodEnabled = useStore((s) => s.wemodEnabled)
  const setWemodEnabled = useStore((s) => s.setWemodEnabled)
  const trainerFiles = useStore((s) => s.trainerFiles)
  const setTrainerFiles = useStore((s) => s.setTrainerFiles)
  const trainerEnabled = useStore((s) => s.trainerEnabled)
  const setTrainerEnabled = useStore((s) => s.setTrainerEnabled)
  const wemodSupported = useStore((s) => s.wemodSupported)
  // Proton padrão por launcher (execução/jogos) — persistido em
  // launchers/<id>.json. Steam é read-only (gerenciado pelo cliente Steam).
  const launcherProtons = useStore((s) => s.launcherProtons)
  const setLauncherProton = useStore((s) => s.setLauncherProton)
  const protonList = protons.filter((p) => !p.automatic)
  const [steamProton, setSteamProton] = useState<{ name: string | null; version: string | null } | null>(null)
  const [menu, setMenu] = useState(false)
  const [showArt, setShowArt] = useState(false)
  const [gamemodeOn, setGamemodeOn] = useState(false)
  const [gamemodeAvailable, setGamemodeAvailable] = useState(true)
  const [cpuPinOn, setCpuPinOn] = useState(false)
  const [cpuPinAvailable, setCpuPinAvailable] = useState(true)
  const [cpuPinList, setCpuPinListState] = useState("")
  const menuRef = useRef<HTMLDivElement | null>(null)
  useClickOutside(menuRef, () => setMenu(false), menu)

  useEffect(() => {
    void window.api.gamemodeGet().then(setGamemodeOn)
    void window.api.gamemodeDetect().then(setGamemodeAvailable)
    void window.api.cpuPinGet().then(setCpuPinOn)
    void window.api.cpuPinDetect().then(setCpuPinAvailable)
    void window.api.cpuPinListGet().then(setCpuPinListState)
  }, [])
  useEffect(() => {
    // Carrega a pasta de trainers + `.exe` (compartilhado com a aba Trainers).
    void window.api
      .settingsKeyGet("trainersFolder")
      .then((p) => (p ? window.api.scanTrainerExes(p) : []))
      .then(setTrainerFiles)
      .catch(() => undefined)
  }, [setTrainerFiles])
  useEffect(() => {
    const off = window.api.onWemodPlay((p) => {
      if (p.stage === "built") {
        const phase = p.phase ?? "verify"
        setStatus(
          phase === "done" || phase === "skipped"
            ? t("wemod.prepared")
            : `${t("wemod.preparing")} ${Math.round(p.percent ?? 0)}%`
        )
      }
    })
    return () => off()
  }, [setStatus, t])
  const toggleGamemode = (next: boolean): void => {
    if (next && !gamemodeAvailable) return
    void window.api.gamemodeSet(next).then(setGamemodeOn)
  }

  const game =
    selected?.kind === "game" ? games.find((g) => g.id === selected.id) : undefined
  const launcher =
    selected?.kind === "launcher" ? launchers.find((l) => l.id === selected.id) : undefined

  if (selected) {
    console.debug("[RightPanel] render", {
      selected,
      found: !!game,
      gameId: game?.id,
      totalGames: games.length,
      store: game?.store,
    })
  }

  // Hooks sempre executados (não dependem de selected) — DEVEM vir antes
  // de qualquer `return` para evitar React #310 ("hooks inconditional").
  // Esses aliases estreitam o tipo para o ramo do jogo sem re-declarar
  // `game` no escopo superior.
  const g: NonNullable<typeof game> | undefined = game
  const isSteam = g?.store === "steam"
  const isBackend = g?.store === "epic" || g?.store === "gog"
  const gAppid = g?.appid
  // Download ativo do jogo GOG → botão principal mostra progresso.
  const gogDl =
    g?.store === "gog"
      ? downloads.find(
          (d) => d.store === "gog" && d.appId === String(g?.appid) && d.status === "running"
        )
      : undefined

  useEffect(() => {
    if (isSteam && gAppid) void fetchDetails(gAppid)
  }, [isSteam, gAppid, fetchDetails])

  useEffect(() => {
    if (isBackend && g) void resolveBackendDetails(g.id, g.name)
  }, [isBackend, g, resolveBackendDetails])

  // Proton do jogo Steam vindo do config_info do compatdata (read-only).
  useEffect(() => {
    if (isSteam && gAppid) {
      void window.api.steamGameProton(gAppid).then(setSteamProton).catch(() => setSteamProton(null))
    } else {
      setSteamProton(null)
    }
  }, [isSteam, gAppid])

  if (!game && !launcher) {
    return (
      <div className="right-panel empty">
        <div className="empty-art" />
        <p>{t("right.panel.empty")}</p>
      </div>
    )
  }

  const placeholder = (label: string): (() => void) => () => {
    alert(t("right.panel.placeholder", { label }))
  }

  if (launcher) {
    const l = launcher
    const art = artFor(l.store)
    return (
      <div className="right-panel">
        <div className="banner" style={{ background: art.gradient }}>
          {art.iconUrl && (
            <img
              className={art.cover ? "banner-cover" : ""}
              src={art.iconUrl}
              alt={l.name}
              onError={(e) => {
                e.currentTarget.style.display = "none"
              }}
            />
          )}
          <div className="banner-overlay" />
        </div>
        <div className="right-panel-head">
          <h2>{l.name}</h2>
          <p className="tags">
            {l.store} • {l.native ? t("right.panel.native") : t("right.panel.wine")} •{" "}
            {l.installed ? t("right.panel.installed") : t("right.panel.notInstalled")}
          </p>
        </div>
        <div className="play-row" ref={menuRef}>
          <button
            className="btn-play"
            disabled={running}
            onClick={() => (l.installed ? void play(l.id) : void install(l.id))}
          >
            {l.installed ? t("right.panel.start") : t("common.install")}
          </button>
          <button
            className="btn-caret"
            title={t("right.panel.moreOptions")}
            onClick={() => setMenu(!menu)}
            aria-label={t("right.panel.moreOptions")}
          >
            <DotsIcon />
          </button>
          {menu && (
            <div className="dropdown">
              <button onClick={() => openSite(l.web)}>{t("right.panel.menu.website")}</button>
              <button onClick={() => void window.api.openPath(l.prefix)}>{t("right.panel.menu.openLauncherFolder")}</button>
              <button onClick={() => placeholder(t("right.panel.menu.runWinetricks"))()}>{t("right.panel.menu.runWinetricks")}</button>
            </div>
          )}
        </div>
        <LauncherTabs launcher={l} />
        
        <span className="nav-label" style={{ marginTop: 18 }}>{t("right.panel.scriptsActive")}</span>
        <div className="scripts-section">
          <Switch
            label="Performance Boost"
            title={t("right.panel.placeholder", { label: "Performance Boost" })}
            on={false}
            onChange={() => {
              alert(t("right.panel.placeholder", { label: "Performance Boost" }))
            }}
          />
          <Switch
            label="DLSS / FSR Mods"
            title={t("right.panel.placeholder", { label: "DLSS / FSR Mods" })}
            on={false}
            onChange={() => {
              alert(t("right.panel.placeholder", { label: "DLSS / FSR Mods" }))
            }}
          />
          <button className="quick-btn" style={{ marginTop: 10 }} title={t("right.panel.placeholder", { label: t("right.panel.manageScripts") })}>
            {t("right.panel.manageScripts")}
          </button>
        </div>

        <div className="quick-options">
          <span className="nav-label">{t("right.panel.performance")}</span>
          {l.native ? (
            <div className="quick-row" title={t("right.panel.proton.steam.hint")}>
              <span className="quick-row-label">{t("right.panel.proton.steam")}</span>
              <b className="quick-row-value">{t("right.panel.proton.steam.managed")}</b>
            </div>
          ) : (
            <div className="quick-row">
              <span className="quick-row-label">{t("right.panel.proton.default")}</span>
              <select
                className="quick-select"
                value={launcherProtons[l.id] ?? ""}
                onChange={(e) => setLauncherProton(l.id, e.target.value)}
                title={t("right.panel.proton.default.hint") + " — " + t("right.panel.proton.install.hint")}
              >
                <option value="">{t("right.panel.proton.auto")}</option>
                {protonList.map((p) => (
                  <option key={p.path ?? p.name} value={p.path ?? ""}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button className="quick-btn" onClick={() => openSite(l.web)}>{t("right.panel.menu.website")}</button>
          <button className="quick-btn" title={t("right.panel.placeholder", { label: t("right.panel.gameSettings") })}>
            {t("right.panel.gameSettings")}
          </button>
          <button className="quick-btn" title={t("right.panel.placeholder", { label: t("right.panel.manageScripts") })}>
            {t("right.panel.manageScripts")}
          </button>
          <button className="quick-btn" title={t("right.panel.placeholder", { label: t("right.panel.launcherArt") })}>
            {t("right.panel.launcherArt")}
          </button>
        </div>
      </div>
    )
  }

  // Após os early-returns, `game` está garantido. Usamos `!` no narrowing
  // (o early-return já trata o caso undefined).
  const gg = game!
  // Trainer suportado = existe .exe na pasta que casa com o nome do jogo;
  // WeMod suportado = jogo na lista do catálogo WeMod (com a plataforma certa).
  const trainer = matchTrainer(gg.name, trainerFiles)
  const wemodOk = !!wemodSupported[gg.id]
  const isHidden = hidden.includes(gg.id)
  const storeLabel = gg.store === "steam" ? "Steam" : gg.store === "gog" ? "GOG" : "Epic"
  const storePage =
    gg.store === "steam"
      ? `https://store.steampowered.com/app/${gg.appid}`
      : gg.store === "gog"
        ? `https://www.gog.com/en/game/${gogSlug(gg.name)}`
        : `https://store.epicgames.com/p/${encodeURIComponent(gg.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`
  const resolvedAppid = !isSteam && gg.id ? steamResolve[gg.id] : undefined
  const detail = isSteam && gg.appid ? details[gg.appid] : resolvedAppid ? details[resolvedAppid] : undefined
  const fallbackDetail = !isSteam && gg.id ? backendDetails[gg.id] : undefined
  const genres = detail?.genres.length ? detail.genres : (fallbackDetail?.genres ?? [])
  const devs = detail?.developers.length ? detail.developers : (fallbackDetail?.developers ?? [])
  const pubs = detail?.publishers.length ? detail.publishers : (fallbackDetail?.publishers ?? [])
  const release = detail?.releaseDate ?? fallbackDetail?.releaseDate
  return (
    <div className="right-panel">
      <div className="banner">
        <img src={cachedImgUrl(gg.bannerUrl || gg.coverUrl || "")} alt={gg.name} className="banner-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden" }} />
        <div className="banner-overlay" />
      </div>
      <div className="right-panel-head">
        <h2>{gg.name}</h2>
        <div className="store-row">
          <img
            className="store-icon"
            src={
              isSteam
                ? "https://cdn.cloudflare.steamstatic.com/steam/apps/steam_logo.png"
                : gg.store === "gog"
                  ? "https://www.gog.com/favicon.ico"
                  : "https://cdn2.unrealengine.com/Epic+Games+Logo-2a6cb8b1f0a640e4b0e1c1b7f9f7d4d4.png"
            }
            alt={storeLabel}
            onError={(e) => {
              e.currentTarget.style.display = "none"
            }}
          />
          <span className="store-label">{storeLabel}</span>
          <span className="tags-divider">•</span>
          {genres.length ? (
            genres.map((gen) => (
              <span key={gen} className="genre-chip">{gen}</span>
            ))
          ) : (
            <span className="tags">
              {gg.installed ? t("right.panel.installed") : t("right.panel.notInstalled")}
            </span>
          )}
        </div>
      </div>
      <div className="play-row" ref={menuRef}>
        <button
          className="btn-play"
          disabled={running || !!gogDl}
          onClick={() => (gg.installed ? void playGame(gg) : void installGame(gg))}
          title={gogDl ? `${t("downloads.title")}: ${Math.min(100, Math.max(0, gogDl.progress.percent ?? 0)).toFixed(0)}%` : undefined}
        >
          {gogDl
            ? `${Math.min(100, Math.max(0, gogDl.progress.percent ?? 0)).toFixed(0)}%`
            : gg.installed
              ? t("common.play")
              : t("common.install")}
        </button>
        <button
          className="btn-caret"
          title={t("right.panel.moreOptions")}
          onClick={() => setMenu(!menu)}
          aria-label={t("right.panel.moreOptions")}
        >
          <DotsIcon />
        </button>
        {menu && (
          <div className="dropdown">
            <button onClick={() => openSite(storePage)}>
              {isSteam ? t("right.panel.steamPage") : t("right.panel.menu.website")}
            </button>
            {gg.installDir && <button onClick={() => void window.api.openPath(gg.installDir as string)}>{t("right.panel.menu.openGameFolder")}</button>}
            {gg.store === "gog" && gg.installDir && (
              <button
                onClick={() => {
                  setMenu(false)
                  void askConfirm(t("right.panel.confirm.move", { name: gg.name })).then((ok) => {
                    if (ok) void moveGame(gg)
                  })
                }}
              >
                {t("right.panel.menu.moveGame")}
              </button>
            )}
            <button onClick={() => placeholder(t("right.panel.menu.runWinetricks"))()}>{t("right.panel.menu.runWinetricks")}</button>
            <button onClick={() => setShowArt(true)}>{t("right.panel.menu.editArt")}</button>
            {isSteam || gg.store === "gog" || gg.store === "epic" ?
              (gg.installed && (
                <button
                  className="danger"
                  onClick={() => {
                    setMenu(false)
                    void askConfirm(t("right.panel.confirm.uninstall", { name: gg.name })).then((ok) => {
                      if (ok) void uninstallGame(gg)
                    })
                  }}
                >
                  {t("right.panel.menu.uninstall")}
                </button>
              )) : null}
            <button
              onClick={() => {
                toggleHidden(gg.id)
                setMenu(false)
              }}
            >
              {isHidden ? t("right.panel.menu.showInLibrary") : t("right.panel.menu.hideGame")}
            </button>
            <button
              className="danger"
              onClick={() => {
                setMenu(false)
                void askConfirm(t("right.panel.confirm.remove", { name: gg.name })).then((ok) => {
                  if (ok) void removeGame(gg.id)
                })
              }}
            >
              {t("right.panel.menu.removeGame")}
            </button>
          </div>
        )}
      </div>
      <div className="info-section">
        <span className="nav-label">{t("right.panel.info")}</span>
        <div className="info-list">
          <div><span>{t("right.panel.title")}</span><b>{gg.name}</b></div>
          {!isSteam && (
            <>
              <div><span>{t("right.panel.store")}</span><b>{storeLabel}</b></div>
              {gg.sizeGb !== undefined && <div><span>{t("right.panel.size")}</span><b>{gg.sizeGb} GB</b></div>}
              {gg.prefix && <div><span>{t("right.panel.prefix")}</span><b>{gg.prefix}</b></div>}
            </>
          )}
          <div><span>{t("right.panel.genre")}</span><b>{genres.length ? genres.join(", ") : "—"}</b></div>
          <div><span>{t("right.panel.developer")}</span><b>{devs.length ? devs.join(", ") : "—"}</b></div>
          <div><span>{t("right.panel.publisher")}</span><b>{pubs.length ? pubs.join(", ") : "—"}</b></div>
          <div><span>{t("right.panel.release")}</span><b>{release ?? "—"}</b></div>
          {detail?.metacriticScore !== undefined && (
            <div><span>{t("right.panel.metacritic")}</span><b>{detail.metacriticScore}</b></div>
          )}
          {detail?.reviewLabel && (
            <div>
              <span>{t("right.panel.reviews")}</span>
              <b className={`review-label review-${reviewClass(detail.reviewLabel)}`}>
                {t(reviewKey(detail.reviewLabel))}
                <span className="review-total">
                  {" "}
                  · {(
                    (detail.reviewPositive ?? 0) + (detail.reviewNegative ?? 0)
                  ).toLocaleString("pt-BR")}{" "}
                  {t("right.panel.reviews.unit")}
                </span>
              </b>
            </div>
          )}
        </div>
      </div>
      <div className="quick-options">
        <span className="nav-label">{t("right.panel.performance")}</span>
        <Switch
          label={t("right.panel.trainer")}
          title={trainer ? t("right.panel.trainer.hint") : t("right.panel.notSupported")}
          on={!!trainer && trainerEnabled.includes(gg.id)}
          onChange={(next) => setTrainerEnabled(gg.id, next)}
          disabled={!trainer}
        />
        <Switch
          label={t("right.panel.wemod")}
          title={wemodOk ? t("right.panel.wemod.hint") : t("right.panel.notSupported")}
          on={wemodOk && wemodEnabled.includes(gg.id)}
          onChange={(next) => setWemodEnabled(gg.id, next)}
          disabled={!wemodOk}
        />
        {isSteam ? (
          <div className="quick-row" title={t("right.panel.proton.steam.hint")}>
            <span className="quick-row-label">{t("right.panel.proton.steam")}</span>
            <b className="quick-row-value">
              {steamProton
                ? [steamProton.name, steamProton.version].filter(Boolean).join(" · ") ||
                  t("right.panel.proton.steam.unknown")
                : t("right.panel.proton.steam.unknown")}
            </b>
          </div>
        ) : (
          <div className="quick-row">
            <span className="quick-row-label">{t("right.panel.proton.default")}</span>
            <select
              className="quick-select"
              value={launcherProtons[gg.store] ?? ""}
              onChange={(e) => setLauncherProton(gg.store, e.target.value)}
              title={t("right.panel.proton.default.hint") + " — " + t("right.panel.proton.install.hint")}
            >
              <option value="">{t("right.panel.proton.auto")}</option>
              {protonList.map((p) => (
                <option key={p.path ?? p.name} value={p.path ?? ""}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {gg.store === "gog" && (
          <>
            <Switch
              label={t("right.panel.gamemode")}
              title={
                gamemodeAvailable
                  ? t("right.panel.gamemode.hint")
                  : t("right.panel.gamemode.unavailable")
              }
              on={gamemodeOn}
              onChange={toggleGamemode}
              disabled={!gamemodeAvailable}
            />
            <Switch
              label={t("right.panel.cpuPin")}
              title={
                cpuPinAvailable
                  ? t("right.panel.cpuPin.hint")
                  : t("right.panel.cpuPin.unavailable")
              }
              on={cpuPinOn}
              onChange={(next) => {
                void window.api.cpuPinSet(next).then(setCpuPinOn)
              }}
              disabled={!cpuPinAvailable}
            />
            {cpuPinOn && cpuPinAvailable && (
              <div className="quick-row">
                <span className="quick-row-label">{t("right.panel.cpuPin.listLabel")}</span>
                <input
                  className="quick-select"
                  type="text"
                  value={cpuPinList}
                  placeholder={t("right.panel.cpuPin.listHint")}
                  onChange={(e) => {
                    setCpuPinListState(e.target.value)
                    void window.api.cpuPinListSet(e.target.value).then((r) => setCpuPinListState(r))
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
      {showArt && (
        <ArtModal
          game={gg}
          onClose={() => setShowArt(false)}
          onSaved={(patch) => {
            if (patch.coverUrl !== undefined || patch.bannerUrl !== undefined) {
              applyGameArt(gg.id, patch)
            } else {
              void refresh()
            }
          }}
        />
      )}
    </div>
  )
}