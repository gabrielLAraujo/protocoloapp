# Visual clínico — Design

**Objetivo:** deixar o app mais legível e com cara profissional, na linha "clínico claro" (app de saúde / relatório de consultoria), sem mudar fluxos nem dados. Só front.

## Direção visual

- **Tema claro é o principal; o escuro segue o sistema** com a mesma linguagem (mesmos tokens, outros valores).
- **Paleta (claro):**
  - fundo `#F6F7F9` (branco-gelo), superfície `#FFFFFF`, superfície elevada `#F9FAFB`;
  - tinta `#0F172A` (grafite), texto secundário `#475569`, linhas `#E2E8F0`, borda de controle `#7C8A9E` (o `#94A3B8` previsto dava 2,6:1 no branco; `#7C8A9E` é o slate mais próximo que passa 3:1);
  - destaque único azul-petróleo `#0B5E73`, com fundo suave `#E6F1F4`;
  - estados só para estado: ok `#13773A`, aviso `#A54B08`, perigo `#B91C1C` (ok e aviso um tom abaixo de `#15803D`/`#B45309`, para o texto passar 4,5:1 também sobre o próprio fundo a 10 % — chips e o "Parcial" pressionado).
- **Paleta (escuro):** fundo `#0B1117`, superfície `#111A22`, elevada `#16212B`, tinta `#E5EDF3`, secundário `#94A3B8`, linha `#223040`, borda de controle `#64748B`, destaque `#5BB8CF` com fundo suave `#0E2A33` e texto sobre o destaque `#06222B`; estados: ok `#4ADE80`, aviso `#FBBF24`, perigo `#F87171`.
- Todo par texto/fundo passa no contraste **AA**: 4,5:1 para texto e 3:1 para bordas de controle e ícones que carregam sentido. Um teste automático confere os pares principais nos dois temas.
- **Fonte:** Inter variável empacotada no app (`@fontsource-variable/inter`), para funcionar offline e no APK. Só o eixo de peso, sem itálico, e só os subconjuntos latin e latin-ext (`src/ui/inter.css`).
  - Números com `tabular-nums` em todo lugar onde se compara valor (horários, séries, gramas, métricas).
  - Fallback `system-ui`.
- **Escala tipográfica** (só estes tamanhos):
  - legenda 12/16, texto 15/22 e rótulo 13/18 (semibold, tinta secundária);
  - título de seção 17/24 semibold, título de tela 26/32 bold com tracking −0,01em;
  - número de destaque 32/36 semibold tabular.
- **Forma:** raio 12 nos cartões, 10 nos controles e 20 nas folhas inferiores. Sombra muito leve (1 px + 2 px difusos) e bordas de 1 px.
- **Espaçamento:** grade de 4 px. As telas usam 16 px de margem lateral e 24 px entre seções.

## Componentes (base)

- **Cabeçalho:**
  - marca "Protocolo" com um monograma simples em SVG inline, sem imagem;
  - a sincronização vira um ícone discreto com ponto de estado e rótulo acessível. O texto aparece só quando há erro ou pendência.
- **Barra inferior:** ícone com rótulo, a aba ativa em cor de destaque com um indicador em pílula, fundo da superfície e borda superior.
- **`Card`:** variantes padrão, destaque (fundo suave) e lista (sem padding, com divisórias).
- **`ListRow`:** ícone opcional, título, subtítulo e valor à direita com `tabular-nums`. Tem altura mínima de 52 px e pode ser link ou botão.
- **`SectionHeader`:** título de seção com ação opcional à direita (ex.: "Ver conquistas").
- **`Stat`:** rótulo, número de destaque e legenda.
- **`Chip`:** estados neutro, ok, aviso e perigo, para "Feito", "Parcial", "Atrasado" etc.
- **`Button`:** mantém as variantes atuais e o alvo de 44 px. O primário fica sólido em azul-petróleo; o secundário fica branco com borda.

## Telas

- **Hoje:**
  - **Topo:** um cartão com o anel do dia, "N de M feitos", a meta, e a **próxima tarefa** em destaque (nome, horário e ação "Feito").
  - **Itens:** agrupados em **Manhã** (até 11:59), **Tarde** (12:00–17:59), **Noite** (18:00+) e **Sem horário**, em `ListRow`s compactas: ícone do tipo, nome, horário e chip de estado.
  - **Marcar:**
    - o botão de check marca "Feito"; tocar de novo desfaz;
    - o menu "⋯" abre uma folha com **Parcial** e **Não fiz**, que segue para a folha de motivo atual;
    - treino e check-in continuam como links.
  - **Atrasado:** um ponto vermelho e o chip "Atrasado", sem pintar o cartão inteiro.
  - **Detalhes da refeição:** dentro da folha do item, em lista alimento → gramas alinhadas à direita.
  - O cartão "Semana" segue no fim, com barras finas.
- **Resumo:**
  - **Ciclo:** cartão de destaque com a barra do ciclo, "Faltam N dias", a data de atualização e a mensalidade.
  - **Destaques:** fileira de 3 `Stat` (treinos, dieta, água).
  - **Constância:** sequência e semanas na meta.
  - **Demais números:** sono, disposição, ansiedade, itens do protocolo e check-ins, em lista compacta.
  - **Calendário:** dias como células sem borda tracejada; hoje com anel de destaque e legenda compacta.
  - **Peso:** o gráfico só aparece com 2 ou mais pesagens; com menos, fica uma frase.
