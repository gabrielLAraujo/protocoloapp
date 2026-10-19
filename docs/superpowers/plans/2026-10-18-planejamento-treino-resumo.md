# Planejamento + Treino + Resumo — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar protocolo e ficha de treino por PDF com IA, registrar treinos estilo Hevy offline e mostrar o Resumo do ciclo até a próxima atualização.

**Architecture:** O back ganha `plan_versions` (documento JSON tipado em `jsonb`) + catálogo `exercises`, um extrator que chama a API da Anthropic com tool use forçado, endpoints de importação/revisão/ativação e quatro entidades de treino no sync existente. O front espelha tudo no SQLite, calcula rotação/ciclo/e1RM em funções puras e ganha as telas Planejamento, Treino e Resumo.

**Tech Stack:** .NET 10, EF Core/Npgsql (`jsonb`), FluentValidation, `HttpClient` tipado para `https://api.anthropic.com/v1/messages`; React 19, Vite, react-hook-form + zod, SQLite local, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-planejamento-treino-resumo-design.md` (e a spec geral para sync/regras de agenda).

## Global Constraints

- Tudo de `CLAUDE.md` (inglês no código, pt-BR na UI, nada real no repo, commits `Gabriel <bfrauches@gmail.com>` sem marca do Claude, back verificado só no CI via `gh api`, `[codegen]`/`[migration:<Name>]` na mensagem do commit para gerar migration/OpenAPI).
- Branch `feat/treino`. Não fazer merge na `main`.
- Anthropic: `Anthropic:ApiKey`, `Anthropic:Model` (padrão `claude-sonnet-5-5`), `Anthropic:BaseUrl` (padrão `https://api.anthropic.com`), header `anthropic-version: 2023-06-01`, `max_tokens` 16000, timeout 90 s, 1 retry em JSON inválido/timeout. Sem chave configurada → importação responde 503 problem "Importação indisponível".
- PDF máx. 25 MB (regra de arquivos existente); só arquivos `Confirmed` do próprio usuário e `kind` `ProtocolPdf`/`WorkoutPdf`.
- Conteúdo de documentos/PDF nunca em logs.
- Faixas: `weight_kg` 0–1000 (2 casas), `reps` 0–200, `cardio_minutes` 0–300, `set_index` 0–50, `rest_seconds` 0–900.
- e1RM = `w × (1 + reps/30)` (Epley), melhor série (maior e1RM) por sessão; série `warmup` não conta.
- Grupos musculares: `chest|back|shoulders|biceps|triceps|quads|hamstrings|glutes|calves|abs|forearms|lower_back|mobility|other`.
- Rótulos pt-BR dos grupos: Peito, Costas, Ombros, Bíceps, Tríceps, Quadríceps, Posteriores, Glúteos, Panturrilhas, Abdômen, Antebraços, Lombar, Mobilidade, Outros.
- Datas "de calendário" sempre do fuso local do aparelho (`localDate()` existente), nunca `toISOString().slice(0,10)`.

## Review Focus

1. **PDF com rotação ambígua ou sem DESCANSO** → a revisão deve mostrar a rotação extraída editável e não deixar ativar com rotação vazia ou com chave de dia inexistente. Teste na Task 2 (validador) e Task 7 (UI bloqueia "Ativar").
2. **Ativar uma ficha nova no meio do ciclo** → treinos já registrados continuam visíveis no histórico e no Resumo (sessões apontam para `plan_version_id` antigo; o Resumo conta previstos por dia com a versão ativa naquele dia). Teste na Task 6 (`plannedWorkoutDays` com duas versões).
3. **Sessão iniciada e app fechado/recarregado no meio** → ao reabrir `/treino` a sessão em andamento volta com as séries marcadas. Teste na Task 8.
4. **Mesmo exercício com nomes diferentes nos PDFs** ("Supino inclinado halteres" vs "supino inclinado c/ halteres") → casar por `normalized_name` (minúsculas, sem acento, sem pontuação/"c/"/"com") para não quebrar o histórico. Teste na Task 3.
5. **Protocolo sem `updateDate`** (PDF não traz a data) → o Resumo mostra "Defina a data da próxima atualização" com atalho para a revisão, sem quebrar; a revisão permite preencher. Teste na Task 9.

