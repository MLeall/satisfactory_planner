# FICSIT Factory Planner

Planejador de cadeia de produção para o jogo [Satisfactory](https://www.satisfactorygame.com/) (dados da versão 1.0). Aplicação client-side (sem backend): você declara os nós de recurso que possui e o item que quer produzir, e o app calcula a cadeia inteira balanceada, do minério até o armazenamento.

Para cada estágio ele resolve quantas máquinas construir, o clock da máquina parcial (underclock), o consumo de energia, o número de esteiras/canos por trecho e os subprodutos excedentes.

## Como funciona

O planejador é **target-driven**: você informa a taxa de saída desejada e ele dimensiona toda a fábrica para atingi-la, reportando máquinas, energia, extratores e recursos brutos necessários. Os nós declarados (com pureza e quantidade) definem a capacidade disponível; se a taxa pedida exceder o que os nós sustentam, o app aponta o recurso que falta e o quanto.

Deixar o campo de taxa em branco cai no modo **supply-driven**: o planejador calcula o máximo que os nós sustentam, identificando o recurso mais escasso (menor razão entre oferta e demanda) como limitante.

Fluxo de uso:

1. Adicione nós de recurso (tipo, pureza, quantidade).
2. Escolha os tiers de logística (miner, esteira, cano).
3. Escolha o item de saída (só aparecem itens produzíveis a partir dos seus nós).
4. Informe a taxa de saída desejada, ou deixe em branco para o máximo sustentável.
5. Opcionalmente, troque receitas padrão por alternadas; a cadeia rebalanceia na hora.
6. Veja o esquema visual e o detalhamento por estágio.

## Arquitetura

Separação em camadas, com toda a lógica de domínio pura e testável de forma headless:

- **`src/data`** — `data1.0.json` (dump do jogo, via [greeny/SatisfactoryTools](https://github.com/greeny/SatisfactoryTools), mesma origem da [wiki.gg](https://satisfactory.wiki.gg/)) e `loader.ts`, que transforma o JSON bruto no modelo de domínio.
- **`src/engine`** — o núcleo. `solve.ts` monta o fecho de receitas a partir do alvo (com detecção de ciclo), calcula demanda até os recursos raw, dimensiona pela oferta e gera os estágios e trechos de transporte. `helpers.ts` descobre os itens produzíveis e os pontos de troca de receita. `types.ts` guarda o modelo e as constantes verificadas (velocidades de esteira/cano, taxa do Water Extractor).
- **`src/components`** — `Schematic.tsx` desenha o diagrama SVG (colunas por profundidade) e `Breakdown.tsx` monta o resumo e a tabela por estágio.

Todas as taxas são por minuto; fluidos em m³.

## Escopo da v1

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
