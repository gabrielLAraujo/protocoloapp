# Questionário: valor inicial, semana, categorias e grupos — Plano

Trilha A de `docs/superpowers/specs/2026-10-23-ajustes-atualizacao-design.md`. Branch `feat/quest-params`, a partir de `main`.
Sem migration (o modelo é `jsonb`). As métricas `stress_avg` e `mood_avg` (trilha B) ficam fora: só a lista e os rótulos
ganham `items_used`, logo depois de `items_missed`, para o merge com a trilha B não conflitar.

## Contrato

Pergunta do modelo (todos opcionais):

```json
{ "key": "k", "text": "…", "kind": "long_text", "fill": "items_missed",
  "default": "texto inicial (até 4000)",
  "fillOptions": { "week": 2, "categories": ["supplement", "compound"], "groups": ["chest", "lower_back"] } }
```

- `week`: inteiro 1–6; só com `fill` em `diet_error_pct`, `diet_wrong_meals`, `diet_deviations`, `missed_workouts`, `missed_cardio`.
- `categories`: 1–5 valores distintos de `supplement|compound|hormone|thermogenic|sleep_optional`; só com `items_missed`/`items_used`.
- `groups`: 1–14 valores distintos de `MuscleGroup` em snake_case (como nos documentos de plano); só com `strength_changes`.
- `fillOptions` sem `fill` é erro; `{}` vale como ausente.

Métricas (`GET /api/update-cycles/{id}/metrics`):

- `itemsMissed[]`: ganha `category` (texto ou null).
- `itemsUsed[]` (novo): `{ key, name, category, done, partial, planned }`, itens com ao menos um dia feito ou parcial,
  na ordem em que aparecem no ciclo. `planned` conta os dias com o item (hoje só se marcado).
- `missedWorkouts.weeks[]`: `{ week, from, to, planned, done, missedDates }`; `missedCardio.weeks[]`: `{ week, from, to, planned, done }`.
  Como na dieta, só semanas com algo previsto.

## Tarefas (TDD, um commit cada)

1. **Servidor, modelo:** `Default` e `FillOptions` em `QuestionnaireQuestionDto`, regras em `QuestionnaireRules`,
   listas de aplicabilidade em `FillMetric` (`WeekMetrics`, `CategoryMetrics`, `GroupMetrics`), `items_used` em `FillMetric.All`.
   Testes em `QuestionnaireTemplateValidatorTests`. Fixture ganha exemplos fictícios de `default` e `fillOptions`.
2. **Servidor, métricas:** `AdherenceInput.ItemCategories` (opcional), `ItemMisses.Category`, `ItemUse`, semanas de treino e
   cardio; `UpdateMetricsResponse.ItemsUsed`. Testes em `AdherenceMetricsTests` e `UpdateMetricsTests` (campos fixados).
   Push com `[codegen]` para regenerar `openapi.json`; depois `npm run gen:api`.
3. **Front, modelo:** `fillMetrics.ts` (lista, aplicabilidade, categorias), zod de `default`/`fillOptions` com as mesmas regras.
   Testes em `questionnaireTemplate.test.ts` (paridade com a fixture).
4. **Front, métricas:** `updateMetricsSchema` (campos novos com `default` para ler o cache antigo), `testMetrics`, teste de contrato.
5. **Front, texto:** `fillText(metric, metrics, options)` com filtros e "Sem dados nessa semana." (semana fora do ciclo ou sem
   nada previsto); `items_used`; `resolveAnswer` usa `default` (fonte `default`) quando não há edição nem cálculo e passa
   `fillOptions` ao cálculo.
6. **Front, editor:** `QuestionEditSheet` com "Valor inicial", "Semana", "Categorias" e "Grupos" (só quando a métrica aceita);
   ao salvar, descarta o que não se aplica. `FILL_LABELS.items_used`.
7. **E2E:** a fixture traz uma pergunta por semana e outra por categoria; `update.spec.ts` confere as respostas.
8. Lint, testes, build, privacy; CI verde; PR para `main`.