---

### Task 1: Planejamento no servidor — entidades, documentos e validação

**Files:**
- Create: `backend/src/ProtocoloApp.Api/Features/Plans/{PlanVersion.cs,PlanVersionConfiguration.cs,PlanDocuments.cs,PlanDocumentValidators.cs,Exercise.cs,ExerciseConfiguration.cs,MuscleGroup.cs,ExerciseNames.cs,PlanSyncHandlers.cs}`
- Modify: `Shared/Data/AppDbContext.cs`, `Features/Sync/SyncSetup.cs` (registro), migration `PlansAndExercises`
- Test: `backend/tests/ProtocoloApp.UnitTests/Plans/{PlanDocumentValidatorTests.cs,ExerciseNamesTests.cs}`, `backend/tests/ProtocoloApp.IntegrationTests/Plans/PlanPullTests.cs`

**Interfaces:**
- Produces:
  - `enum PlanKind { Protocol, Workout }`, `enum PlanStatus { Draft, Active, Archived }` (texto).
  - `PlanVersion : ISyncEntity { Guid Id; Guid UserId; PlanKind Kind; PlanStatus Status; Guid SourceFileId; JsonDocument Document; JsonDocument? RawExtraction; string[] LowConfidence; string? ExtractionError; DateTimeOffset? ActivatedAt; ... }`
  - Records (System.Text.Json, camelCase) espelhando a spec 3.3: `ProtocolDocument`, `MealDto`, `MealItemDto`, `ProtocolItemDto`, `ScheduleDto`, `CardioPlanDto`, `GuidelineDto`, `WorkoutDocument`, `RotationDto` (`Type` = `sequence|fixed_weekdays`, `Items`, `Map`), `WorkoutDayDto`, `PlannedExerciseDto`, `PlannedSetDto`.
  - `ProtocolDocumentValidator`, `WorkoutDocumentValidator`. Workout: ≥1 dia; chaves de dia únicas; `rotation` não vazia; todo item da rotação é `off` ou chave existente; `fixed_weekdays` cobre os 7 dias; exercícios com ≥1 série; `repsMin ≤ repsMax`; `restSeconds`/`restSequence` nas faixas.
  - `Exercise : ISyncEntity { Name; NormalizedName; MuscleGroup PrimaryMuscleGroup; string[] Aliases }`, índice único (`user_id`,`normalized_name`).
  - `ExerciseNames.Normalize(string name) : string` (minúsculas, sem acento, remove pontuação e as palavras `c/`, `com`, `de`, `no`, `na`, `em`; espaços colapsados).
  - Handlers de sync `plan_version` e `exercise` **somente pull**: push → `Rejected` com `read_only`. Payload do `plan_version`: `{kind,status,document,activatedAt,lowConfidence}` (sem `rawExtraction`).

- [ ] **Step 1: Testes que falham**: validadores (rotação com chave inexistente → erro `rotation.items`; `fixed_weekdays` sem domingo → erro; repsMin>repsMax → erro; protocolo mínimo válido com `updateDate` nulo aceito); `ExerciseNames.Normalize("Supino inclinado c/ halteres") == ExerciseNames.Normalize("supino inclinado halteres")`; `PlanPullTests`: versão criada direto no banco aparece no pull sem `rawExtraction`; push de `plan_version` → `rejected` `read_only`.
- [ ] **Step 2:** push → CI vermelho (RED registrado).
- [ ] **Step 3:** Implementar; migration via `[migration:PlansAndExercises]`.
- [ ] **Step 4:** CI verde.
- [ ] **Step 5: Commit** `feat(plans): plan versions, exercise catalog and document validation`

### Task 2: Extrator de PDF com a API da Anthropic

