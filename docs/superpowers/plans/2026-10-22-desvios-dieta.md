# Desvios na dieta — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Registrar o que foi comido fora do plano (dentro de uma refeição ou como refeição extra), sincronizar e contar na adesão da dieta.

**Architecture:**
- Entidade sincronizada nova `diet_deviation` (tabela `diet_deviations`), no mesmo molde de `adherence_log`: entidade + configuração EF + payload/validador + `SyncHandler` no back; migration local, repositório com outbox e adaptador de pull no front.
- A adesão da dieta passa a ser `feitas ÷ (previstas + desvios)`: os desvios do dia entram como alvos "previstos e não feitos" em `dayScore`, `buildDayInfo` e `adherenceRates`.
- UI no Hoje (folha do item, botão de refeição extra, linhas e selos) e no Resumo (linha e folha por dia).

**Tech Stack:** .NET 10 / EF Core / FluentValidation; React 19, SQLite local, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-acabou-e-desvios-design.md` (parte 2)

## Global Constraints
- Tudo de `CLAUDE.md`: código em inglês, UI em pt-BR, nenhum dado real, autor Gabriel, commits sem marca do Claude.
- `description` obrigatória, até 200 caracteres (sem contar espaços nas pontas); `quantity` opcional, até 60; `time` opcional, `HH:mm`; `meal_key` nulo = refeição fora do plano.
- O texto do desvio nunca vai para logs (nem em mensagens de erro).
- Itens do protocolo não mudam.
- Migration EF pelo Codegen (`[migration:DietDeviations]`); migration local versão 7.

## Review Focus
1. Desvio apagado → some da lista, do selo e da conta (front: teste de adesão e de repositório; back: delete na integração).
2. Dia sem refeição prevista com desvio → dieta 0 %, não "—" (teste em `progress.test.ts` e `summaryData.test.ts`).
3. Hoje de manhã, desvio antes de qualquer refeição vencer → conta já (o desvio não depende de horário) (teste de `dayScore` com `isToday`).
4. Descrição só com espaços ou acima de 200 → recusada no form e no servidor (teste do schema e do validador).
5. Edição vinda de outro aparelho com mudança local pendente mais nova → a local vence (coberto por `applyPulled`; teste de round-trip com edição e exclusão).

---
### Task 1: Back-end — entidade, validação e sync
**Files:**
- Create: `backend/src/ProtocoloApp.Api/Features/DietDeviations/{DietDeviation.cs,DietDeviationConfiguration.cs,DietDeviationPayload.cs,DietDeviationSyncHandler.cs}`
- Modify: `Shared/Data/AppDbContext.cs` (`DbSet<DietDeviation> DietDeviations`), `Program.cs` (`AddSyncHandler<DietDeviationSyncHandler>()`)
- Test: `backend/tests/ProtocoloApp.UnitTests/Sync/DietDeviationPayloadValidatorTests.cs`, `backend/tests/ProtocoloApp.IntegrationTests/DietDeviations/DietDeviationSyncTests.cs`

**Interfaces:** wire `diet_deviation` com payload `{date, meal_key, time, description, quantity}` (snake_case); `MaxDescriptionLength = 200`, `MaxQuantityLength = 60`.

- [ ] Testes do validador: data obrigatória; `description` nula/vazia/"   "/201 → `description`; 200 aceita; `quantity` 61 → `quantity`; `time` "7:00", "24:00", "07:00\n" → `time`; `meal_key` "a b" → `meal_key`; nulos opcionais aceitos.
- [ ] Integração: push+pull round-trip (com e sem `meal_key`), edição (upsert mais novo), exclusão (pull traz `deletedAt`), stale, forbidden de outro usuário.
- [ ] Implementar: tabela `diet_deviations`, índices `(user_id, date)` e único `(user_id, version)`, FK cascade; `time` como `time without time zone`; sem unicidade de negócio (vários desvios por refeição).
- [ ] `dotnet` só existe no CI: commit com `[migration:DietDeviations]`, `git pull` do commit do bot.

### Task 2: Front — tabela local, repositório e sync
**Files:**
- Modify: `frontend/src/data/migrations.ts` (versão 7), `frontend/src/data/registry.ts`
- Create: `frontend/src/data/dietDeviationRepo.ts`, `frontend/src/data/dietDeviationRepo.test.ts`

**Interfaces:**
- `DIET_DEVIATION_ENTITY = 'diet_deviation'`, `MAX_DESCRIPTION_LENGTH = 200`, `MAX_QUANTITY_LENGTH = 60`
- `interface DietDeviationInput { date: string; mealKey: string | null; time: string | null; description: string; quantity: string | null }`
- `interface DietDeviationLocal extends DietDeviationInput { id: string; clientUpdatedAt: string }`
- `dietDeviationRepo.add(db, input, now): Promise<string>` (id `newId()`), `.update(db, id, input, now)`, `.remove(db, id, now)`, `.between(db, from, to): Promise<DietDeviationLocal[]>` (vivos, por data e horário)
- `dietDeviationSync: SyncEntityAdapter`

- [ ] Testes: add/update/remove enfileiram upsert/upsert/delete; `between` ignora apagados; entrada inválida (descrição vazia, 201, horário "7:00") lança `RangeError` sem o texto na mensagem; round-trip entre dois aparelhos com edição e exclusão (servidor falso como em `todaySync.test.ts`).

### Task 3: Adesão com desvios
**Files:** `frontend/src/domain/progress.ts`, `frontend/src/features/progress/progressData.ts`, `frontend/src/features/summary/summaryData.ts`, `frontend/src/features/today/todayData.ts` (+ testes de cada um)

**Interfaces:**
- `DayScoreOptions.deviations?: number` — somado a `planned` (hoje inclusive, independe do horário), só quando o dia tem plano.
- `DayInfoInput.deviations?: number` — somado a `diet.planned` e ao `score`; `dietComplete` = false com desvio (null só sem refeições e sem desvios).
- `AdherenceInput.deviations?: readonly { date: string }[]` — cada um soma 1 a `diet.planned` no seu dia.
- `TodaySources.deviations: DietDeviationLocal[]`; `TodayView.deviations` (todos) e `TodayRow.deviations` (os da refeição); `wholeDayScore`/`dueScore` passam a contagem.

- [ ] Testes: 0 previstas + 1 desvio → `planned 1, ratio 0`; refeição feita + desvio → 50 %; desvio apagado (fora da lista) não conta; meta da semana "Dieta ≥ 90%" cai com desvios; `formatRate` "0%" com só desvio.

### Task 4: UI do Hoje
**Files:**
- Create: `frontend/src/features/today/{DeviationSheet.tsx,ExtraMealRow.tsx,deviationSchema.ts}` + `DeviationSheet.test.tsx`
- Modify: `StatusMenuSheet.tsx`, `TargetRow.tsx`, `DayTimeline.tsx`, `TodayPage.tsx`, `todayData.ts` (`timelineGroups`)

**Interfaces:**
- `deviationSchema` (zod): `description` trim 1..200 ("Diga o que foi"), `quantity` ≤60 → null quando vazio, `time` `HH:mm` → obrigatório só na refeição extra.
- `DeviationSheet({ mode: 'meal' | 'extra', initial?, busy, onSave(input), onDelete?, onCancel })`: título "Comi algo fora do plano" / "Refeição fora do plano" (edição: "Editar desvio"), campos "O que foi", "Quantidade (opcional)", "Horário" (extra; padrão agora).
- `timelineGroups(rows, extras)` → `{ period, items: ({kind:'target', row} | {kind:'extra', deviation})[] }[]`, extras pelo horário dentro do período.
- Selo "Desvio" (`Chip tone="warn"`) na linha da refeição; linha extra com selo "Fora do plano" (warn); folha do item lista os desvios com "Editar"/"Apagar" e o botão "Comi algo fora do plano" (só refeições); botão "Refeição fora do plano" abaixo da lista.

- [ ] Testes de componente: salvar pede descrição; extra grava `mealKey null` e horário; selo aparece; editar/apagar pela folha.
- [ ] E2E (`today.spec.ts`): pelo "⋯" de "Refeicao 1", "Comi algo fora do plano", salvar e ver o selo "Desvio"; seletores existentes mantidos.

### Task 5: Resumo
**Files:** `frontend/src/features/summary/{SummaryPage.tsx,DeviationsSheet.tsx}`, `SummaryPage.test.tsx`

- [ ] Linha "Desvios na dieta" com valor "N no ciclo" (botão); toque abre a folha com os desvios agrupados por dia (data, refeição ou "Fora do plano", horário, quantidade). Sem desvios: "Nenhum desvio no ciclo."
- [ ] Teste: contagem e lista por dia; a porcentagem de Dieta considera os desvios.

### Verificação final
- `npm run lint`, `npm test`, `npm run build`, `npm run privacy`; push; PR "Desvios na dieta: registrar e contar na adesão"; CI verde.
