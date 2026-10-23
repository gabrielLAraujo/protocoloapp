# Atualização (questionário e fotos) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela "Atualização" com fotos guiadas (fila offline, R2, `.zip`) e questionário montado a partir de um modelo editável, com respostas calculadas no servidor, rascunho sincronizado e saída em PDF (impressão), texto e zip.

**Architecture:**
- Duas entidades sincronizadas novas: `questionnaire_template` (uma viva por usuário, documento `jsonb`) e `update_cycle` (criada pelo servidor na ativação do protocolo com data de atualização; o aparelho muda só `answers`, `photos` e `status`).
- As métricas de `fill` são funções puras em C# sobre as linhas existentes (`DayPlanner`, `adherence_logs`, `diet_deviations`, `daily_checkins`, sessões e séries), servidas por `GET /api/update-cycles/{id}/metrics`; o front formata o texto em pt-BR e guarda a última resposta no `kv`.
- Fotos: câmera própria (`getUserMedia` / Capacitor Camera / arquivo), fila em IndexedDB, envio pelo fluxo de arquivos existente (`kind: photo`), miniatura local em SQLite; zip no aparelho com **fflate** (`zipSync`, sem compressão: JPEG já é comprimido; ~8 kB gz contra ~30 kB do JSZip, e só precisamos de zip síncrono em memória).