**Files:**
- Create: `Features/Plans/Extraction/{AnthropicOptions.cs,AnthropicClient.cs,PlanExtractor.cs,ExtractionPrompts.cs,ExtractionSchemas.cs,PlanExtractionResult.cs}`
- Test: `UnitTests/Plans/PlanExtractorTests.cs` + fixtures fictícias `tests/.../Fixtures/anthropic-protocol-response.json`, `anthropic-workout-response.json`, `anthropic-invalid-response.json`

**Interfaces:**
- Consumes: documentos e validadores (Task 1).
- Produces:
  - `IPlanExtractor.ExtractAsync(PlanKind kind, Stream pdf, IReadOnlyList<ExerciseHint> knownExercises, CancellationToken ct) : Task<PlanExtractionResult>`
  - `PlanExtractionResult(JsonDocument? Document, JsonDocument? Raw, IReadOnlyList<string> LowConfidence, IReadOnlyList<NewExerciseSuggestion> NewExercises, string? Error)`; `NewExerciseSuggestion(string Name, MuscleGroup Group)`; `ExerciseHint(Guid Id, string Name, MuscleGroup Group)`.
- Request: `POST {BaseUrl}/v1/messages`, `x-api-key`, `anthropic-version`, body com `model`, `max_tokens`, `tools: [{ name: "submit_protocol" | "submit_workout", input_schema }]`, `tool_choice: { type: "tool", name }`, mensagem do usuário com bloco `{ type: "document", source: { type: "base64", media_type: "application/pdf", data } }` + texto do prompt (pt-BR, instruções: copiar doses como texto literal, não inventar valores, marcar em `lowConfidence` os caminhos incertos, rotação conforme o PDF — DESCANSO vira `off` —, usar `exerciseId` de `knownExercises` quando o nome casar, senão `newExercises` com grupo sugerido).
- Resultado: lê o primeiro bloco `tool_use`, desserializa e valida; inválido ou timeout → 1 nova tentativa; segunda falha → `Error` = `invalid_extraction` | `timeout` | `unavailable`.

- [ ] **Step 1: Testes que falham** com `HttpMessageHandler` falso: resposta válida → documento + lowConfidence; primeira inválida e segunda válida → sucesso com 2 chamadas; duas inválidas → `Error == "invalid_extraction"`; timeout (handler que atrasa além de um timeout de teste injetado) → `Error == "timeout"`; request enviado contém `tool_choice.name == "submit_workout"` e o PDF em base64; chave ausente → `Error == "unavailable"` sem chamada HTTP.
- [ ] **Step 2:** CI vermelho. **Step 3:** Implementar (timeout por `CancellationTokenSource.CancelAfter`, injetável). **Step 4:** CI verde.
- [ ] **Step 5: Commit** `feat(plans): pdf extraction via anthropic tool use`

### Task 3: Endpoints de importação, revisão e ativação

**Files:**
- Create: `Features/Plans/{PlanEndpoints.cs,PlanContracts.cs,PlanDiff.cs,PlanActivation.cs,ExerciseEndpoints.cs,PlansSetup.cs}`
- Test: `IntegrationTests/Plans/{PlanImportTests.cs,PlanActivationTests.cs,PlanDiffTests.cs,ExerciseEndpointTests.cs}` (extrator falso registrado no `ApiFactory`)

