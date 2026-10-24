# Relatório técnico 2: como desenvolver, testar e carregar um web app próprio no VIDAA

Data da pesquisa: 2026-10-24. Continua o [relatório 1](relatorio-viabilidade-android-hisense-65A6S.md).

## 0. Novos dados coletados pelo usuário

| Item | Resultado | O que isso permite concluir |
|---|---|---|
| Firmware | V01.09.60W.Q0612 | Nenhuma fonte pública associa essa string a uma geração do VIDAA |
| User-Agent do navegador | Chrome 111 em Linux | O motor é Chromium/Blink 111 (versão de 2023). Serve de referência para as APIs que um web app pode usar |
| HTML5 Test | 529/555 | Mede só **recursos do navegador**. **Não** indica permissão para instalar apps |
| `hisense://debug` | Não reconhecido | Bate com os relatos de que esse método antigo foi desativado nos firmwares novos |

## 1. Resumo das respostas

| Pergunta | Resposta | Grau de certeza |
|---|---|---|
| 1. Existe SDK oficial? | **Não existe SDK público.** A documentação (WebApp Development Guide, portal `partner-doc.vidaa.com`) e as ferramentas (app **VIDAA DevKit**) são distribuídas a **parceiros**. O app é HTML5 comum, sem SDK proprietário obrigatório para o básico | Alta |
| 2. Dá para testar localmente ou por URL? | **Por URL, sim, de duas formas:** (a) no navegador da TV, sem permissão especial e com limitações; (b) instalado como app pelo **DevKit > App Manager** (nome + URL), o que exige um **secure code individual emitido pelo VIDAA** para aquela TV | Média/alta (fontes de integradores, o passo a passo oficial está atrás do portal) |
| 3. Há restrições por modelo, região ou firmware? | **Sim, por firmware:** `hisense://debug` só existe em firmwares antigos; o DevKit tem exigência mínima de firmware citada por integrador. **Por plataforma:** o guia oficial tem procedimentos diferentes por chipset. **Região:** não encontrei regra documentada para o DevKit; a publicação na loja é negociada por país com o VIDAA | Média |
| 4. Dá para fazer só com iPhone + nuvem? | **Parcialmente.** Dá para desenvolver, hospedar e testar o app pelo navegador da TV usando só iPhone e serviços web. A depuração remota oficial (DevTools) e o portal do DevKit pressupõem um computador e acesso de parceiro | Média |

## 2. Caminho oficial (o que o VIDAA documenta)

### 2.1 Programa de parceiros
- O VIDAA descreve este fluxo: **formulário de parceiro → aprovação → conta no Partner Portal → envio do app → testes e certificação → lançamento**.
- O VIDAA estima **2 a 6 meses** para apps HTML5 e **12 a 18 meses** para apps nativos.
- Não há portal de desenvolvedor aberto ao público. Um integrador (Muvi) afirma que "o VIDAA não oferece um portal de desenvolvedor self-service".
- Custo e contrato, segundo relatos de terceiros no GitHub do Jellyfin (não oficiais): em jul/2023, o VIDAA teria pedido **contrato e taxa anual de US$ 1.000** para dar acesso à documentação e ao portal. Em jun/2024, outro contato recebeu um **DDA (Developer Distribution Agreement) "sem custos"**. Ou seja, as condições mudam e precisam ser confirmadas diretamente com o VIDAA.

### 2.2 WebApp Development Guide (oficial, revisão 2.3.5)
- Descreve web apps **hospedados**: a TV baixa os recursos de um servidor remoto e os exibe.
- Tem um capítulo de **depuração remota (DevTools)** com procedimento **diferente por plataforma de chipset** (há revisões específicas, por exemplo "U4: devtools sem cabo serial"). Isso é a origem principal das restrições por modelo.
- Também descrevia o `hisense://debug`. Ele **não existe no seu firmware** (teste do usuário), coerente com relatos de 2024–2025.

### 2.3 VIDAA DevKit (ferramenta oficial de desenvolvimento)
Conforme descrito por integradores e empresas de QA (BlackBox QA, SmartLabs) e por um projeto de código aberto (trialuser/vidaa-appstore):
1. O DevKit é um app de desenvolvimento e depuração de web apps que **não vem visível por padrão**. Ele é habilitado digitando uma sequência numérica no campo de busca da **App Store** do VIDAA. As fontes citam sequências levemente diferentes; não reproduzo nenhuma aqui como "oficial" porque não pude conferir no documento do VIDAA.
2. Depois de habilitado, ele aparece em "Mais apps". A tela inicial mostra o **MAC address** e o **Device Code** da TV, e há uma tela de **System Info** com a versão do firmware.
3. Para **instalar** um app é preciso um **secure code individual**. O desenvolvedor envia o MAC e o Device Code ao **gerente de parceiro do VIDAA**, que devolve o código (uma das fontes cita um arquivo de chave num pendrive USB).
4. Em **App Manager** você informa nome, URL e resolução (ex.: 1080p) e instala. Também há um modo pelo computador (**DevKit Web**, em `partner-doc.vidaa.com`), pareado por um código exibido na TV.
5. **Restrição de firmware:** um integrador (SmartLabs) cita uma versão mínima de firmware, que se confere em DevKit > System Info. Não sei mapear com segurança a sua string V01.09.60W para essa nomenclatura.

**Conclusão:** o DevKit é o mecanismo oficial para carregar um web app próprio como app instalado. **Mas a etapa que autoriza a instalação (secure code) depende do VIDAA.** Sem relação de parceiro, o caminho oficial para no passo 3.

