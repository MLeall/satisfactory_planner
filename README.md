# FICSIT Factory Planner

Planejador de cadeia de produção para o jogo [Satisfactory](https://www.satisfactorygame.com/) (dados da versão 1.0). Aplicação client-side (sem backend): você declara os nós de recurso que possui e os itens que quer produzir, e o app calcula a cadeia inteira balanceada, do minério até o armazenamento.

Para cada estágio ele resolve quantas máquinas construir, o clock da máquina parcial (underclock ou overclock), o consumo de energia, o tier e a quantidade de esteiras/canos de cada trecho, e os subprodutos excedentes.

## Como funciona

O planejador é **target-driven**: você informa a taxa de saída desejada e ele dimensiona toda a fábrica para atingi-la, reportando máquinas, energia, extratores e recursos brutos necessários. Os nós declarados (com pureza e quantidade) definem a capacidade disponível; se a taxa pedida exceder o que os nós sustentam, o app aponta o recurso que falta e o quanto.

Deixando **todas as taxas em branco** ele cai no modo **supply-driven**: calcula o máximo que os nós sustentam, identificando o recurso mais escasso (menor razão entre oferta e demanda) como limitante. Com vários outputs em branco, o planejador **balanceia** entre eles: cada output é pesado pelo quanto produziria sozinho com os nós declarados, e todos são escalados pelo mesmo fator até o recurso mais apertado acabar. Assim cada output recebe a mesma fração do seu potencial individual, e outputs que não disputam recurso nenhum saem ambos no máximo.

Fluxo de uso:

1. Adicione nós de recurso (tipo, pureza, quantidade).
2. Escolha os tiers de logística. O miner é o que você vai construir; a esteira e o cano são a **melhor que você já desbloqueou**, e funcionam como teto (veja *Tier de transporte por trecho*).
3. Adicione um ou mais itens de saída, cada um com sua taxa (só aparecem itens produzíveis a partir dos seus nós). Deixe todas as taxas em branco para o máximo sustentável, balanceado entre os outputs. Misturar taxa preenchida com taxa em branco é erro: ou você dita todas, ou deixa o planejador dimensionar todas.
4. Opcionalmente, troque receitas padrão por alternadas; a cadeia rebalanceia na hora.
5. Opcionalmente, escolha quantos Power Shards cada máquina leva.
6. Veja o esquema visual e o detalhamento por estágio.

Todas as informações ficam salvas no `localStorage` do navegador entre sessões; o botão **Clear all** zera tudo. O botão **Share** copia um link que reconstrói o plano inteiro (nós, taxas, receitas, modo e o arranjo do floor plan) na máquina de quem abrir.

## Funcionalidades

- **Múltiplos outputs**: cada item de saída ganha seu próprio Storage Container. Intermediários compartilhados (ex.: um ingot que alimenta placas e parafusos ao mesmo tempo) são produzidos uma vez só e divididos, refletido tanto no floor plan quanto no breakdown.
- **Modo de construção Exact ou Whole machines**: em *Exact* cada estágio underclocka sua última máquina, então a cadeia produz exatamente a demanda e só subprodutos sobram. Em *Whole machines* não há underclock em lugar nenhum: máquinas de produção e extratores são arredondados para cima e rodam todos no clock cheio, como fábricas costumam ser construídas de fato. Cada estágio passa a sobreproduzir, a mineradora engatada entrega a taxa cheia do nó, e todo esse excesso é o overflow. Apenas os extratores necessários são construídos; nós sobrando ficam intocados. No modo target-driven o storage continua recebendo a taxa pedida e o excedente vai para o overflow; no modo supply-driven o excedente do estágio final vai para o storage, já que ali você pediu o máximo.
- **Overclocking com Power Shards**: 0 a 3 shards por máquina, liberando clock de 100% a 250%. Cada estágio passa a caber em menos máquinas e cada mineradora puxa mais do nó, nunca além do que a esteira carrega (overclockar acima do teto da esteira só gastaria energia). O consumo sobe com `clock^1.32`, e o breakdown mostra quantos shards o plano inteiro precisa.
- **AWESOME Sink junto da máquina que transborda**: em *Whole machines* o overflow **sólido** é sempre roteado para AWESOME Sinks, que eliminam o excedente e somam os pontos de cupom por minuto. Não é um toggle separado: overflow e sink andam juntos, já que sobreproduzir sem destino não faz sentido. Cada sink é posicionado uma coluna adiante do estágio que ele drena, e não no fim do esquemático, então a esteira até ele atravessa só o vão vazio entre colunas em vez de cruzar a fábrica inteira. Fluidos não são sinkáveis (restrição do jogo) e continuam reportados como surplus. Em *Exact* não há o que sinkar além de subproduto, então eles ficam como surplus.
- **Tier de transporte por trecho**: o seletor de esteira e cano significa a melhor que você desbloqueou, e serve de teto para duas coisas: quantas linhas paralelas cada trecho precisa e quanto uma mineradora pode entregar. Dentro desse teto, **cada trecho recebe o tier mais barato que dá conta da sua própria taxa**. Um plano com teto Mk.5 rotula um trecho de 90/min como Mk.2 e um de 150/min como Mk.3, em vez de mandar você construir Mk.5 em toda a fábrica. Quando a taxa exige mais de uma linha, o tier é escolhido pela carga de **uma** linha, não pelo total.
- **Compartilhamento sem backend**: o estado inteiro do console é serializado no *fragmento* da URL (nunca na query, então nada trafega até um servidor). Ao abrir um link compartilhado ele vence o que estiver salvo localmente, e o fragmento é consumido em seguida, para não ficar um link visível que envelhece a cada edição. Fragmento inválido ou adulterado cai silenciosamente no plano salvo.
- **Zoom, pan e fullscreen** no floor plan: roda do mouse amplia sob o cursor, arrastar o fundo movimenta, e há um *fit* que reenquadra. Quando a Fullscreen API é negada (sem gesto de usuário, iframe sem permissão), cai num modo que cobre a página via CSS, então o botão nunca fica morto.
- **Reposicionamento manual por drag and drop**: arraste qualquer máquina, Splitter ou Merger, e as esteiras acompanham. Arrastar uma máquina leva junto as junções que a servem; arrastar uma junção move só ela, sem empurrar o resto da árvore. As posições são guardadas por caixa, não por plano: mexer só nas taxas de saída preserva todo o arranjo, enquanto trocar a cadeia descarta apenas as caixas que deixaram de existir. O botão ↺ desfaz o arranjo.
- **Leitura do fluxo**: toda esteira é tracejada e animada no sentido em que corre, com setas fixas ao longo do caminho, então a direção continua legível com a animação desligada.
- **Duas visões do floor plan**:
  - *Standard*: compacta, máquinas agrupadas por estágio com a contagem.
  - *Complex*: cada máquina desenhada individualmente, ligada por Splitters e Mergers de verdade (veja abaixo).

## Splitters e Mergers

Na visão *Complex* as junções seguem a regra do jogo, e não uma caixa genérica de N saídas:

- Um **Splitter** é um quadrado com uma entrada e até três saídas, dividindo igualmente entre as saídas ligadas.
- Um **Merger** é o mesmo quadrado espelhado: até três entradas e **uma** saída.

Como nenhum dos dois tem versão de N vias, alimentar N máquinas a partir de um trecho exige vários deles. E como uma máquina tem uma única esteira de saída, um estágio é mergeado uma vez só, por mais estágios que ele alimente; quem divide esse tronco entre os destinos é um Splitter, nunca o Merger.

Há dois jeitos de armar essa fiação, escolhidos por um toggle na visão *Complex*:

- **Tree** (árvore): monta uma árvore de junções de 2 e 3 vias. Entre um ramo de 2 e um de 3, escolhe o que deixa as máquinas menos desigualmente alimentadas e, no empate, o que custa menos quadrados (dividir 6 como `[3,3]` são três Splitters, como `[2,2,2]` seriam quatro). Quando o número de máquinas fatora em 2 e 3, cada perna recebe exatamente `1/n` do trecho, de forma perfeitamente igual.
- **Manifold**: o barramento que a maioria constrói. Um único trecho corre ao lado da coluna de máquinas e cada junção 2-via sangra uma máquina e repassa o resto, então um estágio de N máquinas usa N-1 junções de cada lado. Menos quadrados que a árvore, e a divisão igual não é garantida no papel.

**Números que não fecham.** Numa árvore de Splitters cada perna recebe `1/(2^a·3^b)` do trecho, então a divisão só é exata quando o número de máquinas fatora em 2 e 3. Para 5, 7, 10, 11 e afins as pernas saem desiguais em qualquer um dos modos, e a fiação fica assim mesmo: quem acerta as taxas é o clock das máquinas mais a contrapressão das máquinas cheias, não um arranjo extra de quadrados. É como se joga na prática.

## Arquitetura

Separação em camadas, com toda a lógica de domínio pura e testável de forma headless:

- **`src/data`**: `data1.0.json` (dump do jogo, via [greeny/SatisfactoryTools](https://github.com/greeny/SatisfactoryTools), mesma origem da [wiki.gg](https://satisfactory.wiki.gg/)) e `loader.ts`, que transforma o JSON bruto no modelo de domínio.
- **`src/engine`**: o núcleo. `solve.ts` monta o fecho de receitas a partir dos alvos (com detecção de ciclo), propaga a demanda até os recursos raw, dimensiona pela oferta e gera estágios, trechos de transporte (com o tier de cada um) e sinks. `helpers.ts` descobre os itens produzíveis e os pontos de troca de receita. `types.ts` guarda o modelo e as constantes verificadas (velocidades de esteira/cano, taxa do Water Extractor).
- **`src/components`**: `Schematic.tsx` desenha o diagrama SVG nos modos Standard e Complex (ambos partem da mesma função `grid`, que ordena cada coluna pelo baricentro de quem a alimenta) e monta a fiação de junções da visão Complex; `SchematicViewport.tsx` envolve o diagrama com zoom, pan e fullscreen; `Console.tsx` é o painel lateral; `Breakdown.tsx` monta o resumo e a tabela por estágio.
- **`src/ui`**: lógica de apresentação pura e testável de forma headless. `junctions.ts` (árvores de Splitter/Merger), `viewport.ts` (matemática de pan/zoom), `manualLayout.ts` (posições arrastadas e sua poda), `plannerState.ts` (o estado do console e sua hidratação a partir do salvo ou do link), `usePlanner.ts` (o estado em si, a persistência e as duas resoluções do plano) e `share.ts` (serialização do plano para a URL).

Todas as taxas são por minuto; fluidos em m³. Valores de máquinas, potências, taxas de mineração, esteiras e canos são verificados contra a [wiki.gg](https://satisfactory.wiki.gg/) por testes em `loader.test.ts` e `solve.test.ts`.

A fiação da visão Complex é verificada por invariantes, e não só por render sem exceção: todo Merger tem exatamente uma saída e no máximo três entradas, todo Splitter o inverso, nenhuma esteira atravessa um quadrado para chegar na face oposta, e toda esteira corre para frente, da coluna que produz para a que consome.

## Escopo

Exclusões deliberadas (não são bugs):

- Nitrogen Gas fora dos recursos de nó (exige Resource Well Pressurizer, mecânica diferente).
- Subprodutos viram excedente reportado, nunca são reciclados de volta na cadeia.
- Receitas `Unpackage` nunca são escolhidas por padrão (evita ciclos como Fuel → Packaged Fuel → Fuel).
- Receitas de Converter que produzem minério são ignoradas (recurso raw é sempre extraído).
- Potência de receitas com power variável usa a média entre min e max.
- A fiação mostra por onde o material passa, não garante taxa idêntica em cada perna. Splitter divide igual entre as saídas ligadas, então contagens que não fatoram em 2 e 3 (5, 7, 10…) saem desiguais no papel; no jogo o clock e a contrapressão resolvem, e nenhum load balancer com esteira de retorno é desenhado.

## Stack

Vite · React 19 · TypeScript · Vitest · Oxlint

## Scripts

```bash
npm install      # instala dependências
npm run dev      # servidor de desenvolvimento
npm test         # roda os testes (Vitest)
npm run build    # type-check e build de produção
npm run lint     # Oxlint
```
