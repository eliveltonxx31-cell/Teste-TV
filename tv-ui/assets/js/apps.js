/*
 * NEXUS TV · configuração dos cartões.
 * Para trocar um app, edite só esta lista. A ordem define a posição na grade.
 *
 * key:   tecla numérica que abre o cartão ("1"–"9" e "0").
 * name:  nome exibido no cartão e na vitrine.
 * blurb: descrição curta mostrada na vitrine.
 * color: tom do cartão (#rrggbb).
 * type:  "site" abre o endereço oficial na mesma aba;
 *        "info" abre um painel de instruções dentro da NEXUS.
 * url:   endereço oficial (só para "site").
 * panel: conteúdo do painel (só para "info").
 *
 * Abrir o site oficial não garante reprodução de vídeo, DRM ou funcionamento
 * completo no navegador da TV.
 */
window.NEXUS_APPS = [
  { key: "1", name: "YouTube", color: "#ff3b30", type: "site", url: "https://www.youtube.com/",
    blurb: "Vídeos, canais e transmissões ao vivo." },
  { key: "2", name: "Netflix", color: "#e50914", type: "site", url: "https://www.netflix.com/",
    blurb: "Séries e filmes. A reprodução no navegador da TV depende de DRM." },
  { key: "3", name: "Prime Video", color: "#1a98ff", type: "site", url: "https://www.primevideo.com/",
    blurb: "Filmes e séries da Amazon. A reprodução depende de DRM." },
  { key: "4", name: "Spotify", color: "#1ed760", type: "site", url: "https://open.spotify.com/",
    blurb: "Músicas e podcasts pelo player web." },
  { key: "5", name: "IBO Player Pro", color: "#8e8e93", type: "info",
    blurb: "App instalado no VIDAA. Mostra como abrir; a abertura direta não está confirmada.",
    panel: {
      title: "IBO Player Pro",
      status: "Abertura direta pela NEXUS: não confirmada",
      text: [
        "O IBO Player Pro está instalado no VIDAA pela loja oficial. Não existe um método documentado e público para uma página web abrir um app instalado, então a NEXUS não tenta abri-lo.",
        "Para abrir: aperte Home (ou o botão de apps) no controle e escolha o IBO Player Pro na lista de aplicativos.",
        "Para voltar à NEXUS depois: abra o navegador da TV e use o favorito da NEXUS."
      ]
    } },
  { key: "6", name: "Twitch", color: "#9146ff", type: "site", url: "https://www.twitch.tv/",
    blurb: "Transmissões ao vivo de jogos e criadores." },
  { key: "7", name: "Google", color: "#4285f4", type: "site", url: "https://www.google.com/",
    blurb: "Pesquisa na web." },
  { key: "8", name: "YouTube Music", color: "#ff0033", type: "site", url: "https://music.youtube.com/",
    blurb: "Músicas, álbuns e playlists. O site pode não aceitar o navegador da TV." },
  { key: "9", name: "Globoplay", color: "#ff6a3d", type: "site", url: "https://globoplay.globo.com/",
    blurb: "Novelas, séries e TV Globo. A reprodução depende de DRM." },
  { key: "0", name: "Loja VIDAA", color: "#8e8e93", type: "info",
    blurb: "Loja oficial de apps da Hisense. Mostra como abrir; a abertura direta não está confirmada.",
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
