# Relatório técnico: viabilidade de Android na Hisense 65A6S (VIDAA)

Data da pesquisa: 2026-10-24. Fase: só investigação, nenhuma alteração no aparelho.

## 0. Identificação do aparelho (dados fornecidos pelo usuário)

| Campo | Valor |
|---|---|
| Modelo | Hisense 65A6S |
| Sistema | VIDAA |
| Software | V01.09.60W.Q0612 |
| Versão estendida | X0002.WO1.Y01.J01 |
| RC Version | ERF2W38V1.01 |

Nenhuma fonte pública que encontrei cita essas strings de versão, então não consigo associá-las a um SoC, a uma geração do VIDAA (U7, U8, U9…) ou a uma data de build. Interpretar os campos (por exemplo, "Q0612" como data) seria palpite, por isso não faço isso aqui.

## 1. Resumo executivo

- **Rodar Android nativamente nesta TV não é viável com o que se sabe publicamente.** O VIDAA é um sistema próprio da Hisense, baseado em Linux, que roda apps HTML5 (e alguns nativos de parceiros). Não existe camada de compatibilidade com Android nem Google Play. Não há nenhum port de Android, root ou desbloqueio de bootloader documentado para a 65A6S.
- **O caminho oficial para software de terceiros** é publicar um web app (HTML5) pelo Partner Portal do VIDAA, mediante aprovação comercial.
- **Já existiu um modo de depuração documentado** (`hisense://debug` no navegador da TV) para carregar web apps pela URL. Relatos de 2025 dizem que ele não funciona mais nos firmwares mais novos.
- **O caminho realista para ter Play Store na mesma tela** é um dispositivo Google TV/Android TV externo ligado por HDMI (com HDMI-CEC para usar um controle só). É reversível e não mexe no firmware.

## 2. Hardware: o que é fato e o que é hipótese

| Item | Situação | Evidência |
|---|---|---|
| Painel 65" 4K, VA, 8 bits + FRC | **Confirmado** (ficha oficial Hisense Espanha) | Ficha Técnica A6S ES |
| Wi-Fi, Bluetooth, 3× HDMI 2.1, 2× USB, LAN, AirPlay 2 | **Confirmado por varejistas europeus**; pode variar por região | PCBox, Unieuro, Yeppon |
| Versão do sistema: VIDAA U9.5 / "HomeOS U9.5" | **Provável** para a A6S europeia de 2026; não confirmado para a unidade brasileira | Yeppon (U9.5), ficha ES (HomeOS U9.5, leitura parcial) |
| **SoC / CPU** | **Não confirmado.** Nenhuma fonte cita o chip da 65A6S | — |
| CPU ARM Cortex-A53 quad-core | **Hipótese.** Só aparece para modelos irmãos (65A6K, 65A6Q), num catálogo não oficial | Kitele |
| Fabricante MediaTek | **Hipótese plausível.** Outros modelos Hisense usam MediaTek (U7N: MT9618; U8G: MT5895) e o guia de WebApp do VIDAA cita a plataforma "MT9602". Nada disso prova o chip da A6S | What Hi-Fi, XDA, guia VIDAA |
| RAM / armazenamento | **Desconhecido** | — |
| Bootloader / secure boot | **Desconhecido para este modelo.** Indício indireto: em outra Hisense VIDAA (U8G/MT5895), um usuário relata pacote de firmware criptografado com chaves não públicas e nenhum acesso ao boot.img | XDA |

**Observação:** há fontes conflitantes sobre o sistema da "65A6S". Um catálogo lista Google TV, e o nome A6 também é usado em modelos Google TV de outras regiões (ex.: 65A6N). A sua unidade é VIDAA, então dados de variantes Google TV **não se aplicam** a ela.

## 3. Plataforma VIDAA: possibilidades oficiais

1. **Apps de parceiros (oficial).** O VIDAA aceita parceiros de conteúdo: formulário, aprovação, conta no Partner Portal, envio e certificação. A grande maioria dos apps é HTML5. O VIDAA estima de 2 a 6 meses para uma integração HTML5. É um processo comercial, não um "modo desenvolvedor" para o usuário final.
2. **Guia oficial de WebApp (revisão 2.3.5).** Descreve web apps hospedados (os recursos vêm de um servidor remoto), depuração remota e DRM. O guia lista versões do "webengine" por plataforma, mas, pelos trechos que consegui ler, não diz qual é o motor.
3. **Modo de depuração `hisense://debug`.** Documentado pelo próprio VIDAA e por integradores (Microimpuls): no navegador da TV, abre um formulário com nome do app, URL e ícone, e instala um atalho para um web app. **Limitação:** relatos de 2025 (fórum Jellyfin) dizem que ele não funciona em modelos e firmwares mais novos.
4. **Apps nativos:** uma fonte secundária diz que o VIDAA também aceita executáveis Linux nativos, mas só pela via de parceiros. Não há SDK público.
5. **APK Android:** **não é suportado.** Não existe Play Store no VIDAA. Guias que dizem o contrário geralmente tratam de modelos Hisense com Android ou Google TV.

