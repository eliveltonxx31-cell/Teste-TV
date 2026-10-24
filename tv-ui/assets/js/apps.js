/*
 * NEXUS TV · configuração dos cartões.
 * Para trocar um app, edite só esta lista. A ordem define a posição na fileira.
 *
 * key:   tecla numérica que abre o cartão ("1"–"9" e "0"); vazio = sem tecla.
 * name:  nome exibido.
 * mono:  monograma do cartão compacto (1 a 3 caracteres).
 * color: cor do monograma (#rrggbb).
 * img:   arte do destaque (paisagem original, local, em WebP).
 * blurb: descrição curta mostrada no destaque.
 * type:  "site" abre o endereço oficial na mesma aba;
 *        "link" abre uma página da própria NEXUS;
 *        "info" abre um painel de instruções dentro da NEXUS.
 * url:   endereço (para "site" e "link").
 * panel: conteúdo do painel (só para "info").
 *
 * Abrir o site oficial não garante reprodução de vídeo, DRM ou funcionamento
 * completo no navegador da TV.
 */
window.NEXUS_APPS = [
  { key: "1", name: "YouTube", mono: "YT", color: "#ff0000", img: "assets/img/youtube.webp",
    type: "site", url: "https://www.youtube.com/",
    blurb: "Vídeos, canais e transmissões ao vivo." },
  { key: "2", name: "Netflix", mono: "N", color: "#e50914", img: "assets/img/netflix.webp",
    type: "site", url: "https://www.netflix.com/",
    blurb: "Séries e filmes. A reprodução no navegador da TV depende de DRM." },
  { key: "3", name: "Prime Video", mono: "PV", color: "#1a98ff", img: "assets/img/prime.webp",
    type: "site", url: "https://www.primevideo.com/",
    blurb: "Filmes e séries da Amazon. A reprodução depende de DRM." },
  { key: "4", name: "Spotify", mono: "S", color: "#1db954", img: "assets/img/spotify.webp",
    type: "site", url: "https://open.spotify.com/",
    blurb: "Músicas e podcasts pelo player web." },
  { key: "5", name: "IBO Player Pro", mono: "IBO", color: "#5b6b7c", img: "assets/img/ibo.webp",
    type: "info",
    blurb: "App instalado no VIDAA. Veja como abrir; a abertura direta não está confirmada.",
    panel: {
      title: "IBO Player Pro",
      status: "Abertura direta pela NEXUS: não confirmada",
      text: [
        "O IBO Player Pro está instalado no VIDAA pela loja oficial. Não existe um método documentado e público para uma página web abrir um app instalado, então a NEXUS não tenta abri-lo.",
        "Para abrir: aperte Home (ou o botão de apps) no controle e escolha o IBO Player Pro na lista de aplicativos.",
        "Para voltar à NEXUS depois: abra o navegador da TV e use o favorito da NEXUS."
      ]
    } },
  { key: "6", name: "Twitch", mono: "T", color: "#9146ff", img: "assets/img/twitch.webp",
    type: "site", url: "https://www.twitch.tv/",
    blurb: "Transmissões ao vivo de jogos e criadores." },
  { key: "7", name: "Google", mono: "G", color: "#4285f4", img: "assets/img/google.webp",
    type: "site", url: "https://www.google.com/",
    blurb: "Pesquisa na web." },
  { key: "8", name: "YouTube Music", mono: "♪", color: "#ff0033", img: "assets/img/ytmusic.webp",
    type: "site", url: "https://music.youtube.com/",
    blurb: "Músicas, álbuns e playlists. O site pode não aceitar o navegador da TV." },
  { key: "9", name: "Globoplay", mono: "g", color: "#ff5a1f", img: "assets/img/globoplay.webp",
    type: "site", url: "https://globoplay.globo.com/",
    blurb: "Novelas, séries e TV Globo. A reprodução depende de DRM." },
  { key: "0", name: "Loja VIDAA", mono: "V", color: "#6f8191", img: "assets/img/vidaa.webp",
    type: "info",
    blurb: "Loja oficial de apps da Hisense. Veja como abrir; a abertura direta não está confirmada.",
    panel: {
      title: "Loja VIDAA",
      status: "Abertura direta pela NEXUS: não confirmada",
      text: [
        "A loja oficial de aplicativos existe dentro do sistema VIDAA. Não encontramos uma versão web oficial dela nem um método documentado para uma página abri-la.",
        "Para abrir: aperte Home no controle e escolha a loja de aplicativos na tela inicial do VIDAA.",
        "Se você usa o app oficial VIDAA no iPhone, verifique se ele oferece acesso à loja ou aos apps da TV."
      ]
    } },
  { key: "", name: "Diagnóstico", mono: "⚙", color: "#6e6e73", img: "assets/img/diag.webp",
    type: "link", url: "diag/",
    blurb: "Testes do navegador, da tela e do controle remoto." }
];

/*
 * Recomendações ao lado do destaque. "app" é a tecla do app de destino.
 * São atalhos para os sites oficiais, sem títulos de conteúdo inventados.
 */
window.NEXUS_RECS = [
  { app: "6", eyebrow: "Ao vivo agora", text: "Transmissões de jogos e criadores na Twitch." },
  { app: "8", eyebrow: "Para ouvir", text: "Álbuns e playlists no YouTube Music." }
];
