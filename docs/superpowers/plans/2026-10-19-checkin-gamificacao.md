# Check-in em partes + Gamificação — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check-in do dia em duas partes (Manhã/Noite) salvas separadamente, anel de progresso + sequência + metas da semana/medalhas, e mensagens claras para "IA sem créditos".

**Architecture:** `daily_checkins` continua uma linha por dia, com os campos das partes anuláveis e merge por campo no handler do servidor. Os alvos do dia ganham `checkin_morning`/`checkin_evening` no `DayPlanner` (C#) e no `buildDay` (TS), amarrados pela fixture compartilhada. A gamificação é derivada no cliente (funções puras sobre `buildDay` + `adherence_logs` + check-ins), sem entidades novas.

**Tech Stack:** .NET 10, EF Core, FluentValidation; React 19, SQLite local, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-checkin-gamificacao-design.md`

## Global Constraints
- Tudo de `CLAUDE.md` (inglês no código, pt-BR na UI, nada real, commits/PR sem marca do Claude). Branch `feat/checkin-gamificacao` (base `main`).
- Migrations do servidor sem perda de dados (só `DROP NOT NULL`); migration local nova com reconstrução de tabela preservando as linhas.
- Partes: **Manhã** = `sleep_quality`, `energy_wake`, `bowel` (obrigatórios na parte) + `weight_kg` (opcional). **Noite** = `energy_day`, `anxiety`, `water_l` (obrigatórios na parte) + `note` (opcional). Cardio = `cardio_done`, `cardio_minutes` (só pelo item Cardio do Hoje).
- Parte concluída: Manhã se `sleep_quality`, `energy_wake` e `bowel` não nulos; Noite se `energy_day`, `anxiety` e `water_l` não nulos. Linhas antigas completas contam as duas.
- Alvos: `checkin_morning` ("Check-in da manhã", slot `checkin_morning`, padrão 07:00) e `checkin_evening` ("Check-in da noite", slot `checkin`, padrão 21:30). A chave antiga `checkin` em `adherence_logs` vale como `checkin_evening`.
- Score do dia = (feitos + 0,5 × parciais) / previstos; hoje só conta o que venceu ou foi marcado. Meta do dia: ≥ 90 % (dia fechado). Semana seg–dom.
- Mensagem "sem créditos": "A IA está sem créditos. Recarregue em console.anthropic.com → Plans & Billing e tente de novo — ou preencha à mão."

## Review Focus
1. **Manhã num aparelho, Noite em outro antes do pull** → nenhuma parte apaga a outra (merge por campo). Teste na Task 1.
2. **Linha criada só pelo cardio** (todos os campos das partes nulos) → nenhuma parte conta como feita; médias do Resumo ignoram nulos. Testes nas Tasks 1 e 4.
3. **Dados antigos** (check-ins completos e `adherence` `checkin`) → Hoje mostra as duas partes feitas e o lembrete da noite não dispara. Testes nas Tasks 3 e 4.
4. **Sequência na virada do dia** → hoje só entra quando bate a meta; ontem abaixo de 90 % zera; dias sem nada previsto (sem protocolo nem ficha) não quebram nem contam. Teste na Task 6.
5. **Celebração repetida** → 100 % dispara uma vez por dia (guardado em `localStorage` com try/catch), não a cada render. Teste na Task 7.

---

### Task 1: Check-in em partes no servidor
**Files:** `backend/src/ProtocoloApp.Api/Features/DailyCheckins/{DailyCheckin.cs,DailyCheckinConfiguration.cs,DailyCheckinPayload.cs,DailyCheckinSyncHandler.cs}`, migration `CheckinParts`; Test `IntegrationTests/DailyCheckins/*`.
**Interfaces:** campos `SleepQuality`, `Bowel`, `EnergyWake`, `EnergyDay`, `Anxiety`, `WaterL` viram anuláveis; validador "se presente, na faixa"; `note` vazio ("") limpa a observação; o handler aplica merge por campo (nulo no payload mantém o valor gravado) para todos os campos das partes, `weight_kg`, `note`, `cardio_done`, `cardio_minutes`. Pull devolve nulos como `null`.
- [ ] Testes: Manhã (aparelho A) e depois Noite (aparelho B com `client_updated_at` maior, campos da manhã nulos) → linha final com as duas partes; payload só com cardio cria linha com partes nulas; faixa inválida → `invalid_payload:<campo>`; `note: ""` limpa.
- [ ] Implementar (`[migration:CheckinParts]`), CI verde, commit.

### Task 2: Extração "sem créditos" e push mais robusto
**Files:** `Features/Plans/Extraction/{PlanExtractor.cs,PlanExtractionResult.cs,AnthropicClient.cs}`, `Features/Push/{PushDispatcher.cs,ReminderScheduler.cs}`; Tests correspondentes; front `frontend/src/features/plans/PlanReviewPage.tsx` (+ teste).
**Interfaces:** `AnthropicToolCall` ganha `ErrorMessageHint` limitado a um enum interno (`CreditBalance` quando `error.message` contém "credit balance"; nada mais da mensagem sai do client); `PlanExtractionResult.NoCredits = "no_credits"`, sem retry. Push: `Failed` só incrementa `failure_count` para 4xx ≠ 429; `PushResult` distingue `Transient`. Scheduler: se `Sent == 0` e nenhuma inscrição removida, apaga o `reminder_sends` do slot.
- [ ] Testes: resposta 400 "Your credit balance is too low…" → `no_credits`, uma tentativa; 503 três vezes não remove a inscrição; envio transitório libera o slot e o minuto seguinte (dentro de 2 min) envia; front mostra a mensagem de créditos para `extractionError = no_credits`.
- [ ] Implementar, CI verde, commit.

### Task 3: Alvos do check-in no `DayPlanner` (C#) e no `buildDay` (TS)
**Files:** `Features/Today/DayPlanner.cs`, `Features/Push/ReminderCopy*.cs` (rótulo "Check-in da manhã"), `fixtures/schedule-cases.json`, `frontend/src/domain/dayPlan.ts`, `frontend/src/data/scheduleRepo.ts` (`defaultSlotTimes`: `checkin_morning` 07:00), `frontend/src/features/settings/scheduleRows.ts` (linha "Check-in da manhã"); Tests C# e `dayPlan.test.ts`.
**Interfaces:** `CheckinMorningKey = "checkin_morning"`, `CheckinEveningKey = "checkin_evening"`; alvos tipo `Checkin`; o scheduler trata `adherence` `checkin` (legado) como `checkin_evening` e também considera feito um alvo de check-in cuja parte já está salva em `daily_checkins` (lido no tick).
- [ ] Fixture: casos novos (dia com os dois check-ins nos horários; legado `checkin`); todos os casos antigos atualizados para os dois alvos.
- [ ] Teste do scheduler: Manhã salva no check-in → sem push às 07:00; Noite pendente → push às 21:30 "Check-in da noite".
- [ ] CI verde, commit.

### Task 4: Dados do check-in no aparelho
**Files:** `frontend/src/data/{migrations.ts,dailyCheckinRepo.ts,adherenceLinks.ts}`, `frontend/src/features/summary/summaryData.ts`; Tests.
**Interfaces:** migration local nova recria `daily_checkins` com colunas anuláveis (copia as linhas); `dailyCheckinRepo.saveMorning(db, userId, date, {sleepQuality, energyWake, bowel, weightKg}, now)`, `saveEvening(db, userId, date, {energyDay, anxiety, waterL, note}, now)`, `setCardio(db, userId, date, {done: boolean|null, minutes: number|null}, now)` — cada um lê a linha atual e grava a linha inteira preservando a outra parte, com outbox na mesma transação; `checkinParts(row): {morning: boolean, evening: boolean}`. `adherenceLinks`: salvar uma parte marca o alvo correspondente `done`; Cardio do Hoje usa `setCardio`. Resumo: médias ignoram nulos; "check-ins" passa a contar dias com as duas partes.
- [ ] Testes: migration preserva linhas antigas; Manhã depois Noite → linha completa; cardio sem check-in cria linha com partes nulas e `checkinParts` = {false,false}; médias com nulos.
- [ ] Lint/test/build, commit.

### Task 5: Telas do check-in e do Hoje
**Files:** `frontend/src/features/checkin/{CheckinHubPage.tsx,MorningCheckinPage.tsx,EveningCheckinPage.tsx,checkinSchema.ts}`, `routes.tsx`, `features/today/{TargetRow.tsx,TodayPage.tsx,todayData.ts}`; Tests; e2e que usam o check-in.
**Interfaces:** `/checkin` = hub com os dois cartões (estado e "Preencher"/"Editar"); `/checkin/manha` e `/checkin/noite` com os campos da parte (mesmos componentes de escolha), salvar volta para `/hoje`; itens do Hoje abrem a parte certa; o item Cardio, ao marcar Feito, pergunta "Quantos minutos?" (opcional) num sheet.
- [ ] Testes: cada parte salva sozinha; editar a manhã depois da noite mantém a noite; item da manhã vira feito; minutos do cardio gravados.
- [ ] Atualizar e2e (smoke/offline/today) para o fluxo novo; lint/test/build; CI verde; commit.

### Task 6: Domínio da gamificação (funções puras)
**Files:** `frontend/src/domain/progress.ts` (+ `progress.test.ts`).
**Interfaces:** `dayScore(plan: DayPlan, marks, parts, now?) : {done, partial, planned, ratio}`; `isOnTarget(score) : boolean` (≥ 0,9, `planned > 0`); `streak(days: DayScore[], today) : {current, best}`; `weekGoals(weekDays, protocol) : WeekGoal[]` (`diet`, `items`, `workouts`, `cardio`, `water`, `checkins`, cada um `{key, label, progress, target, done}`); `medals(history) : Medal[]` (`perfect_week`, `diet_100_7`, `streak_7`, `streak_14`, `streak_30`, `all_workouts_cycle`, cada uma `{key, label, earnedOn | null, progress}`); `loadProgress(db, today)` monta o histórico (desde a ativação mais antiga do protocolo) usando `buildDay`.
- [ ] Testes com datas fixas: sequência quebra com um dia < 90 %; hoje entra só quando ≥ 90 %; dia sem previstos não conta nem quebra; metas da semana com água vs `water_min_l`; medalhas ganhas e progresso das bloqueadas.
- [ ] Lint/test, commit.

### Task 7: UI da gamificação
**Files:** `frontend/src/features/today/{ProgressRing.tsx,Celebration.tsx,WeekCard.tsx}`, `frontend/src/features/summary/` (cartões "Sequência" e "Semanas na meta"), `frontend/src/features/achievements/AchievementsPage.tsx`, menu Mais, `routes.tsx`; Tests.
- Usar o skill `frontend-design` mantendo a direção visual atual (tokens do `index.css`, ícones próprios). Anel SVG com a % e "N de M"; chama + número da sequência no cabeçalho; celebração em CSS/SVG (sem lib), uma vez por dia, desligada com `prefers-reduced-motion`; cartão "Semana" com as metas; `/conquistas` com medalhas ganhas (data) e bloqueadas (progresso).
- [ ] Testes: anel mostra a % certa; 100 % dispara a celebração uma vez; Conquistas lista ganhas/bloqueadas; screenshots do e2e incluem Hoje e Conquistas.
- [ ] Lint/test/build, CI verde, commit.

### Task 8: E2E, docs e PR
- [ ] E2E: Manhã salva offline → Noite salva → sincroniza → Resumo conta 1 check-in completo; Hoje mostra o anel > 0 %.
- [ ] Docs: README (check-in em partes, gamificação), runbook (mensagem de créditos da IA).
- [ ] PR `feat/checkin-gamificacao` → `main` (REST); merge só com OK do Gabriel.