**Interfaces:**
- Consumes: Task 1, Task 2, `IFileStorage` (ler objeto: acrescentar `Task<Stream> OpenReadAsync(string key, CancellationToken)` ao `IFileStorage`, R2 e fake).
- Produces (rotas no grupo protegido `/api`):
  - `POST /api/plans/import` `ImportPlanRequest(Guid FileId, PlanKind Kind)` → 201 `PlanVersionResponse`
  - `GET /api/plans/{id}` → `PlanVersionResponse(Guid Id, PlanKind Kind, PlanStatus Status, JsonElement Document, IReadOnlyList<string> LowConfidence, string? ExtractionError, IReadOnlyList<NewExerciseSuggestion> NewExercises, PlanDiffDto? Diff, DateTimeOffset? ActivatedAt, Guid SourceFileId)`
  - `PUT /api/plans/{id}` `UpdatePlanRequest(JsonElement Document, IReadOnlyList<NewExerciseSuggestion>? NewExercises)` → 200 (só draft; senão 409)
  - `POST /api/plans/{id}/activate` `ActivatePlanRequest(DateOnly? CycleStart)` → 200; cria exercícios novos (casando por `normalized_name`), troca nomes de `newExercises` por `exerciseId` no documento, arquiva o ativo anterior do mesmo kind, bumpa versões de sync. Idempotente (ativar o ativo → 200 sem mudança).
  - `GET /api/plans?kind=&status=` → `IReadOnlyList<PlanVersionSummary>`
  - `GET /api/exercises`, `PUT /api/exercises/{id}` `UpdateExerciseRequest(MuscleGroup Group, string[] Aliases)`
  - `PlanDiff.Compute(JsonElement? active, JsonElement draft) : PlanDiffDto` — por chave (`meals[].key`, `items[].key`, `days[].key`, `days[].exercises[].key`): `Added`, `Removed`, `Changed` (lista de `{path, before, after}`).
  - `PlanVersion.ActivatedAt` do protocolo = `CycleStart` (meia-noite local `America/Sao_Paulo` → UTC) ou agora.
- Erros: arquivo de outro usuário/inexistente → 404; kind de arquivo incompatível → 400; extrator `unavailable` → 503 "Importação indisponível"; extração com erro → 201 com `ExtractionError` e documento vazio do kind (rascunho preenchível).

- [ ] **Step 1: Testes que falham:** import cria draft com documento do extrator falso; import com erro do extrator → draft com `extractionError`; PUT em ativo → 409; activate arquiva o anterior e garante 1 ativo por kind (consulta direta); activate 2× idempotente; activate cria exercício novo e reaproveita existente por nome normalizado ("Supino Inclinado C/ Halteres" casa com "supino inclinado halteres"); diff detecta exercício adicionado/removido e alteração de `sets`; arquivo de outro usuário → 404; `RouteProtectionTests` continua verde.
- [ ] **Step 2–4:** RED no CI → implementar (`[codegen]`) → GREEN.
- [ ] **Step 5: Commit** `feat(plans): import, review and activation endpoints`

### Task 4: Entidades de treino no sync + cardio no check-in

**Files:**
- Create: `Features/Workouts/{WorkoutSession.cs,SetLog.cs,ExerciseChange.cs,RotationOverride.cs,*Configuration.cs,*Payload.cs,*SyncHandler.cs}`
- Modify: `Features/DailyCheckins/{DailyCheckin.cs,DailyCheckinPayload.cs,DailyCheckinConfiguration.cs,DailyCheckinSyncHandler.cs}`, `Features/Sync/SyncHandler.cs` (hook `protected virtual Task<string?> ValidateReferencesAsync(TEntity entity, Guid userId, CancellationToken ct)` chamado antes de `FindConflictAsync`), migration `WorkoutLogging`
- Test: `IntegrationTests/Workouts/{WorkoutSyncTests.cs}`, `IntegrationTests/Sync/*` existentes verdes

**Interfaces:**
- Produces (entidades sync; payload snake_case como `daily_checkin`):
  - `workout_session`: `date` (yyyy-MM-dd), `plan_version_id`, `workout_day_key`, `started_at`, `ended_at?`, `note?` (≤2000)
  - `set_log`: `session_id`, `exercise_id`, `planned_exercise_key?`, `set_index`, `weight_kg`, `reps`, `kind` (`normal|drop|partial|rest_pause|warmup`), `parent_set_id?`, `completed_at`
  - `exercise_change`: `session_id`, `planned_exercise_key`, `action` (`swapped|skipped`), `replacement_exercise_id?` (obrigatório se `swapped`), `note?`
  - `rotation_override`: `date`, `workout_day_key` (chave ou `off`); único por (`user_id`,`date`) entre não apagados → `date_conflict`
  - `daily_checkin` + `cardio_done` (bool?), `cardio_minutes` (int? 0–300; exige `cardio_done == true`)
  - Erros novos: `invalid_reference` (sessão/exercício/plano/set pai de outro usuário ou inexistente).
