/*
 * NEXUS TV · configuração.
 *
 * NEXUS_SERVICES: serviços de streaming que podem aparecer como origem dos
 * títulos do TMDB (disponibilidade segundo JustWatch; pode variar). O "id"
 * é o mesmo usado pela função /api/home. Clicar num título abre o site
 * oficial do serviço; a reprodução depende do navegador da TV e do serviço.
 *
 * NEXUS_APPS: a dock. "tier" define o lado: "main" (cartões grandes) ou
 * "more" (ícones redondos). Para adicionar HBO Max, Disney+ ou Apple TV+ à
 * dock, basta acrescentar uma entrada com service: "max" | "disney" | "apple".
 *
 *   key:     tecla numérica ("1"–"9", "0"); vazio = sem tecla
 *   name / short: nome completo e nome curto do cartão
 *   mono:    monograma dos ícones redondos
 *   color:   cor do cartão ou do monograma (#rrggbb)
 *   img:     arte local usada quando não há destaque do TMDB
 *   service: id em NEXUS_SERVICES (o destaque mostra um título desse serviço)
 *   type:    "site" (abre url na mesma aba) | "info" (painel) | "link" (página da NEXUS)
 */
window.NEXUS_SERVICES = {
  netflix:   { name: "Netflix", url: "https://www.netflix.com/" },
  prime:     { name: "Prime Video", url: "https://www.primevideo.com/" },
  max:       { name: "HBO Max", url: "https://www.hbomax.com/" },
  disney:    { name: "Disney+", url: "https://www.disneyplus.com/" },
  apple:     { name: "Apple TV", url: "https://tv.apple.com/" },
  globoplay: { name: "Globoplay", url: "https://globoplay.globo.com/" }
};

window.NEXUS_APPS = [
  { key: "1", tier: "main", name: "YouTube", short: "YouTube", color: "#e62117", img: "assets/img/youtube.webp",
    type: "site", url: "https://www.youtube.com/", blurb: "Vídeos, canais e transmissões ao vivo." },
  { key: "2", tier: "main", name: "Netflix", short: "Netflix", color: "#141414", ink: "#e50914", img: "assets/img/netflix.webp",
    type: "site", url: "https://www.netflix.com/", service: "netflix", blurb: "Séries e filmes. A reprodução no navegador da TV depende de DRM." },
  { key: "3", tier: "main", name: "Prime Video", short: "Prime Video", color: "#1a98ff", img: "assets/img/prime.webp",
    type: "site", url: "https://www.primevideo.com/", service: "prime", blurb: "Filmes e séries da Amazon. A reprodução depende de DRM." },
  { key: "4", tier: "main", name: "Spotify", short: "Spotify", color: "#1db954", img: "assets/img/spotify.webp",
    type: "site", url: "https://open.spotify.com/", blurb: "Músicas e podcasts pelo player web." },
  { key: "5", tier: "main", name: "IBO Player Pro", short: "IBO Player", color: "#3a4452", img: "assets/img/ibo.webp",
    type: "info", blurb: "App instalado no VIDAA. Abertura direta pela NEXUS não confirmada.",
    panel: {
      title: "IBO Player Pro",
      status: "Abertura direta pela NEXUS: não confirmada",
      text: [
        "O IBO Player Pro está instalado no VIDAA pela loja oficial. Não existe um método documentado e público para uma página web abrir um app instalado, então a NEXUS não tenta abri-lo.",
        "Para abrir: aperte Home (ou o botão de apps) no controle e escolha o IBO Player Pro na lista de aplicativos.",
        "Para voltar à NEXUS depois: abra o navegador da TV e use o favorito da NEXUS."
      ]
    } },

  { key: "6", tier: "more", name: "Twitch", mono: "T", color: "#9146ff", img: "assets/img/twitch.webp",
    type: "site", url: "https://www.twitch.tv/", blurb: "Transmissões ao vivo de jogos e criadores." },
  { key: "7", tier: "more", name: "Google", mono: "G", color: "#4285f4", img: "assets/img/google.webp",
    type: "site", url: "https://www.google.com/", blurb: "Pesquisa na web." },
  { key: "8", tier: "more", name: "YouTube Music", short: "YT Music", mono: "♪", color: "#ff0033", img: "assets/img/ytmusic.webp",
    type: "site", url: "https://music.youtube.com/", blurb: "Músicas, álbuns e playlists. O site pode não aceitar o navegador da TV." },
  { key: "9", tier: "more", name: "Globoplay", mono: "g", color: "#ff5a1f", img: "assets/img/globoplay.webp",
    type: "site", url: "https://globoplay.globo.com/", service: "globoplay", blurb: "Novelas, séries e TV Globo. A reprodução depende de DRM." },
  { key: "0", tier: "more", name: "Loja VIDAA", short: "Loja VIDAA", mono: "V", color: "#6f8191", img: "assets/img/vidaa.webp",
    type: "info", blurb: "Loja oficial de apps da Hisense. Abertura direta pela NEXUS não confirmada.",
    panel: {
      title: "Loja VIDAA",
      status: "Abertura direta pela NEXUS: não confirmada",
      text: [
        "A loja oficial de aplicativos existe dentro do sistema VIDAA. Não encontramos uma versão web oficial dela nem um método documentado para uma página abri-la.",
        "Para abrir: aperte Home no controle e escolha a loja de aplicativos na tela inicial do VIDAA.",
        "Se você usa o app oficial VIDAA no iPhone, verifique se ele oferece acesso à loja ou aos apps da TV."
      ]
    } }
];

// Recomendações usadas quando não há dados do TMDB (teclas dos apps).
window.NEXUS_FALLBACK_RECS = [
  { key: "6", eyebrow: "Ao vivo agora" },
  { key: "8", eyebrow: "Para ouvir" }
];
