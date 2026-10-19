# Hoje + Lembretes + Acabamento — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela Hoje com marcação do protocolo, lembretes Web Push do servidor nos horários do usuário e um pass de acabamento visual.

**Architecture:** Duas entidades novas no sync (`schedule_slot`, `adherence_log`); regras de "o que vale hoje" implementadas em TS e C# e amarradas por uma fixture JSON compartilhada; um `BackgroundService` envia Web Push (VAPID gerado e guardado pelo servidor) para os alvos sem marcação; o service worker passa a `injectManifest` com handlers de push.

**Tech Stack:** .NET 10, EF Core, NuGet `WebPush` (web-push-libs), `BackgroundService` + `TimeProvider`; React 19, vite-plugin-pwa `injectManifest` + workbox-precaching, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-hoje-lembretes-design.md`

## Global Constraints
- Tudo de `CLAUDE.md`. Branch `feat/hoje` (base `feat/treino`); PR com base `feat/treino`; não fazer merge.
- Fuso dos lembretes e de "hoje" no servidor: `America/Sao_Paulo` (fixo UTC−3, Brasil sem horário de verão; usar `TimeZoneInfo` se disponível na imagem `aspnet:10.0`, que tem tzdata).
- Conteúdo de push sem doses nem nomes de compostos: só rótulos ("REF 2 — 12:30", "Itens em jejum", "Itens antes de dormir", "Hora do cardio", "Hora do treino", "Check-in do dia").
- Slots: `meal_<n>` (um por refeição do protocolo, pela `key` da refeição), `pre_workout`, `intra_workout`, `post_workout`, `fasting`, `after_meal`, `before_bed`, `cardio`, `workout`, `checkin`. Itens do protocolo entram no slot do seu `timing` (`with_meal:<key>` → `meal_<key>`; `any` → sem horário).
- Padrões de horário na primeira vez: `meal_k` = 07:00 + 3 h × (posição−1); `fasting` 06:30; `cardio` 07:30; `pre_workout` 17:30; `workout` 18:00; `post_workout` 19:30; `checkin` 21:30; `before_bed` 22:30; lembretes ligados em todos.
- Motivos: `no_appetite` (Sem fome), `no_time` (Sem tempo), `felt_sick` (Passou mal), `free_meal` (Refeição livre), `other` (Outro).
- Migrations só aditivas (servidor e aparelho).

## Review Focus
1. **Lembrete duplicado** (dois servidores/reinício no mesmo minuto) → um push só: `reminder_sends` com índice único e insert-antes-de-enviar. Teste na Task 4.
2. **Inscrição expirada** (iOS revoga) → 404/410 remove a inscrição, sem erro em loop. Teste na Task 4.
3. **Item marcado em outro aparelho pouco antes do horário** → não envia se o `adherence_log` já existe no servidor. Teste na Task 4.
4. **Dia de treino vs descanso muda por troca de treino** → os slots usam o `day_type` resolvido com overrides (mesma regra do cliente). Teste na Task 3 (fixture compartilhada).
5. **Atualização do SW com push** → o banner "Nova versão" continua funcionando com `injectManifest`. Teste na Task 6.

---

### Task 1: Pendência do PR #3 — overrides do Resumo
**Files:** Modify `frontend/src/features/summary/SummaryPage.tsx` (~46); Test `SummaryPage.test.tsx`.
- [ ] Teste: override `off` antes do início do ciclo do protocolo (mas depois da ativação da ficha) → calendário do Resumo igual ao `/treino` para o dia seguinte.
- [ ] Carregar overrides desde a menor `activatedOn` das fichas (ou `0000-01-01`). Lint/test/build; commit `fix(summary): load rotation overrides since the first workout activation`.

### Task 2: Entidades `schedule_slot` e `adherence_log` no servidor
**Files:** `backend/src/ProtocoloApp.Api/Features/Today/{ScheduleSlot.cs,AdherenceLog.cs,*Configuration.cs,*Payload.cs,*SyncHandler.cs}`, migration `TodayEntities`; Test `IntegrationTests/Today/TodaySyncTests.cs`.
**Interfaces:** payloads snake_case — `schedule_slot`: `slot`, `day_type` (`training|off`), `time` (`HH:mm`), `reminder_enabled`; único (`user_id`,`slot`,`day_type`) → `date_conflict`-like código `slot_conflict`. `adherence_log`: `date`, `target_type` (`meal|protocol_item|cardio|workout|checkin`), `target_key` (≤64), `status` (`done|partial|missed`), `reason?` (lista dos motivos), `note?` (≤500); único (`user_id`,`date`,`target_type`,`target_key`) → `slot_conflict`.
- [ ] Testes: lote com 3 slots aplicado e puxado; horário `25:00` → `invalid_payload:time`; duplicado com outro id → `slot_conflict`; adherence com motivo inválido → `invalid_payload:reason`.
- [ ] Implementar (`[migration:TodayEntities]`), CI verde, commit.

### Task 3: Regras do dia em C# + fixture compartilhada
**Files:** `backend/src/ProtocoloApp.Api/Features/Today/DayPlanner.cs`; fixture `fixtures/schedule-cases.json` na raiz do repo (lida pelos testes do back e do front); Test `UnitTests/Today/DayPlannerTests.cs`.
**Interfaces:** `DayPlanner.Build(DateOnly date, ProtocolDocument? protocol, IReadOnlyList<WorkoutPlanAt> workouts, IReadOnlyList<RotationOverrideRow> overrides, IReadOnlyList<ScheduleSlotRow> slots) : DayPlan` com `DayType` (`Training|Off|None`), `WorkoutDayKey?`, `Targets: IReadOnlyList<DayTarget(TargetType Type, string Key, string Label, string? SlotKey, TimeOnly? Time, bool ReminderEnabled)>`. Rotação idêntica a `frontend/src/domain/rotation.ts` (incluindo a semântica de override `off` e ocorrência mais próxima). Frequências: `daily`, `weekdays`, `every_n_days` (âncora), `training_days_only`, `off_days_only`. Cardio: `daily` → todo dia; `sessionsPerWeek` → todo dia com rótulo "Cardio" (meta semanal no Resumo).
- [ ] Fixture com ≥12 casos (rotação simples, override workout, override off, fixed_weekdays, every_n_days, training_days_only em dia off, item with_meal, sem protocolo, sem ficha).
- [ ] Testes RED → implementar → GREEN no CI; commit.

### Task 4: Push no servidor (VAPID, inscrições, agendador)
**Files:** `Features/Push/{AppSecret.cs,VapidKeys.cs,PushSubscription.cs,PushEndpoints.cs,PushSender.cs,ReminderScheduler.cs,ReminderSend.cs,*Configuration.cs}`, migration `PushAndReminders`; Tests `IntegrationTests/Push/{PushEndpointTests.cs,ReminderSchedulerTests.cs}`.
**Interfaces:**
- `VapidKeys.GetOrCreateAsync(db, ct) : (string PublicKey, string PrivateKey)` — gera com `VapidHelper.GenerateVapidKeys()` e grava em `app_secrets` na primeira vez (concorrência: insert com conflito ignorado e releitura). Subject `mailto:` de `Push:Subject` (padrão `mailto:admin@frauchesgabriel.work`).
- `GET /api/push/public-key` → `{ publicKey }`; `POST /api/push/subscribe` `{ endpoint, keys: { p256dh, auth }, userAgent? }` (upsert por endpoint, reatribui ao usuário atual); `DELETE /api/push/subscribe` `{ endpoint }`; `POST /api/push/test` → envia "Lembretes ativados ✓".
- `IPushSender.SendAsync(PushSubscription s, PushMessage m, ct) : Task<PushResult>` (`Sent|Gone|Failed`); implementação com `WebPushClient`; fake nos testes.
- `ReminderScheduler : BackgroundService` — tick a cada 60 s via `TimeProvider`; `RunOnceAsync(DateTimeOffset now, ct)` público para testes: para cada usuário com inscrição, monta o dia (Task 3) do dia local, escolhe alvos com `ReminderEnabled`, `Time` no minuto `now` (local) ou até 2 min atrás (tolerância de atraso), sem `adherence_log`; agrupa por slot (um push por slot); insere `reminder_sends` (único user+date+slot) antes de enviar — conflito = já enviado; envia para todas as inscrições do usuário; `Gone` remove inscrição; `Failed` incrementa `failure_count` (≥5 remove). Payload JSON `{ title, body, url: "/hoje", tag: slotKey }`.
- [ ] Testes: primeira chamada de public-key cria e as seguintes devolvem a mesma; subscribe de outro usuário com o mesmo endpoint reatribui; scheduler às 12:30 envia "REF 2 — 12:30" uma vez e a segunda execução no mesmo minuto não envia; alvo com adherence não envia; `Gone` remove; desligado (`reminder_enabled=false`) não envia; conteúdo sem `doseText`.
- [ ] Implementar (`[migration:PushAndReminders]`), CI verde, commit.

### Task 5: Dados e regras do dia no front
**Files:** `frontend/src/data/{scheduleRepo.ts,adherenceRepo.ts,migrations.ts,registry.ts}`, `frontend/src/domain/dayPlan.ts`; Tests correspondentes + `dayPlan.test.ts` lendo `fixtures/schedule-cases.json`.
**Interfaces:** `buildDay(date, protocol, workoutPlans, overrides, slots): DayPlan` (mesma forma da Task 3, camelCase); `scheduleRepo.all(db)`, `scheduleRepo.ensureDefaults(db, userId, protocol, now)` (cria os padrões só para slots ausentes), `scheduleRepo.set(db, userId, slot, dayType, {time, reminderEnabled}, now)` (id UUIDv5 `${userId}:schedule:${slot}:${dayType}`); `adherenceRepo.mark(db, userId, {date, targetType, targetKey, status, reason?, note?}, now)` (id UUIDv5 da spec), `adherenceRepo.clear(...)`, `adherenceRepo.between(db, from, to)`. Migration local 4 aditiva.
- [ ] Testes (fixture compartilhada passa igual ao C#; repos atômicos; ids determinísticos), implementar, commit.

### Task 6: Service worker com push, Configurações e Horários
**Files:** `frontend/src/sw.ts`, `frontend/vite.config.ts` (`strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`), `frontend/src/pwa/{push.ts,serviceWorker.ts}`, `frontend/src/features/settings/{SettingsPage.tsx,SchedulePage.tsx,RemindersCard.tsx}`; Tests.
**Interfaces:** `sw.ts`: `precacheAndRoute(self.__WB_MANIFEST)`, `cleanupOutdatedCaches()`, navigation fallback com o mesmo denylist atual, mensagem `SKIP_WAITING` para o botão "Atualizar", `push` → `showNotification(title, { body, tag, data: { url }, icon: '/pwa-192x192.png', badge })`, `notificationclick` → foca/abre `url`. `push.ts`: `pushSupport(): 'unsupported' | 'needs-install' | 'denied' | 'default' | 'granted'`, `enableReminders(): Promise<void>` (pede permissão, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, POST subscribe), `disableReminders()`, `sendTest()`.
- UI pt-BR: Configurações (Lembretes: estado — "Instale na Tela de Início para ativar", "Lembretes ativados", "Permissão negada nos Ajustes do iPhone"; botões "Ativar lembretes", "Enviar teste", "Desativar"; links Horários e Diagnóstico). Horários: lista por slot (rótulos: REF n pelo label da refeição, "Em jejum", "Pré-treino", "Pós-treino", "Antes de dormir", "Cardio", "Treino", "Check-in") com hora (input `time`) e lembrete on/off, separada em "Dia de treino" e "Descanso", "Copiar do dia de treino".
- [ ] Testes: banner de atualização continua chamando o SW (Review Focus 5); `pushSupport` por ambiente; ativar envia a inscrição; Horários salva e mostra padrões. Build gera `sw.js` com precache.
- [ ] Commit.

### Task 7: Tela Hoje, navegação e cartão de dieta
**Files:** `frontend/src/features/today/{TodayPage.tsx,DayTimeline.tsx,TargetRow.tsx,ReasonSheet.tsx}`, `frontend/src/app/BottomNav.tsx`, `routes.tsx`, `features/summary/{summaryData.ts,SummaryPage.tsx}`; Tests.
- Abas: Resumo, Hoje, Treino, Planejamento, Mais. Check-in vira item "Check-in do dia" dentro de Hoje (abre `/checkin`), e `/checkin` continua existindo.
- Hoje: cabeçalho ("Segunda, 20/10 · Dia de treino — B" / "Descanso"), "N de M feitos", lista por horário com detalhes recolhíveis (refeição: alimentos e gramas; item: nome e dose em texto), botões ✓ / ½ / ✗ (✗ e ½ abrem os motivos), toque de novo desfaz; atrasado (> 30 min do horário, não marcado) destacado; treino abre `/treino`; cardio marca via adherence (e também atualiza `cardio_done` do check-in do dia).
- Resumo: cartão "Dieta" (%) e "Itens do protocolo" (%) do ciclo até hoje.
- [ ] Testes: marcar/desmarcar; motivo; atrasado com relógio falso; dia de descanso sem treino; cartão de dieta com valores (2 feitas + 1 parcial de 4 previstas = 62,5% → "63%").
- [ ] Commit.

### Task 8: Acabamento visual
**Files:** `frontend/src/index.css`, `frontend/src/ui/{Icon.tsx,Card.tsx,Button.tsx,EmptyState.tsx}` (novos componentes pequenos), telas existentes.
- Usar o skill `frontend-design` para a direção visual. Ícones SVG próprios (sem biblioteca) para as abas e ações; escala tipográfica (12/14/16/20/28), espaçamento 4/8/12/16/24, raios e sombras consistentes; cards com hierarquia clara; estados vazios com ícone e ação; modo escuro conferido; contraste AA; nada de layout quebrado a 360 px.
- [ ] Sem mudança de comportamento: todos os testes existentes verdes; screenshots via Playwright do build (Resumo, Hoje, Treino, Planejamento, Configurações) anexados como artifact no CI (job e2e).
- [ ] Commit.

### Task 9: E2E, docs e PR
- [ ] E2E: login → Hoje → marcar REF 1 como feita offline → online → "Sincronizado" → Resumo mostra Dieta > 0%. Push não é testado no e2e (iOS real).
- [ ] Docs: runbook (lembretes: instalar na Tela de Início, iOS 16.4+, Configurações → Ativar lembretes; VAPID gerado automaticamente; `Push__Subject` opcional), README.
- [ ] PR `feat/hoje` → base `feat/treino` (REST), sem merge.
