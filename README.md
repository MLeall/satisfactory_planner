# FICSIT Factory Planner

Planejador de cadeia de produção para o jogo [Satisfactory](https://www.satisfactorygame.com/) (dados da versão 1.0). Aplicação client-side (sem backend): você declara os nós de recurso que possui e os itens que quer produzir, e o app calcula a cadeia inteira balanceada, do minério até o armazenamento.

Para cada estágio ele resolve quantas máquinas construir, o clock da máquina parcial (underclock), o consumo de energia, o número de esteiras/canos por trecho e os subprodutos excedentes.

## Como funciona

O planejador é **target-driven**: você informa a taxa de saída desejada e ele dimensiona toda a fábrica para atingi-la, reportando máquinas, energia, extratores e recursos brutos necessários. Os nós declarados (com pureza e quantidade) definem a capacidade disponível; se a taxa pedida exceder o que os nós sustentam, o app aponta o recurso que falta e o quanto.

Com **um único output**, deixar a taxa em branco cai no modo **supply-driven**: o planejador calcula o máximo que os nós sustentam, identificando o recurso mais escasso (menor razão entre oferta e demanda) como limitante.

Fluxo de uso:

1. Adicione nós de recurso (tipo, pureza, quantidade).
2. Escolha os tiers de logística (miner, esteira, cano).
3. Adicione um ou mais itens de saída, cada um com sua taxa (só aparecem itens produzíveis a partir dos seus nós). Com um único output, a taxa pode ficar em branco para o máximo sustentável.
4. Opcionalmente, troque receitas padrão por alternadas; a cadeia rebalanceia na hora.
5. Veja o esquema visual e o detalhamento por estágio.

Todas as informações ficam salvas no `localStorage` do navegador entre sessões; o botão **Clear all** zera tudo.

## Funcionalidades

- **Múltiplos outputs**: cada item de saída ganha seu próprio Storage Container. Intermediários compartilhados (ex.: um ingot que alimenta placas e parafusos ao mesmo tempo) são produzidos uma vez só e divididos, refletido tanto no floor plan quanto no breakdown.
- **Smart Splitter + AWESOME Sink combo**: modo opcional que roteia o overflow de subprodutos **sólidos** para AWESOME Sinks, elimina o excedente e soma os pontos de cupom gerados por minuto. Fluidos não são sinkáveis (restrição do jogo) e continuam reportados como surplus.
- **Duas visões do floor plan**:
  - *Standard*: compacta, máquinas agrupadas por estágio com a contagem.
  - *Complex*: cada máquina desenhada individualmente, com os belts ligando através de Splitters e Mergers.
- **Persistência local** de todos os campos e botão para limpar.

## Arquitetura

Separação em camadas, com toda a lógica de domínio pura e testável de forma headless:

- **`src/data`** — `data1.0.json` (dump do jogo, via [greeny/SatisfactoryTools](https://github.com/greeny/SatisfactoryTools), mesma origem da [wiki.gg](https://satisfactory.wiki.gg/)) e `loader.ts`, que transforma o JSON bruto no modelo de domínio.
- **`src/engine`** — o núcleo. `solve.ts` monta o fecho de receitas a partir dos alvos (com detecção de ciclo), propaga a demanda até os recursos raw, dimensiona pela oferta e gera estágios, trechos de transporte e sinks. `helpers.ts` descobre os itens produzíveis e os pontos de troca de receita. `types.ts` guarda o modelo e as constantes verificadas (velocidades de esteira/cano, taxa do Water Extractor).
- **`src/components`** — `Schematic.tsx` desenha o diagrama SVG nos modos Standard e Complex e `Breakdown.tsx` monta o resumo e a tabela por estágio.

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