- [ ] **Step 1: Testes que falham:** push de sessão + 3 séries em um lote → todas `applied`, pull devolve na ordem de versão; série com `session_id` de outro usuário → `invalid_reference`; série antes da sessão no mesmo lote mas sessão em lote posterior → `invalid_reference` (cliente envia em ordem — documentar); `swapped` sem `replacement_exercise_id` → `invalid_payload:replacement_exercise_id`; override duplicado na mesma data com outro id → `date_conflict`; check-in com `cardio_minutes` e `cardio_done=false` → `invalid_payload:cardio_minutes`; check-in antigo sem os campos novos continua válido.
- [ ] **Step 2–4:** RED → implementar (`[migration:WorkoutLogging]`) → GREEN.
- [ ] **Step 5: Commit** `feat(workouts): sync entities for sessions, sets, changes and overrides; cardio on checkin`

### Task 5: Banco local e adaptadores no front

**Files:**
- Modify: `frontend/src/data/{migrations.ts,registry.ts,dailyCheckinRepo.ts}`, `frontend/src/features/checkin/{checkinSchema.ts,DailyCheckinPage.tsx}`
- Create: `frontend/src/data/{planRepo.ts,exerciseRepo.ts,workoutRepo.ts,rotationOverrideRepo.ts}`
- Test: `frontend/src/data/{planRepo.test.ts,workoutRepo.test.ts,rotationOverrideRepo.test.ts}`, `migrations.test.ts`, `DailyCheckinPage.test.tsx`

**Interfaces:**
- Consumes: `schema.d.ts` regenerado (Tasks 1–4), `SyncEntityAdapter`, `outbox`, `nextClientUpdatedAt`, `localChangeWins`.
- Produces:
  - Migration local 2: tabelas `plan_versions(id, kind, status, document TEXT, low_confidence TEXT, activated_at, client_updated_at)`, `exercises(id, name, normalized_name, primary_muscle_group, aliases TEXT)`, `workout_sessions`, `set_logs`, `exercise_changes`, `rotation_overrides`, colunas `cardio_done`, `cardio_minutes` em `daily_checkins`. Reaplicar `sync_unknown` para as entidades novas após migrar.
  - `planRepo.getActive(db, kind): Promise<PlanVersionLocal | null>`, `planRepo.list(db, kind)`, adaptador só-pull `planVersionSync`.
  - `exerciseRepo.all(db): Promise<ExerciseLocal[]>`, `exerciseRepo.byId(db, id)`, adaptador `exerciseSync`.
  - `workoutRepo.startSession(db, userId, {date, planVersionId, dayKey}, now): Promise<string>`, `workoutRepo.logSet(db, userId, input: SetInput, now): Promise<string>`, `workoutRepo.updateSet`, `workoutRepo.deleteSet`, `workoutRepo.recordChange(db, userId, input, now)`, `workoutRepo.finishSession(db, userId, sessionId, now)`, `workoutRepo.openSession(db): Promise<SessionLocal | null>` (sem `ended_at`), `workoutRepo.sessionsBetween(db, from, to)`, `workoutRepo.setsForSession(db, id)`, `workoutRepo.setsForExercise(db, exerciseId, limit)`, adaptadores para as 3 entidades. Cada escrita grava linha + outbox na mesma transação; outbox de sessão sempre antes das séries (seq).
  - `rotationOverrideRepo.set(db, userId, date, dayKey, now)` (id determinístico UUIDv5 `${userId}:rotation_override:${date}`), `rotationOverrideRepo.between(db, from, to)`.
  - Check-in: campos "Cardio feito?" (Sim/Não) e "Minutos de cardio" (só quando Sim, 0–300, mensagem "Máximo 300 min").
- [ ] **Step 1: Testes que falham:** migração 1→2 preserva check-ins; pull de `plan_version` grava e `getActive('workout')` devolve o ativo; logar sessão + 2 séries enfileira 3 entradas com a sessão primeiro; `openSession` acha sessão sem `ended_at`; override com mesmo dia gera mesmo id; check-in salva cardio.
- [ ] **Step 2–4:** `npm test` RED → implementar → GREEN; `npm run lint`.
- [ ] **Step 5: Commit** `feat(data): local tables and repositories for plans and workouts; cardio on checkin`

