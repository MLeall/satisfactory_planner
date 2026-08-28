# FICSIT Factory Planner

Planejador de cadeia de produção para o jogo [Satisfactory](https://www.satisfactorygame.com/) (dados da versão 1.0). Aplicação client-side (sem backend): você declara os nós de recurso que possui, as peças que importa de fábricas já construídas, e os itens que quer produzir; o app calcula a cadeia inteira balanceada, do minério (ou da esteira que chega) até o armazenamento.

Não é uma fábrica só: o console guarda uma **biblioteca de fábricas**, e uma pode importar o que a outra produz — o que faz uma mudança lá em cima chegar na hora em tudo que compra dela.

Para cada estágio ele resolve quantas máquinas construir, o clock da máquina parcial (underclock ou overclock), o consumo de energia, o tier e a quantidade de esteiras/canos de cada trecho, e os subprodutos excedentes.

## Como funciona

O planejador é **target-driven**: você informa a taxa de saída desejada e ele dimensiona toda a fábrica para atingi-la, reportando máquinas, energia, extratores e recursos brutos necessários. Os nós declarados (com pureza e quantidade) definem a capacidade disponível; se a taxa pedida exceder o que os nós sustentam, o app aponta o recurso que falta e o quanto.

Deixando **todas as taxas em branco** ele cai no modo **supply-driven**: calcula o máximo que os nós sustentam, identificando o recurso mais escasso (menor razão entre oferta e demanda) como limitante. Com vários outputs em branco, o planejador **balanceia** entre eles: cada output é pesado pelo quanto produziria sozinho com os nós declarados, e todos são escalados pelo mesmo fator até o recurso mais apertado acabar. Assim cada output recebe a mesma fração do seu potencial individual, e outputs que não disputam recurso nenhum saem ambos no máximo.

Fluxo de uso:

1. Adicione nós de recurso (tipo, pureza, quantidade).
2. Opcionalmente, declare **inputs importados**: peças que chegam por esteira. Ou você digita a taxa, ou aponta a linha para outra fábrica sua e ela passa a valer o que aquela fábrica produz.
3. Escolha os tiers de logística. O miner é o que você vai construir; a esteira e o cano são a **melhor que você já desbloqueou**, e funcionam como teto (veja *Tier de transporte por trecho*).
4. Adicione um ou mais itens de saída, cada um com sua taxa (só aparecem itens produzíveis a partir dos seus nós e imports). Deixe todas as taxas em branco para o máximo sustentável, balanceado entre os outputs. Misturar taxa preenchida com taxa em branco é erro: ou você dita todas, ou deixa o planejador dimensionar todas.
5. Opcionalmente, troque receitas padrão por alternadas — na mão, ou deixando o botão **Find the best alternates** procurar a melhor combinação. A cadeia rebalanceia na hora.
6. Opcionalmente, escolha quantos Power Shards cada máquina leva.
7. Veja o esquema visual e o detalhamento por estágio.

Todas as informações ficam salvas no `localStorage` do navegador entre sessões; o botão **Clear all** zera tudo. O botão **Share** copia um link que reconstrói a **biblioteca inteira** (todas as fábricas, com nós, taxas, receitas, modo, imports e o arranjo do floor plan de cada uma) na máquina de quem abrir — a fábrica aberta não seria reproduzível sem aquelas de que ela compra. Um plano salvo por uma versão anterior, de quando só existia uma fábrica, é adotado como a primeira fábrica da biblioteca em vez de ser descartado.

## Funcionalidades

- **Múltiplas fábricas**: cada fábrica é um plano com nome próprio, e você alterna entre elas por um seletor. Uma linha de import pode apontar para outra fábrica sua em vez de carregar uma taxa digitada: a taxa passa a ser o que aquela fábrica de fato produz, e acompanha sozinha quando você mexe nela. As fábricas são resolvidas em profundidade, já que a saída de uma depende do que ela importa; um ciclo (A alimenta B alimenta A) é cortado tratando a volta como entrega zero, então um erro de fiação aparece como falta no plano em vez de travar a página. Apagar uma fábrica não deixa ponteiro solto: quem importava dela fica com a última taxa entregue, agora como import digitado à mão. Duas fábricas puxando a mesma saída de uma terceira são cada uma planejada como se tivessem tudo — o app avisa, porque nem a esteira nem o solver têm como avisar.
- **Inputs importados**: em vez de sempre começar da mineradora, você declara que uma peça já vem pronta de outra fábrica, com a taxa por minuto que aquela fábrica consegue mandar. **A taxa é um teto, não uma promessa**: o plano puxa o que precisa até ali e constrói só a diferença. Importar 30/min de um ingot que a cadeia consome a 90/min deixa as máquinas dimensionadas para os 60 que faltam, e o item chega no consumidor por *duas* esteiras — uma do import, outra da produção local, divididas na proporção em que cada fonte o abastece, que é o que juntar as duas linhas faz no jogo. Suba o import e as máquinas encolhem; suba o bastante e elas somem do plano junto com tudo que estava acima delas. Deixando a taxa em branco o import vira ilimitado — "puxe o que precisar" — e aí não sobra nada para construir, então ele nunca pode ser o recurso limitante. Um import de um minério **soma** ao nó que você tenha do mesmo minério, e é usado primeiro: a mineradora cobre só o resto. O breakdown reporta quanto o plano puxa de cada import, que é o número que você precisa para dimensionar a esteira que sai da outra fábrica.
- **Busca de receitas alternadas**: o botão *Find the best alternates* prova as alternadas umas contra as outras e aplica a combinação que ganha. Com as taxas de saída em branco ele maximiza a produção; com as taxas fixas a saída não pode se mexer, então ele passa a minimizar o que ela custa em mineradoras (ou em energia, se nada for extraído). É subida de encosta por coordenadas: fixa tudo, testa cada receita de um item, guarda a melhor, passa para o próximo, e repete até uma passada inteira não mudar nada. O conjunto de itens é recalculado a cada passada, porque trocar uma receita reescreve a cadeia — Cast Screw derruba o estágio de rods e as escolhas dele junto, e traz as dos ingredientes novos. Uma cadeia típica sai em poucos milissegundos e algumas dezenas de planos avaliados, e o resultado diz quanto melhorou e sobre quantos planos.
- **Múltiplos outputs**: cada item de saída ganha seu próprio Storage Container. Intermediários compartilhados (ex.: um ingot que alimenta placas e parafusos ao mesmo tempo) são produzidos uma vez só e divididos, refletido tanto no floor plan quanto no breakdown.
- **Modo de construção Exact ou Whole machines**: em *Exact* cada estágio underclocka sua última máquina, então a cadeia produz exatamente a demanda e só subprodutos sobram. Em *Whole machines* não há underclock em lugar nenhum: máquinas de produção e extratores são arredondados para cima e rodam todos no clock cheio, como fábricas costumam ser construídas de fato. Cada estágio passa a sobreproduzir, a mineradora engatada entrega a taxa cheia do nó, e todo esse excesso é o overflow. Apenas os extratores necessários são construídos; nós sobrando ficam intocados. No modo target-driven o storage continua recebendo a taxa pedida e o excedente vai para o overflow; no modo supply-driven o excedente do estágio final vai para o storage, já que ali você pediu o máximo.
- **Overclocking com Power Shards**: 0 a 3 shards por máquina, liberando clock de 100% a 250%. Cada estágio passa a caber em menos máquinas e cada mineradora puxa mais do nó, nunca além do que a esteira carrega (overclockar acima do teto da esteira só gastaria energia). O consumo sobe com `clock^1.32`, e o breakdown mostra quantos shards o plano inteiro precisa.
- **AWESOME Sink junto da máquina que transborda**: em *Whole machines* o overflow **sólido** é sempre roteado para AWESOME Sinks, que eliminam o excedente e somam os pontos de cupom por minuto. Não é um toggle separado: overflow e sink andam juntos, já que sobreproduzir sem destino não faz sentido. Cada sink é posicionado uma coluna adiante do estágio que ele drena, e não no fim do esquemático, então a esteira até ele atravessa só o vão vazio entre colunas em vez de cruzar a fábrica inteira. Fluidos não são sinkáveis (restrição do jogo) e continuam reportados como surplus. Em *Exact* não há o que sinkar além de subproduto, então eles ficam como surplus.
- **Tier de transporte por trecho**: o seletor de esteira e cano significa a melhor que você desbloqueou, e serve de teto para duas coisas: quantas linhas paralelas cada trecho precisa e quanto uma mineradora pode entregar. Dentro desse teto, **cada trecho recebe o tier mais barato que dá conta da sua própria taxa**. Um plano com teto Mk.5 rotula um trecho de 90/min como Mk.2 e um de 150/min como Mk.3, em vez de mandar você construir Mk.5 em toda a fábrica. Quando a taxa exige mais de uma linha, o tier é escolhido pela carga de **uma** linha, não pelo total.
- **Compartilhamento sem backend**: o estado inteiro do console é serializado no *fragmento* da URL (nunca na query, então nada trafega até um servidor). Ao abrir um link compartilhado ele vence o que estiver salvo localmente, e o fragmento é consumido em seguida, para não ficar um link visível que envelhece a cada edição. Fragmento inválido ou adulterado cai silenciosamente no plano salvo.
- **Zoom, pan e fullscreen** no floor plan: roda do mouse amplia sob o cursor, arrastar o fundo movimenta, e há um *fit* que reenquadra. Quando a Fullscreen API é negada (sem gesto de usuário, iframe sem permissão), cai num modo que cobre a página via CSS, então o botão nunca fica morto.
- **Reposicionamento manual por drag and drop**: arraste qualquer máquina, Splitter ou Merger, e as esteiras acompanham. Arrastar uma máquina leva junto as junções que a servem; arrastar uma junção move só ela, sem empurrar o resto da árvore. As posições são guardadas por caixa, não por plano: mexer só nas taxas de saída preserva todo o arranjo, enquanto trocar a cadeia descarta apenas as caixas que deixaram de existir. O botão ↺ desfaz o arranjo.
- **Leitura do fluxo**: toda esteira é tracejada e animada no sentido em que corre, então o caminho de cada material fica visível de relance.
- **Vazão por segmento**: na visão *Complex*, cada trecho de esteira é rotulado com quanto passa por ele, por minuto, não só o tronco de cada run. Numa árvore a taxa cai a cada divisão; num manifold o barramento vai afinando à medida que sangra cada máquina. As taxas por máquina saem proporcionais ao clock (uma máquina mais lenta puxa menos da esteira), e um toggle liga ou desliga os rótulos (ligados por padrão).
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
- **`src/engine`**: o núcleo. `solve.ts` monta o fecho de receitas a partir dos alvos (com detecção de ciclo), propaga a demanda até os recursos raw, dimensiona pela oferta e gera estágios, trechos de transporte (com o tier de cada um) e sinks. Um import *sem taxa* entra nesse fecho como folha — o mesmo teste `isRaw` que para no minério para nele —, o que faz a poda da cadeia acontecer numa linha só; um import *com taxa* continua descendo, e a propagação simplesmente subtrai o que chega antes de dimensionar as máquinas, então um estágio inteiramente coberto sai com zero runs e some pelo caminho que já existia. Como a demanda por matéria-prima passa a dobrar no teto do import, o máximo deixa de ser uma razão para ler e vira uma busca (`largestFitting`: cresce até falhar, depois bisseca) — a mesma máquina que o modo *whole machines* já usava. `helpers.ts` descobre os itens produzíveis (a partir dos nós **e** dos imports) e os pontos de troca de receita. `optimize.ts` faz a busca pelas receitas alternadas. `types.ts` guarda o modelo e as constantes verificadas (velocidades de esteira/cano, taxa do Water Extractor).
- **`src/components`**: `Schematic.tsx` desenha o diagrama SVG nos modos Standard e Complex (ambos partem da mesma função `grid`, que ordena cada coluna pelo baricentro de quem a alimenta) e monta a fiação de junções da visão Complex; `SchematicViewport.tsx` envolve o diagrama com zoom, pan e fullscreen; `Console.tsx` é o painel lateral; `Breakdown.tsx` monta o resumo e a tabela por estágio.
- **`src/ui`**: lógica de apresentação pura e testável de forma headless. `junctions.ts` (árvores de Splitter/Merger), `viewport.ts` (matemática de pan/zoom), `manualLayout.ts` (posições arrastadas e sua poda), `plannerState.ts` (o estado de um plano), `library.ts` (as várias fábricas, a hidratação a partir do salvo ou do link, a resolução do que cada uma produz e **a única tradução do console para o motor** — é ela que garante que o que o esquemático desenha seja exatamente o que as fábricas compradoras são informadas de que podem ter), `usePlanner.ts` (o estado em si, a persistência e as resoluções) e `share.ts` (serialização para a URL).

Todas as taxas são por minuto; fluidos em m³. Valores de máquinas, potências, taxas de mineração, esteiras e canos são verificados contra a [wiki.gg](https://satisfactory.wiki.gg/) por testes em `loader.test.ts` e `solve.test.ts`.

A fiação da visão Complex é verificada por invariantes, e não só por render sem exceção: todo Merger tem exatamente uma saída e no máximo três entradas, todo Splitter o inverso, nenhuma esteira atravessa um quadrado para chegar na face oposta, no manifold nenhuma junção passa de duas vias, e cada junção conserva o fluxo (o que entra sai, então as taxas rotuladas fecham). No modo tree a árvore corre para frente da coluna que produz para a que consome; no manifold o barramento sobe ou desce ao lado das máquinas.

## Escopo

Exclusões deliberadas (não são bugs):

- Nitrogen Gas fora dos recursos de nó (exige Resource Well Pressurizer, mecânica diferente).
- A busca de receitas assume que você tem **todas** as alternadas desbloqueadas; ela não sabe nada do seu MAM. Confira as escolhas antes de construir.
- A busca é subida de encosta, não enumeração exaustiva: pode parar num ótimo local. É o preço de não varrer um espaço que cresce multiplicativamente — algumas centenas de planos em vez de alguns milhões.
- Duas fábricas puxando a mesma saída de uma terceira são avisadas, não repartidas: o app não aloca a produção entre elas por conta própria. Dividir a taxa é escolha sua.
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