- **Protocolo (apresentação da dieta):**
  - **Refeições:** um cartão por refeição com nome, horário (quando houver) e tabela de alimentos — nome à esquerda, gramas à direita em `tabular-nums`, observação em legenda.
  - **Suplementos e compostos:** agrupados por momento do dia (Ao acordar, refeições, Antes de dormir…), com nome, dose e chip da categoria.
  - **Cardio e Orientações:** cartões curtos em lista.
- **Demais telas:** herdam a base, com ajustes de espaçamento e hierarquia, sem mudar fluxo nem textos de ação usados nos testes:
  - Treino;
  - sessão de treino;
  - Planejamento;
  - revisão por etapas;
  - Check-in (Manhã/Noite);
  - Conquistas;
  - Configurações;
  - Login;
  - folhas.

## Fora do escopo (vai para o backlog)

- Registrar um alimento a mais numa refeição ou uma refeição a mais (fora do plano, conta como desvio).
- Marcar manipulado, remédio ou suplemento como "não usado porque acabou".
- Importar o relatório do Hevy com o treino do dia.

## Testes e verificação

- `npm run lint`, `npm test`, `npm run build`, `npm run privacy` e E2E no CI.
- Os textos acessíveis usados pelos testes permanecem. Quando a interação muda (marcar Parcial/Não fiz pelo menu), os testes de unidade e E2E são atualizados.
- Teste de contraste dos tokens (claro e escuro), incluindo o texto de estado sobre o próprio fundo a 10 % (sobre página, superfície e elevada).
- Capturas de tela do CI (job `screenshots`) comparadas antes e depois.

## Segunda etapa: desktop e sobriedade

**Objetivo:** usar bem a tela grande (≥ 1024 px, `lg:` do Tailwind) e deixar o visual mais sóbrio em todos os tamanhos. O celular continua com o mesmo layout. Sem mudança de fluxo nem de dados.

### Desktop (≥ 1024 px)

- **Navegação:** a barra inferior vira uma **barra lateral fixa à esquerda**:
  - no topo, a marca e o nome;
  - as abas, com os mesmos links e nomes acessíveis (a `navigation` "Navegação principal" com Resumo, Hoje, Treino e Planejamento);
  - o que fica em "Mais" no celular (Conquistas, Check-in de hoje, Configurações, Sair) aparece direto na barra, sem o botão "Mais";
  - o estado da sincronização fica no pé da barra.
  - Abaixo de `lg` ficam o cabeçalho e a barra inferior atuais. A escolha entre um e outro é feita por `matchMedia('(min-width: 64rem)')`, para que só um dos dois exista na página (sem nomes acessíveis duplicados).
- **Área de conteúdo:** até ~1100 px nas telas de duas colunas, com margens maiores. Check-in e Configurações ficam numa coluna centralizada de ~640 px; as demais telas de uma coluna, em ~760 px.
- **Hoje:** duas colunas. À esquerda, a lista do dia. À direita, um painel fixo (`sticky`) com o anel, a próxima tarefa e o cartão "Semana".
- **Resumo:** à esquerda, o ciclo, os "Números do ciclo" e a força por grupo. À direita, o calendário, a constância e o peso.
- **Treino:** a lista de exercícios à esquerda; à direita, "Começar treino", trocar o treino e o histórico.
- **Planejamento:** os cartões de protocolo e de treino lado a lado.
- **Protocolo:** as refeições à esquerda; suplementos, cardio e orientações à direita.
- **Folhas:** as folhas inferiores (menu "⋯", motivo, minutos etc.) aparecem como diálogo centralizado.

### Sóbrio (todos os tamanhos)

- **Destaque (azul-petróleo) só em três lugares:** botões de ação primária, item ativo da navegação e links.
  - Títulos, ícones, o anel de progresso, as barras e os elementos decorativos ficam em grafite (tinta ou secundário).
  - A marca vira um monograma grafite.
- **Estados:** a cor de estado aparece só no **texto** do chip, sobre fundo neutro (sem preenchimento colorido).
  - O ponto vermelho de atrasado sai, porque o chip "Atrasado" já diz isso.
  - O check marcado fica grafite.
- **Ícones:** saem os ícones decorativos das linhas:
  - o tipo do item (refeição, comprimido, chama, haltere, nota) nas linhas de Hoje e na próxima tarefa;
  - o ícone opcional do `ListRow`;
  - os ícones em quadrinho no cabeçalho dos cartões (Planejamento, lembretes, estado vazio).
  - Ficam os ícones funcionais: check, "⋯", setas, navegação e sincronização.
- **Cartões:** nenhum cartão tem fundo colorido.
  - O tom "destaque" vira um cartão neutro com borda mais forte (`ink/20`).
  - Os tons de estado ficam com fundo neutro e só a borda na cor do estado.
  - As listas usam divisórias finas.
- **Contraste:** o texto de estado sobre página, superfície e elevada continua ≥ 4,5:1. O teste de contraste confere esse par; o par "texto sobre o próprio fundo a 10 %" deixa de valer para os chips.

### Testes

- **Unidade:**
  - a barra lateral em `lg` (com `matchMedia` simulado): itens diretos, sem "Mais", e o rodapé;
  - a folha como diálogo centralizado em `lg` (classes);
  - os chips sem fundo colorido;
  - o atrasado sem ponto.
- **E2E:**
  - o Playwright roda por padrão a 1280×720, ou seja, já na barra lateral; os nomes de navegação continuam os mesmos;
  - `screens.spec.ts` continua com as capturas do celular (390×844) e ganha capturas de desktop (1280×800, tema claro) de Hoje, Resumo, Planejamento e Protocolo.
