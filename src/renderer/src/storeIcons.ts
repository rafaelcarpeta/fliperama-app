import steam from "../assets/store/steam.png"
import gog from "../assets/store/gog.png"
import epic from "../assets/store/epic.png"
import battlenet from "../assets/store/battlenet.png"
import ubisoft from "../assets/store/ubisoft.png"
import ea from "../assets/store/ea.png"

export const STORE_ICONS: Record<string, string> = {
  steam,
  gog,
  epic,
  battlenet,
  ubisoft_connect: ubisoft,
  ea_app: ea,
}

export function storeIcon(store: string): string | undefined {
  return STORE_ICONS[store]
}