### Task 6: Domínio do treino e do ciclo (funções puras)

**Files:**
- Create: `frontend/src/domain/{rotation.ts,cycle.ts,strength.ts,restTimer.ts}` + `*.test.ts`

**Interfaces:**
- Produces:
  - `resolveDay(date: string, plan: WorkoutPlanAt[], overrides: RotationOverride[]): { kind: 'workout'; dayKey: string; planVersionId: string } | { kind: 'off' } | { kind: 'none' }` — `WorkoutPlanAt = { planVersionId, activatedOn: string /*local date*/, rotation }`; usa a versão ativa naquele dia (maior `activatedOn ≤ date`); `sequence`: índice = dias desde a âncora, onde a âncora é o override mais recente ≤ date (posição do seu `dayKey` na sequência) ou `activatedOn` (posição 0); `fixed_weekdays`: pelo dia da semana local.
  - `plannedWorkoutDays(from, to, plans, overrides): string[]` (datas com `kind === 'workout'`).
  - `cycleInfo(protocol: {activatedOn: string, updateDate: string | null, billingDate: string | null}, today: string): { start; end: string | null; daysLeft: number | null; elapsedRatio: number | null; billingDate }`.
  - `e1rm(weightKg, reps): number` (Epley; reps 0 → 0); `bestSet(sets: SetLog[]): SetLog | null` (ignora `warmup`); `sessionPRs(current: SetLog[], history: SetLog[]): PR[]` (`maxWeight` e `maxE1rm` por exercício); `strengthByGroup(sessions, sets, exercises, from, to): Record<MuscleGroup, {best: Trend[], worst: Trend[]}>` (Δ e1RM entre a primeira e a última sessão do ciclo, mín. 2 sessões, top 2/bottom 2).
  - `createRestTimer({ durations: number[], now: () => number }): RestTimer` com `start()`, `addSeconds(15)`, `skip()`, `remaining(): number`, `isDone(): boolean`, `next()` (avança na `restSequence`); estado serializável (`toJSON`/`fromJSON`) para sobreviver a reload.
