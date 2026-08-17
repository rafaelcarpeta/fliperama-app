import eaLogo from "../assets/launchers/ea.png"
import ubisoftGrid from "../assets/launchers/ubisoft.png"
import battlenetGrid from "../assets/launchers/battlenet.png"

export interface LauncherArt {
  iconUrl: string
  gradient: string
  cover?: boolean
}

const WM = (file: string): string =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=128`

const ART: Record<string, LauncherArt> = {
  steam: {
    iconUrl: "https://store.steampowered.com/favicon.ico",
    gradient: "linear-gradient(160deg,#1b2838,#0f1a2e)",
  },
  epic: {
    iconUrl: WM("Epic_Games_logo.svg"),
    gradient: "linear-gradient(160deg,#2a2a2a,#151515)",
  },
  gog: {
    iconUrl: "https://www.gog.com/favicon.ico",
    gradient: "linear-gradient(160deg,#4b2e83,#2a1748)",
  },
  battlenet: {
    iconUrl: battlenetGrid,
    gradient: "linear-gradient(160deg,#00aeff,#8a2be2)",
    cover: true,
  },
  ubisoft: {
    iconUrl: ubisoftGrid,
    gradient: "linear-gradient(160deg,#1f1f1f,#3d3d3d)",
    cover: true,
  },
  ea: {
    iconUrl: eaLogo,
    gradient: "linear-gradient(160deg,#ff4747,#7a1212)",
  },
  rockstar: {
    iconUrl: WM("Rockstar_Games_logo.svg"),
    gradient: "linear-gradient(160deg,#fca311,#14213d)",
  },
}

const ALIASES: Record<string, string> = {
  ubisoft_connect: "ubisoft",
  ea_app: "ea",
}

export function artFor(store: string): LauncherArt {
  const key = ALIASES[store] ?? store
  return ART[key] ?? { iconUrl: "", gradient: "linear-gradient(160deg,#1a1a22,#0f0f14)" }
}
