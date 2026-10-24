/*
 * NEXUS TV · configuração dos cartões.
 * Para trocar um app, edite só esta lista.
 *
 * key:   tecla numérica do controle que abre o cartão ("1" a "9").
 * name:  nome exibido.
 * mono:  monograma do cartão (1 ou 2 letras).
 * color: cor de destaque do cartão.
 * url:   endereço aberto na mesma aba (Voltar retorna para a NEXUS).
 * group: "apps" (cartões grandes) ou "shortcuts" (atalhos).
 * featured: true para aparecer no destaque grande.
 */
window.NEXUS_APPS = [
  { key: "1", name: "YouTube", mono: "YT", color: "#ff3b3b", url: "https://www.youtube.com/", group: "apps", featured: true,
    blurb: "Vídeos, música e transmissões ao vivo." },
  { key: "2", name: "Globoplay", mono: "G", color: "#ff5a36", url: "https://globoplay.globo.com/", group: "apps" },
  { key: "3", name: "Netflix", mono: "N", color: "#e50914", url: "https://www.netflix.com/", group: "apps" },
  { key: "4", name: "Prime Video", mono: "PV", color: "#1fa2ff", url: "https://www.primevideo.com/", group: "apps" },
  { key: "5", name: "Spotify", mono: "S", color: "#1ed760", url: "https://open.spotify.com/", group: "apps" },
  { key: "6", name: "Google", mono: "G", color: "#4c8dff", url: "https://www.google.com/", group: "apps" },

  { key: "7", name: "Notícias", mono: "g1", color: "#c4170c", url: "https://g1.globo.com/", group: "shortcuts" },
  { key: "8", name: "Clima", mono: "☀", color: "#ffb02e", url: "https://www.climatempo.com.br/", group: "shortcuts" },
  { key: "9", name: "Wikipédia", mono: "W", color: "#c9d1e6", url: "https://pt.wikipedia.org/", group: "shortcuts" }
];