**Tech Stack:** .NET 10 / EF Core / FluentValidation / BackgroundService; React 19, zod, SQLite local, IndexedDB, fflate 0.8.2, Vitest (+ fake-indexeddb 6.0.0), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-atualizacao-design.md`

## Global Constraints
- Tudo de `CLAUDE.md`: código/rotas em inglês, UI em pt-BR, **nenhum dado real**, autor Gabriel, commits **sem marca do Claude** (sem `Co-Authored-By`, sem rodapé). Branch `feat/atualizacao` (base `main`); merge só com OK do Gabriel.
- **Nada do questionário real no repositório:** só o mecanismo e o modelo fictício `fixtures/questionnaire-template.example.json` (perguntas inventadas, ex.: "Como foi sua semana de exemplo?"). O `npm run privacy` precisa continuar verde.
- **Fotos nunca em log, repositório ou fixture.** Testes usam imagens geradas na hora (canvas / buffer de um retângulo colorido). Texto de respostas, notas e descrições nunca em logs nem em mensagens de erro.
- **Sem IA** em nenhuma parte.
- Migration EF só pelo Codegen: commit com `[migration:UpdateCycles]` (Task 1, a única migration EF do plano); `git pull` do commit do bot. Mudança de endpoint: `[codegen]` para regenerar `frontend/openapi.json`, depois `npm run gen:api`. Migration local SQLite: versão 8 (Task 6, a única).
- `dotnet` local: testes unitários com `cd backend && dotnet test tests/ProtocoloApp.UnitTests` quando o hook de sessão instalou o SDK; integração só no CI/dev box.
- Novas dependências do front, versão exata: `fflate@0.8.2` (dependency), `fake-indexeddb@6.0.0` (devDependency).
- Métricas de `fill` (lista fechada, igual em C# `FillMetric.All` e TS `FILL_METRICS`): `diet_error_pct`, `diet_wrong_meals`, `diet_deviations`, `missed_workouts`, `missed_cardio`, `items_missed`, `strength_changes`, `training_changes`, `weight`, `water_avg`, `sleep_avg`, `energy_avg`, `anxiety_avg`, `checkin_notes`.
- Período das métricas: `period_start` .. `min(period_end, hoje local)`; semanas = blocos de 7 dias a partir de `period_start` (Semana 1, 2…; a última pode ser curta). No dia de hoje só contam alvos marcados. Fuso: America/Sao_Paulo (`IZoneProvider`).
- Poses padrão (quando o modelo não traz): `front` "Frente", `back` "Costas", `right_side` "Lado direito", `left_side` "Lado esquerdo", `abs` "Abdômen".

### Contrato de dados (fixo; tasks paralelas dependem dele)
- **`questionnaire_template`** payload `{ document }`; `document` (camelCase, como os planos): `{ title, sections: [{ title, questions: [{ key, text, kind, options?, fill? }] }], poses: [{ key, label }] }`. Limites: `title` 1..120; 1..30 seções, título 1..120; 1..60 perguntas por seção e ≤300 no total; `key` `^[a-z0-9_]{1,64}$` única no modelo; `text` 1..1000; `kind` `text|long_text|number|choice`; `options` só e obrigatório em `choice` (2..20, cada 1..120); `fill` nulo ou uma métrica da lista; `poses` 0..12, `key` `^[a-z0-9_]{1,32}$` única, `label` 1..40. Uma viva por usuário (`template_conflict`).
- **`update_cycle`** payload `{ protocol_version_id, period_start, period_end, status, answers, photos, sent_at }`; `status` `collecting|draft|sent`; `answers` objeto `key → texto` (≤300 chaves, chave como acima, texto ≤4000); `photos` `[{ pose, file_id, taken_at }]` (≤40, pose como acima, uma por pose). `protocol_version_id`, `period_start`, `period_end` são do servidor: o push os ignora. Push de id desconhecido → `read_only`. `file_id` precisa ser arquivo `Photo` confirmado do usuário (`invalid_reference`).
- **Métricas** `GET /api/update-cycles/{id}/metrics` (camelCase): `{ cycleId, from, to, computedAt, dietErrorPct: { cycle: Rate, weeks: WeekRate[] }, dietWrongMeals: [{ week, from, to, count, reasons: ReasonCount[] }], dietDeviations: [{ date, mealKey, mealLabel, time, description, quantity }], missedWorkouts: { planned, done, missedDates[] }, missedCardio: { planned, done }, itemsMissed: [{ key, name, missed, reasons: ReasonCount[] }], strengthChanges: [{ group, best: Trend[], worst: Trend[] }], trainingChanges: [{ date, kind: 'plan_activated'|'swapped'|'skipped', exerciseName, replacementName }], weight: { start: {date,kg}|null, end: {date,kg}|null, deltaKg|null }, waterAvg: { avgL|null, targetL|null, days }, sleepAvg: Avg, energyAvg: { wake: Avg, day: Avg }, anxietyAvg: Avg, checkinNotes: [{ date, note }] }` com `Rate = { planned, done, errorPct|null }`, `WeekRate = Rate & { week, from, to }`, `ReasonCount = { reason, count }` (`reason` = código de `AdherenceLog.Reasons`, `ran_out`, `unmarked` ou `deviation`), `Trend = { exerciseId, name, firstE1rm, lastE1rm, delta, sessions }`, `Avg = { avg|null, days }`. Médias com 1 casa, kg/L com 2.

## Review Focus
1. Ciclo sem nenhum registro (protocolo ativado hoje) → métricas vazias sem erro (`errorPct null`, listas vazias, médias `null`), e o front mostra "Sem dados no ciclo" em vez de "0%" (Tasks 2, 3, 7).
2. Foto tirada offline e app fechado antes de voltar a rede → a fila em IndexedDB sobrevive ao reload e sobe uma vez só, sem foto duplicada na pose (Task 9).
3. Resposta editada no aparelho enquanto o servidor muda `period_end` (datas do ciclo editadas) → a edição não fica `stale` nem se perde (Task 1: servidor preserva `ClientUpdatedAt`; Task 6: round-trip).
4. Modelo importado com JSON inválido, chave repetida ou `fill` desconhecido → recusa com mensagem pt-BR e o modelo atual fica intacto (Tasks 1, 8).
5. APK (Capacitor) sem `window.print`/download por âncora → "Gerar PDF" some e o zip vai por `navigator.share` quando há, senão aviso "Use o app no navegador para baixar"; nada quebra (Task 11).

---
### Task 1: Back-end — modelo, ciclo e sync
**Files:**
- Create: `backend/src/ProtocoloApp.Api/Features/Updates/{QuestionnaireTemplate.cs,QuestionnaireTemplateDocument.cs,QuestionnaireTemplateSyncHandler.cs,UpdateCycle.cs,UpdateCyclePayload.cs,UpdateCycleSyncHandler.cs,UpdateConfigurations.cs,FillMetric.cs,UpdateCycles.cs,UpdateEndpoints.cs,UpdatesSetup.cs}`, `fixtures/questionnaire-template.example.json`
- Modify: `Shared/Data/AppDbContext.cs` (`QuestionnaireTemplates`, `UpdateCycles`), `Program.cs` (dois `AddSyncHandler`, `api.MapUpdates()`), `Features/Plans/PlanActivation.cs` (protocolo ativado → `UpdateCycles.EnsureForActiveProtocolAsync`), `Features/Plans/PlanEndpoints.cs` (`UpdateCycleDatesAsync` → `UpdateCycles.ApplyDatesAsync`), `backend/tests/ProtocoloApp.UnitTests/ProtocoloApp.UnitTests.csproj` (link da fixture, como `schedule-cases.json`)
- Test: `backend/tests/ProtocoloApp.UnitTests/Updates/{QuestionnaireTemplateValidatorTests.cs,UpdateCyclePayloadValidatorTests.cs}`, `backend/tests/ProtocoloApp.IntegrationTests/Updates/{UpdateSyncTests.cs,UpdateCycleLifecycleTests.cs}`

**Interfaces:**
- Produces: tabelas `questionnaire_templates` (`document jsonb`, índice único `(user_id)` filtrado `deleted_at IS NULL`, `(user_id, version)` único) e `update_cycles` (`protocol_version_id` FK restrict para `plan_versions`, `period_start date`, `period_end date`, `status` texto com check, `answers jsonb`, `photos jsonb`, `sent_at`; único `(user_id, protocol_version_id)`); entidades `questionnaire_template` / `update_cycle` (contrato acima); `FillMetric.All: IReadOnlyList<string>`; `SyncErrors.TemplateConflict = "template_conflict"`.
- `UpdateCycles.EnsureForActiveProtocolAsync(AppDbContext db, Guid userId, TimeProvider clock, CancellationToken ct): Task<UpdateCycle?>` — protocolo ativo com `UpdateDate` e sem ciclo da versão → cria `collecting` com `period_start` = data local da ativação, `period_end` = `UpdateDate` (via `SyncWrites`); idempotente.
- `UpdateCycles.ApplyDatesAsync(db, PlanVersion protocol, DateOnly? updateDate, clock, ct)` — ciclo não `sent` da versão ganha o novo `period_end` (nulo: mantém); sem ciclo e com data → cria. Em linha existente, restaurar o `ClientUpdatedAt` anterior depois de `SyncWrites.StampAsync` (Review Focus 3).
- `POST /api/update-cycles/ensure` → `200 { id }` ou `204` sem protocolo com data.

- [ ] Fixture fictícia com 3 seções, uma pergunta de cada `kind`, 4 com `fill` (`diet_error_pct`, `missed_workouts`, `weight`, `checkin_notes`) e as 5 poses padrão.
- [ ] Testes do validador do modelo: fixture válida; chave repetida entre seções → `document.sections[1].questions[0].key`; `fill: "foo"` → erro; `choice` sem `options` e `text` com `options` → erro; 301 perguntas → erro; pose repetida → erro.
- [ ] Testes do payload do ciclo: `status` "done" → `status`; chave de resposta "A b" e texto de 4001 → erro; duas fotos na mesma pose → `photos`.
- [ ] Integração: round-trip do modelo; segundo modelo vivo → `template_conflict`; push de `update_cycle` com id desconhecido → `read_only`; push muda `answers`/`status` e ignora `period_end`; `file_id` de outro usuário, `Pending` ou `ProtocolPdf` → `invalid_reference`; ativação cria um ciclo (reativar não duplica); PATCH de datas muda `period_end` e uma resposta enviada depois com `clientUpdatedAt` anterior à mudança ainda é `applied`; ciclo `sent` não muda de data; `ensure` 200/204; usuário B não vê nada de A.
- [ ] Implementar. Commit `feat(atualizacao): modelo do questionário e ciclo sincronizados [migration:UpdateCycles]`; `git pull` do bot (o Codegen também regenera o `openapi.json` com o `ensure`). CI verde.

### Task 2: Back-end — métricas de adesão (puras)
**Files:**
- Create: `backend/src/ProtocoloApp.Api/Features/Updates/Metrics/{CycleWeeks.cs,AdherenceMetrics.cs,AdherenceMetricsModels.cs}`
- Test: `backend/tests/ProtocoloApp.UnitTests/Updates/AdherenceMetricsTests.cs`

**Interfaces:**
- Consumes: `DayPlan`/`DayTarget`/`DayKind` (`DayPlanner.cs`), `AdherenceLog`, `DietDeviation`, `DailyCheckin`, `CardioPlanDto`.
- Produces: `CycleWeeks.Split(DateOnly from, DateOnly to): IReadOnlyList<(int Week, DateOnly From, DateOnly To)>`; `AdherenceMetrics.Compute(AdherenceInput input): AdherenceResult` com `AdherenceInput(IReadOnlyList<(DateOnly Date, DayPlan Plan)> Days, DateOnly Today, IReadOnlyList<AdherenceLog> Logs, IReadOnlyList<DietDeviation> Deviations, IReadOnlyList<DailyCheckin> Checkins, ISet<DateOnly> WorkedOutDates, CardioPlanDto? Cardio, IReadOnlyDictionary<string,string> MealLabels)` e `AdherenceResult(DietErrorPct, DietWrongMeals, DietDeviations, MissedWorkouts, MissedCardio, ItemsMissed)` nos formatos do contrato (records em `AdherenceMetricsModels.cs`).
- Regras: dieta `planned` = refeições previstas + desvios; `done` = refeições `done`; `errorPct = round(100 × (planned − done) / planned)` (parcial e desvio são erro), `null` sem previstas. Refeição errada = `partial`/`missed`/sem marca (dia passado) + 1 por desvio; motivos pelo `reason` (sem marca → `unmarked`, desvio → `deviation`). Item não usado = `missed` ou sem marca (dia passado); `partial` não entra. Treino previsto = dias `DayKind.Training`; feito = `WorkedOutDates` (mesma regra de `workoutRepo.workedOutDates`). Cardio: `daily` → dias com alvo cardio; senão por semana do ciclo `min(sessionsPerWeek, dias com alvo)`; feito = marca `done` ou `CardioDone == true`, limitado ao previsto por semana.

- [ ] Testes (dados fictícios): ciclo vazio (Review Focus 1); 10 refeições, 7 feitas, 1 parcial, 1 desvio → `planned 11, done 7, errorPct 36`; semanas 1 e 2 separadas e semana curta no fim; hoje sem marca não conta; item com `ran_out` e outro sem marca → `reasons` `ran_out` e `unmarked`; 3 sessões/semana com 5 dias de cardio feitos → `done` = 3 na semana; dia `Off` não prevê treino.
- [ ] Implementar e rodar `dotnet test tests/ProtocoloApp.UnitTests --filter Updates` (ou CI). Commit.

### Task 3: Back-end — métricas de treino e check-in (puras)
**Files:**
- Create: `backend/src/ProtocoloApp.Api/Features/Updates/Metrics/{TrainingMetrics.cs,CheckinMetrics.cs,TrainingMetricsModels.cs}`
- Test: `backend/tests/ProtocoloApp.UnitTests/Updates/{TrainingMetricsTests.cs,CheckinMetricsTests.cs}`

**Interfaces:**
- Consumes: `WorkoutSession`, `SetLog`, `SetKind`, `Exercise`, `MuscleGroup`, `ExerciseChange`, `DailyCheckin`.
- Produces: `TrainingMetrics.StrengthChanges(IReadOnlyList<WorkoutSession> sessions, IReadOnlyList<SetLog> sets, IReadOnlyList<Exercise> exercises): IReadOnlyList<GroupStrength>` — gêmeo exato de `strengthByGroup` (`frontend/src/domain/strength.ts`): Epley `w × (1 + reps/30)`, melhor série por sessão sem `Warmup`, ≥2 sessões, `best` top 2 por delta, `worst` 2 piores entre o resto com delta < 0, grupos sem dados omitidos. `TrainingMetrics.Changes(IReadOnlyList<(DateOnly Date, Guid PlanId)> workoutActivations, IReadOnlyList<(DateOnly Date, ExerciseChange Change, string? PlannedName, string? ReplacementName)> changes): IReadOnlyList<TrainingChange>` por data. `CheckinMetrics.Compute(IReadOnlyList<DailyCheckin> checkins, decimal? waterTargetL): CheckinResult(Weight, WaterAvg, SleepAvg, EnergyAvg, AnxietyAvg, CheckinNotes)` — peso = primeiro e último `WeightKg` do período; médias só dos dias com valor; `energyAvg.wake` de `EnergyWake`, `.day` de `EnergyDay`; notas não vazias por data.

- [ ] Testes: exercício com 1 sessão → fora (lista do grupo vazia = "sem dados suficientes"); 3 grupos com valores conhecidos (mesmo caso de `strength.test.ts`, mesmos números); série `Warmup` ignorada; troca e pulo com nomes; ativação de ficha no meio do ciclo; peso de um dia só → `deltaKg 0`; sem check-ins → médias `null`, `days 0`; nota "   " ignorada.
- [ ] Implementar, testes verdes. Commit.

### Task 4: Back-end — endpoint das métricas
**Files:**
- Create: `backend/src/ProtocoloApp.Api/Features/Updates/Metrics/{UpdateMetricsLoader.cs,UpdateMetricsResponse.cs}`
- Modify: `Features/Updates/UpdateEndpoints.cs` (`GET /api/update-cycles/{id:guid}/metrics`)
- Test: `backend/tests/ProtocoloApp.IntegrationTests/Updates/UpdateMetricsTests.cs`

**Interfaces:**
- Consumes: Tasks 1–3; `DayPlanner.Build` com as versões de protocolo/ficha ativas em cada dia (mesma montagem do `ReminderScheduler.BuildDayAsync`), `PlanDocuments.TryRead<ProtocolDocument>` (`MealLabels`, `waterMinL` do guideline `water_min_l`, `Cardio`), nomes do exercício planejado pelo `PlannedExerciseKey` no documento da ficha da sessão.
- Produces: resposta exatamente no formato do contrato; `404` para ciclo de outro usuário, apagado ou inexistente. Só leitura (`AsNoTracking`), nenhum conteúdo em log.

- [ ] Integração: seed fictício via push (protocolo ativo com 2 refeições, logs, 1 desvio, 2 sessões com séries, check-ins com peso e nota) → valores esperados em `dietErrorPct.cycle`, `missedWorkouts`, `strengthChanges`, `weight`, `checkinNotes`; ciclo recém-criado → listas vazias (Review Focus 1); outro usuário → 404; nomes das propriedades conferidos no JSON cru.
- [ ] Commit `feat(atualizacao): métricas do ciclo [codegen]`; `git pull` do bot (openapi). CI verde.

### Task 5: Back-end — lembrete das fotos
**Files:**
- Modify: `Features/Push/ReminderScheduler.cs`, `Features/Push/ReminderCopy.cs`
- Test: `backend/tests/ProtocoloApp.IntegrationTests/Push/UpdateReminderTests.cs`, `backend/tests/ProtocoloApp.UnitTests/Push/ReminderCopyTests.cs` (criar se não houver)

**Interfaces:**
- Consumes: `UpdateCycle` (Task 1).
- Slot `update_photos` (claim em `reminder_sends` como os outros), uma vez por dia de D−3 a D (`period_end`), no horário do slot `checkin_morning` do tipo do dia, ou 09:00 sem ele; não envia se o ciclo está `sent`. `ReminderCopy.Update(int daysLeft): PushMessage` → título "Protocolo", corpo "Atualização em N dias: hora das fotos" / "Atualização amanhã: hora das fotos" / "Atualização hoje: hora das fotos", URL `/atualizacao`.

- [ ] Testes: D−4 não envia; D−3 no horário envia uma vez (segundo tick não repete); ciclo `sent` não envia; sem slot da manhã → 09:00; texto sem conteúdo do protocolo.
- [ ] Implementar, CI verde. Commit.

### Task 6: Front — tabelas locais, repositórios e sync
**Files:**
- Modify: `frontend/src/data/migrations.ts` (versão 8), `frontend/src/data/registry.ts`, `frontend/src/data/migrations.test.ts`
- Create: `frontend/src/domain/fillMetrics.ts`, `frontend/src/domain/questionnaireTemplate.ts` (+ teste), `frontend/src/data/{questionnaireTemplateRepo.ts,updateCycleRepo.ts,photoThumbRepo.ts}` (+ testes)

**Interfaces:**
- Produces:
  - `FILL_METRICS` (readonly, ordem do contrato) e `type FillMetric` em `domain/fillMetrics.ts`; `questionnaireTemplateSchema` (zod, limites do contrato, chaves únicas e regras de `options` via `superRefine`), `type QuestionnaireTemplate`, `DEFAULT_POSES`, `posesOf(t: QuestionnaireTemplate | null): Pose[]`, `parseTemplateJson(text: string): { ok: true; value } | { ok: false; message: string }` (mensagens pt-BR: "Arquivo não é um JSON válido.", "Chave repetida: <key>", "Métrica desconhecida: <fill>").
  - `questionnaireTemplateRepo.get(db): Promise<{ id; document: QuestionnaireTemplate } | null>`, `.save(db, document, now): Promise<string>` (cria com `newId()` ou atualiza o vivo; valida e lança `RangeError` sem texto); `questionnaireTemplateSync`.
  - `interface UpdateCycleLocal { id; protocolVersionId; periodStart; periodEnd; status: 'collecting'|'draft'|'sent'; answers: Record<string,string>; photos: { pose; fileId; takenAt }[]; sentAt: string|null; clientUpdatedAt }`; `updateCycleRepo.current(db)` (vivo de maior `period_start`), `.byId`, `.previous(db, id)`, `.setAnswer(db, id, key, text: string|null, now)` (null apaga a chave; `collecting` → `draft`), `.setPhoto(db, id, photo, now)` (substitui a pose), `.markSent(db, id, answers, now)`; `updateCycleSync` (só aplica pull; nunca cria localmente).
  - `photoThumbRepo.put(db, { fileId, cycleId, pose, dataUrl })`, `.byCycle(db, cycleId): Promise<Map<pose, thumb>>` — tabela local `update_photo_thumbs`, fora do sync e limpa no troca de usuário.
- Tabelas v8: `questionnaire_templates (id, document, client_updated_at, version, deleted_at)`, `update_cycles (id, protocol_version_id, period_start, period_end, status, answers, photos, sent_at, client_updated_at, version, deleted_at)`, `update_photo_thumbs (file_id PK, cycle_id, pose, data_url, created_at)`.

- [ ] Testes: a fixture `fixtures/questionnaire-template.example.json` (via `import.meta.glob`, como `dayPlan.test.ts`) passa no schema; casos inválidos espelham os do C# (Task 1); `setAnswer` enfileira upsert com o payload completo e muda o status; `setAnswer(null)` remove a chave; `setPhoto` mesma pose substitui; round-trip com servidor falso (padrão de `todaySync.test.ts`): servidor muda `period_end` e uma resposta pendente mais nova vence (Review Focus 3); migração 7 → 8 sem perder dados.
- [ ] `npm run lint && npm test`. Commit.

### Task 7: Front — respostas, texto e folha de impressão (puros)
**Files:**
- Create: `frontend/src/features/update/{updateMetrics.ts,fillText.ts,answers.ts,QuestionnairePrint.tsx,print.css}` (+ `fillText.test.ts`, `answers.test.ts`, `QuestionnairePrint.test.tsx`)

**Interfaces:**
- Consumes: nada da Task 6 (para rodar em paralelo): tipos estruturais locais `TemplateLike = { title; sections: { title; questions: { key; text; fill?: string | null }[] }[] }` e `metric: string` (métrica desconhecida → `""`); `REASON_LABELS` (`features/today/todayData.ts`, mais `unmarked` "Sem registro" e `deviation` "Fora do plano").
- Produces: `updateMetricsSchema` (zod do contrato) e `type UpdateMetrics`; `fillText(metric: string, m: UpdateMetrics): string` (pt-BR; exemplos fixos: `diet_error_pct` → "Ciclo: 36% de erro (7 de 11 refeições certas). Semana 1: 20% · Semana 2: 50%"; sem dados → "Sem dados no ciclo."; `strength_changes` sem tendência → "Sem dados suficientes."; `weight` → "Início 80,00 kg · fim 78,50 kg (−1,50 kg)"; datas `dd/MM`, decimais com vírgula); `resolveAnswer(q, stored: string | undefined, m: UpdateMetrics | null): { text: string; source: 'edited' | 'calculated' | 'empty' }` (guardado vence; com `fill` e métricas → calculado; senão vazio); `answersAsText(t, answers, m): string` (título, seção em maiúsculas, pergunta, resposta, linha em branco; vazia → "—"); `<QuestionnairePrint template answers metrics period />` (título, período, seções, pergunta em negrito, resposta abaixo) + `print.css` (`@media print`: só `[data-print-root]` visível, A4, quebra entre seções evitada dentro da pergunta).

- [ ] Testes: cada métrica tem texto (tabela de casos com métricas fictícias, incluindo vazias — Review Focus 1); edição vence o calculado e `source` certo; texto copiado com ordem do modelo; impressão renderiza `strong` por pergunta e o `data-print-root`.
- [ ] `npm run lint && npm test`. Commit.

### Task 8: Front — Configurações → Questionário de atualização
**Files:**
- Create: `frontend/src/features/settings/{QuestionnaireTemplatePage.tsx,QuestionEditSheet.tsx,templateFile.ts}` (+ `QuestionnaireTemplatePage.test.tsx`)
- Modify: `SettingsPage.tsx` (`ListRow to="/configuracoes/questionario" title="Questionário de atualização"`), `frontend/src/routes.tsx`

**Interfaces:**
- Consumes: `questionnaireTemplateRepo`, `parseTemplateJson`, `FILL_METRICS`, `Sheet`, `ListRow`, `Button`.
- Produces: rótulos pt-BR `FILL_LABELS: Record<FillMetric, string>` (ex.: "% de erro na dieta", "Treinos perdidos", "Notas do ciclo"); `exportTemplate(t): Blob` (`application/json`, nome `questionario-modelo.json`), `readTemplateFile(file: File): Promise<ReturnType<typeof parseTemplateJson>>`.
- Tela: sem modelo → estado vazio "Nenhum modelo ainda" com "Importar JSON"; com modelo → seções e perguntas em ordem, cada uma abre `QuestionEditSheet` (texto, tipo, opções, "Preencher com" = nenhuma ou métrica), subir/descer, poses editáveis (rótulo, ordem), "Importar JSON" (substitui depois de confirmar "Substituir o modelo atual?"), "Exportar JSON". Salva pelo repositório a cada confirmação.

- [ ] Testes: importar a fixture mostra as seções; arquivo inválido mostra a mensagem e não grava (Review Focus 4); editar texto e `fill` grava; mover pergunta muda a ordem; exportar gera JSON que reimporta igual.
- [ ] `npm run lint && npm test`. Commit.

### Task 9: Front — fila de fotos, envio, miniaturas e zip
**Files:**
- Create: `frontend/src/features/update/photos/{imageTools.ts,photoQueue.ts,photoUploader.ts,photosZip.ts}` (+ testes de cada)
- Modify: `frontend/package.json` (`fflate` 0.8.2, `fake-indexeddb` 6.0.0), `frontend/src/test/setup.ts` (só se precisar de `fake-indexeddb/auto` global; preferir importar no teste)

**Interfaces:**
- Consumes: `api` (`/api/files/upload-url` com `kind: 'photo'`, `/confirm`, `/download-url`), `updateCycleRepo.setPhoto`, `photoThumbRepo.put`.
- Produces: `toJpeg(source: Blob | HTMLCanvasElement, maxSide = 2560, quality = 0.85): Promise<Blob>`, `thumbnail(blob, maxSide = 320): Promise<string>` (data URL JPEG 0.7); `photoQueue` (IndexedDB `protocolo-photos`, store `pending`, chave = id): `.add({ id, cycleId, pose, blob, takenAt })`, `.list()`, `.remove(id)`; `uploadPending(deps: { db; api; queue; now(): Date }): Promise<{ sent: number; failed: number }>` — por item: upload-url → PUT (sem Authorization) → confirm → `setPhoto` + miniatura → `remove`; erro de rede para e mantém o resto; 4xx de validação remove o item e conta `failed`; trava contra execução dupla (`navigator.locks` como `platform/locks.ts`, senão flag em memória); `startPhotoSync(deps)` roda no início, no evento `online` e após cada `add`. `buildPhotosZip(entries: { name: string; bytes: Uint8Array }[]): Blob` (`zipSync`, `level: 0`, nomes `NN-<pose>.jpg`); `downloadCyclePhotos(cycle, api): Promise<Blob>` baixa cada foto pela URL assinada.

- [ ] Testes (imagem gerada: canvas de um retângulo colorido ou `new Blob([bytes], { type: 'image/jpeg' })`): fila sobrevive a nova instância do IndexedDB (Review Focus 2); offline (fetch rejeita) mantém tudo; sucesso chama `setPhoto` uma vez e esvazia; duas chamadas simultâneas sobem uma vez só; 400 descarta; zip reaberto com `unzipSync` tem os nomes e bytes; nenhuma chamada a `console` com dados da foto.
- [ ] `npm run lint && npm test`. Commit.

### Task 10: Front — componente de câmera
**Files:**
- Create: `frontend/src/features/update/camera/{PoseCamera.tsx,cameraSource.ts}` (+ `PoseCamera.test.tsx`)
- Modify: `frontend/src/platform/camera.ts` (se precisar de `takePhoto` nativo)

**Interfaces:**
- Produces: `type CameraSource = 'media' | 'native' | 'file'`; `pickSource(): CameraSource` (`Capacitor.isNativePlatform()` → `native`; `navigator.mediaDevices?.getUserMedia` → `media`; senão `file`); `<PoseCamera pose={{ key, label }} overlayUrl={string | null} onCapture={(blob: Blob) => void} onCancel />` — vídeo ao vivo com a foto anterior por cima a 35% (controle "Opacidade" 0–100), botão "Trocar câmera" (`facingMode` `user`/`environment`), "Temporizador 5 s" com contagem visível, "Tirar foto"; erro de permissão ou de `getUserMedia` → cai para `<input type="file" accept="image/*" capture="environment">` com o aviso "Câmera indisponível. Escolha uma foto."; no APK usa `Camera.getPhoto` (`resultType: Uri`/`DataUrl`) sem overlay ao vivo, mostrando a anterior como referência. Fecha as tracks ao sair.

- [ ] Usar o skill `frontend-design` mantendo a direção visual atual. Testes com `getUserMedia` simulado: sucesso mostra vídeo e overlay a 35%; rejeição cai para arquivo; temporizador (fake timers) captura após 5 s; trocar câmera pede o outro `facingMode`; arquivo escolhido chama `onCapture`; tracks param no unmount.
- [ ] `npm run lint && npm test`. Commit.

### Task 11: Front — tela Atualização, cartão no Hoje e menu
**Files:**
- Create: `frontend/src/features/update/{UpdatePage.tsx,PhotosStep.tsx,QuestionsStep.tsx,ReviewStep.tsx,CycleNotesSheet.tsx,UpdateCard.tsx,useUpdateCycle.ts,metricsCache.ts}` (+ `UpdatePage.test.tsx`, `UpdateCard.test.tsx`, `metricsCache.test.ts`)
- Modify: `frontend/src/routes.tsx` (`/atualizacao`), `frontend/src/app/BottomNav.tsx` (`MORE_LINKS` "Atualização"), `frontend/src/ui/Icon.tsx` (ícone `camera`), `frontend/src/features/today/TodayPage.tsx` (cartão), `npm run gen:api` (tipos do endpoint da Task 4)

**Interfaces:**
- Consumes: Tasks 4, 6, 7, 9, 10; `cycleInfo` (`domain/cycle.ts`), `dailyCheckinRepo.between`, `useData`.
- Produces: `metricsCache.get(db, cycleId): Promise<{ metrics: UpdateMetrics; fetchedAt: string } | null>`, `.put(db, cycleId, metrics, now)` (tabela `kv`, chave `update_metrics:<id>`, lido com `updateMetricsSchema`); `loadMetrics(db, api, cycleId, now)` (online: GET e grava; offline/erro: cache; nenhum: `null`); `useUpdateCycle()` (sem ciclo local e online → `POST /api/update-cycles/ensure` e sync).
- Tela (`/atualizacao`, título "Atualização", período "dd/MM a dd/MM"), etapas com abas "Fotos", "Questionário", "Revisar e enviar":
  - Fotos: checklist das poses (`posesOf`), cada uma com miniatura ou "Pendente de envio" (fila) ou "Tirar foto" → `PoseCamera` com a miniatura da mesma pose do ciclo anterior (`photoThumbRepo` / `download-url` online).
  - Questionário: seções do modelo; com `fill` → texto calculado, selo "Calculado" (`Chip`), "Recalcular" (rebusca e apaga a edição: `setAnswer(null)`); campo editável (edição salva a cada mudança com debounce 500 ms, selo some); sem `fill` → campo livre e "Ver notas do ciclo" (`CycleNotesSheet`: notas da noite do período, por data; vazio "Nenhuma nota no ciclo."). Sem modelo → "Importe o modelo em Configurações" com link.
  - Revisar e enviar: lista final (`resolveAnswer`), "Gerar PDF" (`window.print()` com `QuestionnairePrint`; oculto em plataforma nativa), "Copiar texto" (`navigator.clipboard.writeText`, toast "Texto copiado"), "Baixar fotos (.zip)" (`navigator.share({ files })` quando `canShare`, senão âncora `download`; nativo sem share → "Use o app no navegador para baixar"), "Marcar como enviada" (`markSent` com as respostas resolvidas; status "Enviada em dd/MM").
- `UpdateCard` no Hoje de D−3 até enviar (inclusive atrasado): "Atualização em N dias" / "amanhã" / "hoje" / "atrasada há N dias", "Fotos X de Y · Respostas X de Y", link "Abrir atualização".

- [ ] Testes: todo `FILL_METRICS` tem `fillText` não vazio com métricas fictícias; resposta calculada com selo e edição que prevalece (selo some, sobrevive a reload do DB); "Recalcular" volta ao calculado; offline usa o cache e mostra "Calculado em dd/MM"; sem modelo → estado vazio; notas do ciclo listadas; copiar texto chama o clipboard com `answersAsText`; nativo esconde "Gerar PDF" (Review Focus 5); cartão aparece em D−3 e some depois de enviada.
- [ ] `npm run lint && npm test && npm run build`. Commit.

### Task 12: E2E, docs e PR
**Files:** `frontend/e2e/update.spec.ts` (projeto `today` no `playwright.config.ts`, depende do protocolo ativado em `workout.spec.ts`), `README.md`/runbook (seção Atualização: importar o modelo, fotos no R2, sem IA), `CLAUDE.md` só se surgir regra nova.

- [ ] E2E: Configurações → Questionário de atualização → importar `fixtures/questionnaire-template.example.json` (`setInputFiles` com o arquivo do repo); abrir "Atualização" pelo menu; ver uma resposta com selo "Calculado"; escrever uma subjetiva; na pose "Frente", cair no arquivo e enviar um PNG gerado no teste (buffer de um retângulo feito com `zlib` em Node, nunca salvo) e ver a miniatura depois do envio ao storage stub; "Copiar texto" (permissão `clipboard-read`) contém a pergunta fictícia e a resposta escrita.
- [ ] `npm run lint`, `npm test`, `npm run build`, `npm run privacy`; push; PR "Atualização: questionário e fotos"; CI verde.

---
## Ordem e paralelismo
- **Independentes desde o início:** Tasks 1, 2, 3, 6, 7, 10 (só dependem do contrato acima). Em worktrees paralelas, usar branches `feat/atualizacao-tN` a partir de `feat/atualizacao` (o Codegen só roda em `feat/**`) e juntar na `feat/atualizacao`.
- **Depois da 1:** Task 5. **Depois de 1, 2 e 3:** Task 4. **Depois da 6:** Tasks 8 e 9 (entre si independentes).
- **Depois de 4, 6, 7, 9 e 10:** Task 11. **Por último:** Task 12.
- Só a Task 1 gera migration EF e só a Task 6 mexe em `migrations.ts`: sem conflito de snapshot entre worktrees.
