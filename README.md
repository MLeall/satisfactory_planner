# FICSIT Factory Planner

Planejador de cadeia de produção para o jogo [Satisfactory](https://www.satisfactorygame.com/) (dados da versão 1.0). Aplicação client-side (sem backend): você declara os nós de recurso que possui e os itens que quer produzir, e o app calcula a cadeia inteira balanceada, do minério até o armazenamento.

Para cada estágio ele resolve quantas máquinas construir, o clock da máquina parcial (underclock), o consumo de energia, o número de esteiras/canos por trecho e os subprodutos excedentes.

## Como funciona

O planejador é **target-driven**: você informa a taxa de saída desejada e ele dimensiona toda a fábrica para atingi-la, reportando máquinas, energia, extratores e recursos brutos necessários. Os nós declarados (com pureza e quantidade) definem a capacidade disponível; se a taxa pedida exceder o que os nós sustentam, o app aponta o recurso que falta e o quanto.

Deixando **todas as taxas em branco** ele cai no modo **supply-driven**: calcula o máximo que os nós sustentam, identificando o recurso mais escasso (menor razão entre oferta e demanda) como limitante. Com vários outputs em branco, o planejador **balanceia** entre eles: cada output é pesado pelo quanto produziria sozinho com os nós declarados, e todos são escalados pelo mesmo fator até o recurso mais apertado acabar. Assim cada output recebe a mesma fração do seu potencial individual, e outputs que não disputam recurso nenhum saem ambos no máximo.

Fluxo de uso:

1. Adicione nós de recurso (tipo, pureza, quantidade).
2. Escolha os tiers de logística (miner, esteira, cano).
3. Adicione um ou mais itens de saída, cada um com sua taxa (só aparecem itens produzíveis a partir dos seus nós). Deixe todas as taxas em branco para o máximo sustentável, balanceado entre os outputs. Misturar taxa preenchida com taxa em branco é erro: ou você dita todas, ou deixa o planejador dimensionar todas.
4. Opcionalmente, troque receitas padrão por alternadas; a cadeia rebalanceia na hora.
5. Veja o esquema visual e o detalhamento por estágio.

Todas as informações ficam salvas no `localStorage` do navegador entre sessões; o botão **Clear all** zera tudo. O botão **Share** copia um link que reconstrói o plano inteiro (nós, taxas, receitas, modo e o arranjo do floor plan) na máquina de quem abrir.

## Funcionalidades

- **Múltiplos outputs**: cada item de saída ganha seu próprio Storage Container. Intermediários compartilhados (ex.: um ingot que alimenta placas e parafusos ao mesmo tempo) são produzidos uma vez só e divididos, refletido tanto no floor plan quanto no breakdown.
- **Modo de construção Exact ou Whole machines**: em *Exact* cada estágio underclocka sua última máquina, então a cadeia produz exatamente a demanda e só subprodutos sobram. Em *Whole machines* não há underclock em lugar nenhum: máquinas de produção e extratores são arredondados para cima e rodam todos a 100%, como fábricas costumam ser construídas de fato. Cada estágio passa a sobreproduzir, a mineradora engatada entrega a taxa cheia do nó, e todo esse excesso é o overflow. Apenas os extratores necessários são construídos; nós sobrando ficam intocados. No modo target-driven o storage continua recebendo a taxa pedida e o excedente vai para o overflow; no modo supply-driven o excedente do estágio final vai para o storage, já que ali você pediu o máximo.
- **Smart Splitter + AWESOME Sink**: em *Whole machines* o overflow **sólido** é sempre roteado para AWESOME Sinks, que eliminam o excedente e somam os pontos de cupom por minuto. Não é um toggle separado: overflow e sink andam juntos, já que sobreproduzir sem destino não faz sentido. Fluidos não são sinkáveis (restrição do jogo) e continuam reportados como surplus. Em *Exact* não há o que sinkar além de subproduto, então eles ficam como surplus.
- **Compartilhamento sem backend**: o estado inteiro do console é serializado no *fragmento* da URL (nunca na query, então nada trafega até um servidor). Ao abrir um link compartilhado ele vence o que estiver salvo localmente, e o fragmento é consumido em seguida, para não ficar um link visível que envelhece a cada edição. Fragmento inválido ou adulterado cai silenciosamente no plano salvo.
- **Zoom, pan e fullscreen** no floor plan: roda do mouse amplia sob o cursor, arrastar o fundo movimenta, e há um *fit* que reenquadra. Quando a Fullscreen API é negada (sem gesto de usuário, iframe sem permissão), cai num modo que cobre a página via CSS, então o botão nunca fica morto.
- **Reposicionamento manual por drag and drop**: arraste qualquer máquina e as esteiras acompanham. As posições são guardadas por caixa, não por plano: mexer só nas taxas de saída preserva todo o arranjo, enquanto trocar a cadeia descarta apenas as caixas que deixaram de existir. O botão ↺ desfaz o arranjo.
- **Duas visões do floor plan**:
  - *Standard*: compacta, máquinas agrupadas por estágio com a contagem.
  - *Complex*: cada máquina desenhada individualmente, com os belts ligando através de Splitters e Mergers.
- **Persistência local** de todos os campos e botão para limpar.

## Arquitetura

Separação em camadas, com toda a lógica de domínio pura e testável de forma headless:

- **`src/data`** — `data1.0.json` (dump do jogo, via [greeny/SatisfactoryTools](https://github.com/greeny/SatisfactoryTools), mesma origem da [wiki.gg](https://satisfactory.wiki.gg/)) e `loader.ts`, que transforma o JSON bruto no modelo de domínio.
- **`src/engine`** — o núcleo. `solve.ts` monta o fecho de receitas a partir dos alvos (com detecção de ciclo), propaga a demanda até os recursos raw, dimensiona pela oferta e gera estágios, trechos de transporte e sinks. `helpers.ts` descobre os itens produzíveis e os pontos de troca de receita. `types.ts` guarda o modelo e as constantes verificadas (velocidades de esteira/cano, taxa do Water Extractor).
- **`src/components`** — `Schematic.tsx` desenha o diagrama SVG nos modos Standard e Complex (ambos partem da mesma função `grid`, que só difere nas métricas da caixa), `SchematicViewport.tsx` envolve o diagrama com zoom/pan/fullscreen e `Breakdown.tsx` monta o resumo e a tabela por estágio.
- **`src/ui`** — lógica de apresentação pura e testável de forma headless: `viewport.ts` (matemática de pan/zoom), `manualLayout.ts` (posições arrastadas e sua poda) e `share.ts` (serialização do plano para a URL).

Todas as taxas são por minuto; fluidos em m³. Valores de máquinas, potências, taxas de mineração, esteiras e canos são verificados contra a [wiki.gg](https://satisfactory.wiki.gg/) por testes em `loader.test.ts` e `solve.test.ts`.

## Escopo

Exclusões deliberadas (não são bugs):

- Nitrogen Gas fora dos recursos de nó (exige Resource Well Pressurizer, mecânica diferente).
- Subprodutos viram excedente reportado, nunca são reciclados de volta na cadeia.
- Receitas `Unpackage` nunca são escolhidas por padrão (evita ciclos como Fuel → Packaged Fuel → Fuel).
- Receitas de Converter que produzem minério são ignoradas (recurso raw é sempre extraído).
- Potência de receitas com power variável usa a média entre min e max.

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