## 4. Métodos não oficiais conhecidos (apenas registro, não recomendados agora)

| Método | O que faz | Situação | Risco |
|---|---|---|---|
| Vidaa-Edge (weinzii/vidaa-edge) | Instala PWAs (ex.: Jellyfin) em VIDAA novo | Experimental. Um usuário relata que deixou de funcionar no VIDAA OS 9; outro só conseguiu depois de fazer **downgrade** de firmware | Médio/alto (downgrade não é suportado) |
| camellan/vidaa-appstore | Loja alternativa de web apps | Citado em fórum, não verificado | Desconhecido |
| Apontar o DNS da TV para servidor de terceiros (ex.: "vidaahub") | Redireciona domínios para carregar web apps | Relatos mistos | **Alto para privacidade:** todo o tráfego DNS da TV passa a depender de um operador desconhecido |

**Importante:** todos esses métodos, mesmo quando funcionam, só carregam **web apps (HTML/JS)**. Nenhum roda APKs nem dá acesso à Play Store, e por isso nenhum atende ao objetivo final.

Não encontrei, para este modelo ou plataforma, nenhum método documentado de execução de código nativo, root, shell, acesso por UART ou desbloqueio de bootloader. Não listo vulnerabilidades porque não há evidência pública específica.

## 5. Integrações locais documentadas (código aberto)

- As TVs Hisense/VIDAA expõem um **broker MQTT na porta 36669**, usado pelo app de controle remoto. Projetos como `warrenrees/myhisense-tv` (pyvidaa), `warrenrees/ha_vidaatv` e `sehaas/ha_hisense_tv` usam esse broker para ligar e desligar, mudar volume, trocar entrada e abrir apps.
- Nos firmwares recentes, a conexão exige **TLS mútuo com certificado de cliente** e pareamento por PIN. Isso permite **controlar** a TV, mas não executar código nela.

## 6. Testes seguros que dá para fazer só com o iPhone

Todos são apenas leitura e não mudam nada no sistema.

1. **Inventário pelo menu da TV:** em Configurações > Suporte/Sistema > Informações do sistema, anote a versão do VIDAA (U-x.x), o número de série e a versão do chassi ou da placa, se aparecer. Tire fotos com o iPhone.
2. **Identificar o motor do navegador:** abra o navegador da TV, acesse um site que mostra o *User-Agent* (ex.: whatismybrowser.com) e fotografe a tela. O User-Agent costuma mostrar o motor (Chromium/WebKit), a versão e às vezes a plataforma.
3. **Capacidades HTML5:** no mesmo navegador, rode um teste de recursos (ex.: html5test.co) para ver suporte a codecs, WebGL, Service Workers/PWA etc. Isso é o que define o que um web app poderia fazer.
4. **Recursos oficiais de conexão com o iPhone:** teste o **AirPlay 2** (espelhamento ou vídeo pela Central de Controle) e o app oficial da Hisense (**RemoteNOW / VIDAA**) para controle e envio de mídia.
5. **Descoberta de rede (passiva/local):** com um app como Fing no iPhone, identifique o IP da TV e os serviços anunciados (AirPlay, DLNA/UPnP). Não tente autenticar nem forçar acesso a esses serviços.
6. **Verificar se `hisense://debug` existe no seu firmware (opcional, baixo risco):** digitar o endereço no navegador só mostra se o formulário oficial de depuração abre. **Não** instale nenhuma URL de terceiros por ele agora. Se o formulário não abrir, isso confirma que o seu firmware segue o comportamento dos modelos novos.

O que **não** fazer nesta fase: trocar o DNS para servidores de terceiros, fazer downgrade ou instalar firmware por USB, abrir a TV ou usar o menu de serviço/fábrica.

## 7. Conclusão e próximo passo recomendado

**Viabilidade do objetivo final (Android + Play Store na própria TV): muito baixa.** Seria preciso, ao mesmo tempo: (a) quebrar uma cadeia de boot provavelmente assinada e criptografada, (b) ter drivers Android para um SoC ainda não identificado e (c) cumprir a certificação do Google para a Play Store, que um port não oficial não conseguiria. Não há nenhum precedente público para esse modelo.