- [ ] **Step 1: Testes que falham (com valores):** sequência `["A","B","C","off","D","E","F","off"]` ativada em 2026-10-20 → 2026-10-20=A, 2026-10-23=off, 2026-10-28=A; override 2026-10-22="E" → 2026-10-22=E, 2026-10-23=F, 2026-10-24=off, 2026-10-25=A; `fixed_weekdays` segunda=A; duas versões (nova ativada 2026-11-01) → datas antes usam a antiga (Review Focus 2); `plannedWorkoutDays` 2026-10-20..2026-10-27 = 6 dias; `cycleInfo` com `updateDate` null → `daysLeft` null (Review Focus 5); `e1rm(100, 10) ≈ 133.33`; warmup ignorado; strength com 1 sessão → "sem dados"; timer 90 s: após 30 s `remaining()==60`, `addSeconds(15)` → 75, `fromJSON(toJSON())` preserva; sequência SST `[45,30,15,5,5,15,30,45]` avança.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(domain): rotation, cycle, strength and rest timer`

### Task 7: Tela Planejamento (upload, revisão, ativação, protocolo)

**Files:**
- Create: `frontend/src/features/plans/{PlansPage.tsx,PlanReviewPage.tsx,ProtocolView.tsx,WorkoutPlanEditor.tsx,ProtocolEditor.tsx,DiffList.tsx,uploadPdf.ts}` + testes
- Modify: `frontend/src/routes.tsx`, `frontend/src/app/AppShell.tsx` (navegação inferior — ver Task 9)

**Interfaces:**
- Consumes: `api` (rotas da Task 3, `/api/files/*`), `planRepo`, `exerciseRepo`, `useData()`.
- Produces: rotas `/planejamento`, `/planejamento/revisao/:id`, `/planejamento/protocolo`.
  - `uploadPdf(kind: 'protocol' | 'workout', file: File): Promise<string /*planVersionId*/>` (upload-url → PUT com `Content-Type` → confirm → import).
- UI (pt-BR): cards "Protocolo" e "Treino" (fase, "Atualização em DD/MM", "Ativo desde DD/MM"), botão "Enviar novo PDF" (aceita `application/pdf`), estado "Lendo o PDF…" (até 90 s, com aviso de que pode demorar), erros: "Não consegui ler esse PDF. Você pode preencher à mão." / "Importação indisponível no momento.". Revisão: `DiffList` (+ verde, − vermelho, ~ âmbar), campos editáveis (react-hook-form + zod espelhando os validadores), destaque âmbar para `lowConfidence` com rótulo "Confira", seletor de grupo para exercícios novos, editor de rotação (lista ordenada de chaves + "Descanso"), (protocolo) data de início do ciclo, `updateDate`, `billingDate`. Botão "Ativar" desabilitado com mensagem enquanto inválido (Review Focus 1). Requer conexão: offline → "Conecte-se à internet para importar".
- [ ] **Step 1: Testes que falham:** upload chama as 4 rotas em ordem; revisão mostra diff e destaque "Confira"; rotação com dia inexistente → "Ativar" desabilitado e mensagem "A rotação usa um dia que não existe"; ativar chama `/activate` e dispara `syncNow`; offline mostra a mensagem.
- [ ] **Step 2–4:** RED → GREEN; lint.
- [ ] **Step 5: Commit** `feat(plans): planning screens with pdf upload, review and activation`

### Task 8: Tela Treino (sessão, timer, histórico)

**Files:**
- Create: `frontend/src/features/workout/{WorkoutTodayPage.tsx,SessionView.tsx,ExerciseCard.tsx,SetRow.tsx,RestTimerBar.tsx,SwapExerciseDialog.tsx,FinishSummary.tsx,HistoryPage.tsx,ExerciseHistoryPage.tsx,E1rmChart.tsx,useActiveSession.ts}` + testes
- Modify: `frontend/src/routes.tsx`

**Interfaces:**
- Consumes: `resolveDay`, `createRestTimer`, `e1rm`, `sessionPRs` (Task 6); `workoutRepo`, `rotationOverrideRepo`, `planRepo`, `exerciseRepo` (Task 5).
- Produces: rotas `/treino`, `/treino/historico`, `/treino/exercicio/:id`.
- UI: cabeçalho "Treino B — Peito, ombros e abdômen" ou "Hoje é descanso"; "Trocar o treino de hoje" (lista de dias + Descanso → override); "Começar treino". Por exercício: nome, técnica, descanso, "Última vez: 80 kg × 10 · 80 × 9", linhas das séries planejadas ("15–20 reps", "+ drop"), inputs carga (decimal com vírgula) e reps, tipo (Normal/Drop/Parcial/Aquecimento), ✓. ✓ salva a série e inicia o timer (barra fixa no rodapé acima da navegação: "Descanso 01:30", +15 s, Pular; `navigator.vibrate([200,100,200])` ao zerar; ao voltar de segundo plano mostra o restante correto). "Trocar exercício" (busca no catálogo) e "Pular exercício" com nota opcional. "Finalizar treino" → resumo: duração, volume (kg) por grupo, recordes ("Novo recorde: Leg 45 — 200 kg") → "Concluir". Sessão aberta e timer persistidos (timer em `localStorage` com try/catch; sessão no SQLite) (Review Focus 3). Sem ficha ativa → estado vazio com atalho para Planejamento. Histórico: lista por data com dia e volume; exercício: tabela de sessões e gráfico SVG simples de e1RM (sem biblioteca de gráficos).
- [ ] **Step 1: Testes que falham:** dia de descanso mostra "Hoje é descanso"; override troca o treino exibido; marcar série grava `set_log` e mostra timer 01:30 para `restSeconds: 90`; reload no meio restaura sessão aberta e séries marcadas; pular exercício grava `exercise_change`; finalizar mostra recorde quando supera histórico; "Última vez" vem da sessão anterior do mesmo exercício.
- [ ] **Step 2–4:** RED → GREEN; lint.
- [ ] **Step 5: Commit** `feat(workout): session logging with rest timer, history and records`

### Task 9: Resumo do ciclo e navegação

**Files:**
- Create: `frontend/src/features/summary/{SummaryPage.tsx,CycleTimeline.tsx,CycleCalendar.tsx,StatCard.tsx,WeightSparkline.tsx,StrengthByGroup.tsx,summaryData.ts}` + testes; `frontend/src/app/BottomNav.tsx`
- Modify: `frontend/src/routes.tsx` (`/` → Resumo; check-in em `/checkin`), `AppShell.tsx` (BottomNav: Resumo, Treino, Check-in, Planejamento; Diagnóstico vai para um menu "Mais" junto com Sair)

**Interfaces:**
- Consumes: `cycleInfo`, `plannedWorkoutDays`, `strengthByGroup` (Task 6); repos (Task 5); `dailyCheckinRepo` (lista entre datas — acrescentar `between(db, from, to)` se não existir).
- Produces: `buildSummary(input: SummaryInput, today: string): SummaryData` em `summaryData.ts` (puro): `cycle`, `calendar: {date, state: 'done'|'missed'|'rest'|'future'|'today', cardio: boolean}[]`, `workouts: {done, planned}` (até hoje), `cardio: {done, planned}` (`sessionsPerWeek` × semanas decorridas, arredondado para baixo; `daily` = dias decorridos), médias (1 casa) de sono, disposição ao acordar, disposição no dia, ansiedade, água vs meta, série de peso, `strength`.
- UI: linha do tempo horizontal (início → atualização, marcador "Hoje"), "Faltam N dias para a atualização", "Mensalidade em DD/MM"; calendário em grade semanal (seg–dom) com legenda e cores acessíveis (não só cor: ícone ✓/✗); cartões; força por grupo (rótulos pt-BR). Sem protocolo ativo → "Importe o protocolo para ver o ciclo" (atalho). Protocolo sem `updateDate` → "Defina a data da próxima atualização" com atalho para a revisão (Review Focus 5).
- [ ] **Step 1: Testes que falham:** `buildSummary` com ciclo 2026-10-20..2026-11-15, hoje 2026-10-27, 4 sessões feitas em dias de treino → `workouts {done:4, planned:6}`, dia de treino passado sem sessão = `missed`, `daysLeft 19`; cardio diário com 5 dias feitos → `{done:5, planned:8}`; médias corretas; página sem protocolo mostra o atalho; sem `updateDate` mostra a mensagem; BottomNav navega.
- [ ] **Step 2–4:** RED → GREEN; lint; build.
- [ ] **Step 5: Commit** `feat(summary): cycle summary with timeline, calendar and stats; bottom navigation`

### Task 10: E2E, stub da IA e docs

**Files:**
- Create: `frontend/e2e/workout.spec.ts`, `e2e/fixtures/{ficha-ficticia.pdf (gerada por script),anthropic-stub.mjs}`, `frontend/scripts/make-fixture-pdf.mjs`
- Modify: `.github/workflows/ci.yml` (job e2e: sobe o stub e define `Anthropic__BaseUrl`, `Anthropic__ApiKey=test`), `docs/runbooks/deploy-coolify.md` (variáveis `Anthropic__*`), `README.md`, spec geral (tabela de subprojetos: 2 e 4 entregues)

**Interfaces:**
- Consumes: tudo acima. O stub responde `POST /v1/messages` com o `tool_use` fictício conforme `tool_choice.name`.
- [ ] **Step 1: Teste e2e:** login → Planejamento → enviar ficha fictícia → revisão → Ativar → Treino mostra o dia A → offline → registrar 2 séries → finalizar → online → "Sincronizado" → Resumo mostra "1" treino feito e o dia marcado como feito.
- [ ] **Step 2:** CI verde (incluindo os jobs existentes), e2e 2× seguidas.
- [ ] **Step 3: Commit** `test(e2e): import a workout plan, log a session offline and see it in the summary` e abrir PR `feat/treino` → `main` (sem merge).
