# Ajustes da atualização, medidores e histórico — Design

Aprovado por Gabriel em 23/10. São três trilhas, cada uma num PR. A trilha A depende da B (métricas de estresse e psicológico). A trilha C é independente.

## B. Medidores no check-in da noite (`feat/checkin-medidores`)

- **Campos novos no check-in diário, parte da noite:**
  - `stress` (inteiro de 0 a 10): "Estresse (0 a 10)". Ajuda: "Quantos causadores de estresse apareceram hoje".
  - `mood` (inteiro de 1 a 5): "Psicológico (1 a 5)". Ajuda: "Como está o lado emocional".
- **Opcionais:** a regra de noite completa não muda (disposição, ansiedade e água) e o lembrete também não.
- **Servidor:** colunas anuláveis, faixa validada, migration `[migration:CheckinStressMood]`. Payloads antigos continuam válidos.
- **Front:** tabela local (migration SQLite), schema, formulário da noite (escala 0–10 e 1–5 no mesmo estilo das outras) e sync por partes.
- **Resumo:** linhas "Estresse" (média de 0 a 10) e "Psicológico" (média de 1 a 5) na lista de números do ciclo.
- **Atualização:** novas métricas `stress_avg` e `mood_avg` (média e dias). Entram no contrato de métricas (servidor, `updateMetricsSchema`, `fillText`, `FILL_METRICS`, `FillMetric.All` e `FILL_LABELS`).

## A. Questionário mais preciso (`feat/quest-params`, depois de B)

- **Pergunta com valor fixo:** campo opcional `default` (texto, até 4000) no modelo.
  - A resposta começa com esse valor e pode ser editada. Também é editável na tela do modelo.
  - Exemplo: o nome do paciente, que fica só no modelo do usuário, nunca no repositório.
- **Parâmetros do cálculo:** campo opcional `fillOptions` na pergunta, validado no servidor e no front.
  - `week` (inteiro de 1 a 6): restringe à semana N do ciclo. Vale para `diet_error_pct`, `diet_wrong_meals`, `missed_workouts`, `missed_cardio` e `diet_deviations`.
  - `categories` (lista dentre `supplement`, `compound`, `hormone`, `thermogenic`, `sleep_optional`): vale para `items_missed` e `items_used`.
  - `groups` (lista de `MuscleGroup`): vale para `strength_changes`.
  - **Semana sem dados ou inexistente:** a resposta é "Sem dados nessa semana."
- **Nova métrica `items_used`:** itens do protocolo usados no ciclo, com nome, categoria, dias feitos, dias previstos e parciais. Junto com `items_missed`, ganha `category` em cada item.
- **Servidor:**
  - as métricas por semana já existem (`dietErrorPct.weeks`, `dietWrongMeals`);
  - passa a existir semana também em treinos e cardios perdidos (`missedWorkouts.weeks`, `missedCardio.weeks`);
  - `itemsUsed` passa a fazer parte da resposta.
- **Front:**
  - `fillText(metric, metrics, options)` aplica os filtros;
  - o editor do modelo ganha os campos "Valor inicial", "Semana", "Categorias" e "Grupos", que só aparecem quando a métrica aceita cada um;
  - `resolveAnswer` usa `default` quando não há cálculo nem edição.
- **Modelo do Gabriel:** o arquivo fora do repositório é refeito com:
  - nome preenchido;
  - 11–14 nas semanas 1–4;
  - 15 com suplementos e compostos;
  - 21–25 com hormônios (usados e não usados);
  - 26–31 com termogênicos;
  - 7 com `mood_avg`;
  - 33 com `stress_avg`.

## C. Corrigir dias anteriores (`feat/historico-dias`)

- **Hoje com navegação de dia:**
  - as setas ‹ › ao lado da data, com `?dia=AAAA-MM-DD` na URL;
  - o limite para trás é o início do ciclo de atualização em andamento (ou 35 dias, quando não há ciclo); o limite para frente é hoje;
  - em um dia passado o título vira "Dia dd/MM" com um chip "Dia anterior";
  - não aparecem o cartão de próxima tarefa, "Atrasado" nem celebração;
  - continuam: marcar feito, parcial ou não fiz com motivo, desvios, refeição fora do plano, água e os links para o check-in daquele dia.
- **Check-in de outro dia:** `/checkin/manha?dia=` e `/checkin/noite?dia=` editam o check-in daquela data.
- **Treino esquecido:**
  - em `/treino`, "Registrar treino de outro dia" pede a data (dentro do limite) e o dia da ficha;
  - abre a sessão no modo de registro: sem cronômetro de descanso, com as séries editáveis e "Salvar treino";
  - grava a sessão com aquela data, já concluída.
- **Corrigir treino passado:** no Histórico, uma sessão abre para editar séries (carga, reps, apagar e adicionar) e salvar.
- **Sincronização:** tudo pelo outbox de sempre. Marcas de adesão e check-ins já são por data, e sessões já têm data.
- **Mudanças no servidor:** só se a validação recusar datas passadas. A regra fica dentro do limite e sem futuro.

## Testes

- **Cada trilha:** unitários, integração e um passo E2E (B: preencher estresse e psicológico; A: resposta por semana e por categoria; C: marcar refeição de ontem e registrar treino de ontem).
- **Dados:** todos fictícios.