**Alternativa recomendada, que atende ao objetivo sem risco:** um dispositivo Google TV/Android TV externo (ex.: Google TV Streamer, Chromecast com Google TV, Xiaomi TV Box, Nvidia Shield) em uma das portas HDMI 2.1, com HDMI-CEC ligado (na Hisense costuma aparecer como "CEC" em Configurações > Dispositivos/Conexões). Assim você tem a Play Store oficial, atualizações de segurança e nenhum impacto na garantia.

**Próximo passo mais seguro e útil:** executar os testes 1 e 2 da seção 6 e trazer as fotos (informações do sistema e User-Agent). Com isso dá para confirmar a geração do VIDAA e o motor web, e decidir com base em dados entre:
- seguir só com o dispositivo HDMI externo, ou
- explorar web apps (HTML5) próprios na TV, pelo caminho oficial ou pelo modo de depuração, se ele existir no seu firmware.

## 8. Fontes consultadas

Oficiais / fabricante
- VIDAA – WebApp Development Guide (rev. 2.3.5): https://www.vidaa.com/wp-content/uploads/2020/12/WebApp_Development_Guide_for_VIDAA.pdf
- VIDAA – Content Partners: https://www.vidaa.com/partners/
- VIDAA – Join as Content Partner: https://www.vidaa.com/?p=4097
- Hisense Espanha – Ficha técnica A6S: https://www.hisense.es/wp-content/uploads/2026/03/Ficha-Tecnica-Hisense-TV-A6S-ES.pdf
- Hisense África do Sul – VIDAA / RemoteNOW: https://hisense.co.za/technology/vidaa/
- Hisense EUA – suporte A6 VIDAA (65A6KV): https://www.hisense-usa.com/support/televisions-65-a6-series-uhd-vidaa-tv-65a6kv

Integradores / documentação técnica de terceiros
- Microimpuls – Hisense VIDAA debug guide: https://microimpuls.com/en/docs/smarty/extra/hisense-vidaa-debug-guide
- Enveu – What is VIDAA OS: https://www.enveu.com/blog/what-is-vidaa-os
- Spyrosoft – What is VIDAA OS: https://spyro-soft.com/blog/media-and-entertainment/what-is-vidaa-os-a-comprehensive-guide-to-your-smart-tv-experience

Código aberto
- warrenrees/myhisense-tv: https://github.com/warrenrees/myhisense-tv
- warrenrees/ha_vidaatv: https://github.com/warrenrees/ha_vidaatv
- sehaas/ha_hisense_tv: https://github.com/sehaas/ha_hisense_tv
- tiagofreire-pt/Home_Assistant_Hisense_TV: https://github.com/tiagofreire-pt/Home_Assistant_Hisense_TV
- weinzii/vidaa-edge (citado em fórum): https://github.com/weinzii/vidaa-edge

Relatos da comunidade (menor confiabilidade)
- Fórum Jellyfin – instalar em VIDAA: https://forum.jellyfin.org/t-install-jellyfin-on-vidaaos-based-tv-hisense-sharp-toshiba-etc?page=4
- XDA – Hisense U8G root (MT5895): https://forum.xda-developers.com/t/q-hisense-u8g-root-mt5895.4465983/
- AnExplorer – Hisense VIDAA x Google TV: https://anexplorer.io/device/tv/hisense-tv
- What Hi-Fi – review U7N (MT9618): https://www.whathifi.com/reviews/hisense-u7n-65u7n

Varejistas (especificações)
- Yeppon (VIDAA U9.5): https://www.yeppon.it/products/tv-led-hisense-65a6s-1336612
- PCBox: https://www.pcbox.com/65a6s-televisor-led-hisense-65a6s-smart-tv-65--4k/p
- Unieuro: https://www.unieuro.it/online/TV-Ultra-HD/Smart-TV-65-4K-TV-65A6S-60Hz-DTS-Virtual-X-VIDAA-OS-con-1000-APP-HDR-10-Game-Mode-Plus-Bluetooth-Wifi-Alexa-Built-in-AirPlay2-lativ-4K-pidHIS65A6S
- Kitele (catálogo, dados de modelos irmãos): https://www.kitele.com/pt/tv-hisense-65a6s

**Limitação desta pesquisa:** a rede do ambiente bloqueou o acesso direto a vidaa.com, hisense.es e forum.jellyfin.org. O conteúdo dessas fontes veio dos trechos indexados pelo buscador, não da leitura completa dos documentos.