### 2.4 O que não recomendo
- **Atalhos não oficiais:** existem projetos e análises que contornam o secure code (relay do DevKit Web lido do JavaScript público, scripts que gravam entradas na lista de apps, troca de DNS para "vidaahub"). Nenhum é documentado pelo VIDAA, alguns dependem de servidores de terceiros e o comportamento muda entre firmwares. Ficam fora do escopo de "procedimento documentado e seguro".
- **Portas de depuração abertas na rede:** um projeto no GitHub relata uma interface de depuração exposta sem autenticação. É uma questão de segurança não oficial. Não deve ser usada nem testada.

## 3. Testes que dá para fazer só com iPhone e nuvem

### 3.1 Desenvolver e hospedar sem computador
- **Editar código:** GitHub pelo navegador do iPhone (editor web), ou apps de editor no iOS.
- **Hospedar por HTTPS:** GitHub Pages, Netlify ou Cloudflare Pages (todos com plano gratuito e publicação a partir de um repositório GitHub).
- **Encurtar a URL:** digitar URLs longas com o controle remoto é trabalhoso. Use um domínio curto do próprio serviço de hospedagem.

### 3.2 Testar na TV pelo navegador (sem permissão especial)
- Abra a URL no navegador da TV. Isso **não instala nada**, apenas carrega uma página.
- **O que dá para validar:** layout em 1920×1080 (tela de 10 pés), navegação por foco com as setas, desempenho de animações e vídeo, e APIs do Chromium 111.
- **Limitações esperadas** (a verificar no seu aparelho): o navegador pode capturar teclas como **Voltar**, **Home** e as teclas coloridas antes da página; a barra de endereço e a moldura do navegador ocupam espaço; não há ícone na tela inicial; pode não haver tela cheia real.

### 3.3 Depurar sem DevTools
- Os DevTools remotos oficiais pressupõem Chrome de desktop e o procedimento por chipset do guia de parceiro. Não dá para usar pelo iPhone.
- **Alternativa que é só código do seu próprio app:** uma **sobreposição de log** na própria página (mostra `console.log`, erros e o `keyCode` de cada tecla), ou envio de logs para um endpoint seu na nuvem. Isso permite mapear o controle remoto e ver erros usando só a TV e o iPhone.

### 3.4 O que exige mais que iPhone
- O acesso ao Partner Portal, ao DevKit Web e ao secure code depende da aprovação do VIDAA (conta de parceiro).
- A depuração por DevTools exige um computador com Chrome.

## 4. Próximo passo recomendado (seguro)

1. **Teste de capacidade pelo navegador (sem risco):** publicar uma página de diagnóstico mínima (GitHub Pages) que mostre na tela o `keyCode` de cada tecla do controle, o tamanho do viewport e o suporte a algumas APIs (`localStorage`, `fetch`, vídeo HLS/MP4, fullscreen). Abrir essa página no navegador da TV. Isso diz com dados quais teclas e recursos o seu app teria no navegador. Só faço essa página se você autorizar, já que você pediu para não programar a interface ainda.
2. **Em paralelo, se quiser ter o app instalado de forma oficial:** pelo formulário de parceiro do VIDAA, perguntar sobre acesso de **desenvolvedor individual ao DevKit** (secure code para uma TV) e as condições atuais (contrato/DDA, custo, se vale para o Brasil e para o seu firmware).
3. **Opcional, baixo risco:** verificar se o app DevKit pode ser habilitado no seu firmware e anotar o que a tela de System Info mostra. Habilitar o app só o deixa visível; nada é instalado sem o secure code. Só faça isso com a sequência confirmada pelo VIDAA ou pela documentação de parceiro.

## 5. Fontes

Oficiais
- VIDAA – WebApp Development Guide (rev. 2.3.5): https://www.vidaa.com/wp-content/uploads/2020/12/WebApp_Development_Guide_for_VIDAA.pdf
- VIDAA – Join as Content Partner (fluxo e prazos): https://www.vidaa.com/?p=4097
- VIDAA – Content Partners: https://www.vidaa.com/partners/
- VIDAA – DevKit Web (portal de parceiro, citado por integradores): https://partner-doc.vidaa.com/vdocs/more/devkitweb.html

Integradores / QA (secundárias)
- BlackBox QA – Installing Builds on HiSense: https://www.blackboxqa.ca/hisense-installation
- BlackBox QA – Debugging for HiSense: https://www.blackboxqa.ca/hisense-debugging
- SmartLabs – Installing SmartTUBE on Hisense TV manually: https://help.smartlabs.tv/docs/demo/apps/hisense
- Suitest – VIDAA (DevTools): https://suite.st/docs/devices/vidaa/
- Muvi – How to Create and Publish Your VIDAA App: https://help.muvi.com/help/how-to-create-and-publish-your-vidaa-app
- Microimpuls – Hisense VIDAA debug guide: https://microimpuls.com/en/docs/smarty/extra/hisense-vidaa-debug-guide

Comunidade / código aberto (menor confiabilidade)
- Jellyfin – issue #250 (contrato, taxa, DDA, hisense://debug): https://github.com/jellyfin/jellyfin-desktop/issues/250
- trialuser/vidaa-appstore: https://github.com/trialuser/vidaa-appstore
- boris-sionov/smart-tv-qa-tool PR #20 (protocolo do DevKit Web, não oficial): https://github.com/boris-sionov/smart-tv-qa-tool/pull/20

**Limitação:** a rede do ambiente bloqueou a leitura direta de vidaa.com, blackboxqa.ca, suite.st, help.muvi.com e help.smartlabs.tv. O conteúdo delas veio dos trechos indexados pelo buscador. A issue do Jellyfin e o PR do GitHub foram lidos diretamente.
