// Converte URLs remotas de imagem em URLs do protocolo de cache `fliperaimg://`
// (ver src/main/imgCache.ts). URLs locais (file://, data:) passam direto.
export function cachedImgUrl(url: string): string {
  if (!/^https?:\/\//.test(url)) return url
  return `fliperaimg://img/?src=${encodeURIComponent(url)}`
}
