# Treino só para consulta e poses de fisiculturismo — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A aba Treino vira consulta (troca do dia, gráficos, histórico só leitura), sai todo o fluxo de registrar treino no app, as poses padrão passam a ser as 7 obrigatórias do fisiculturismo, e backlog/README são atualizados.

**Architecture:** Só front (`frontend/src`). Uma função pura nova calcula as estatísticas da aba Treino a partir dos repositórios locais (mesmas regras do Resumo). Telas novas `TrainingPage` (`/treino`) e `SessionPage` (`/treino/:id`). O fluxo de registro é apagado. O servidor, a sincronização e o esquema não mudam.

**Tech Stack:** React 19, React Router, TypeScript, Vitest + Testing Library, Playwright (E2E no CI).

**Spec:** `docs/superpowers/specs/2026-11-20-treino-consulta-design.md`

## Global Constraints
- Código, nomes e rotas em inglês; textos de UI em pt-BR.
- Nenhum dado real; fixtures fictícios.
- Commits sem `Co-Authored-By` nem rodapé; autor já configurado (Gabriel).
- `cd frontend && npm run lint && npm test` verdes a cada tarefa; E2E roda só no CI.
- Não mexer em `backend/` (exceto o teste do fixture de questionário na Tarefa 1), em `frontend/src/data/*Repo.ts` de sincronização, nem em migrations.
- Visual: seguir os componentes de `frontend/src/ui` (Card, SectionHeader, Chip, buttonClasses) e o padrão de duas colunas no desktop das telas existentes.
- Regra de "treino feito": sessão (finalizada ou não) com pelo menos uma série que não seja aquecimento (`kind !== 'warmup'`) — a mesma de `buildSummary`.

## Review Focus
1. Sem ficha de treino ativa ou sem protocolo: a aba Treino abre sem erro, mostra o histórico e mensagens vazias nos gráficos.
2. Treinos antigos do app abertos (sem `endedAt`) aparecem no histórico, abrem só para leitura com "Em andamento" e podem ser excluídos.
3. Links antigos (`/treino/historico`, `/treino/historico/:id`) e o `?dia=` do Hoje continuam levando a algum lugar válido.
4. Uma atualização aberta com fotos de poses antigas não some nada: as fotos aparecem em "Outras fotos" e vão no zip.
5. Excluir um treino do Hevy continua marcando como dispensado (não volta na próxima sincronização) e o "Feito" do dia no Hoje acompanha.

---

### Tarefa 1: Poses de fisiculturismo
**Files:**
- Modify: `frontend/src/domain/questionnaireTemplate.ts` (`DEFAULT_POSES`, nova `BODYBUILDING_POSES` = mesma lista)
- Modify: `fixtures/questionnaire-template.example.json` (`poses`)
- Modify: `backend/tests/**/QuestionnaireTemplateValidatorTests.cs` só se conferir as chaves antigas do fixture
- Modify: `frontend/src/features/settings/QuestionnaireTemplatePage.tsx` (botão "Usar poses do fisiculturismo")
- Modify: `frontend/src/features/update/PhotosStep.tsx` (bloco "Outras fotos"), `frontend/src/features/update/photos/photosZip.ts` (garantir fotos de chaves fora da lista)
- Test: os `*.test.ts(x)` vizinhos

**Interfaces:**
- Produces: `BODYBUILDING_POSES: readonly Pose[]`, na ordem e chaves:
  `front_double_biceps` "Duplo bíceps de frente", `front_lat_spread` "Expansão dorsal de frente", `side_chest` "Peitoral de lado", `back_double_biceps` "Duplo bíceps de costas", `back_lat_spread` "Expansão dorsal de costas", `side_triceps` "Tríceps de lado", `abs_thighs` "Abdômen e coxa". `DEFAULT_POSES = BODYBUILDING_POSES`.

- [ ] Testes (falhando primeiro):
  - `posesOf(null)` devolve as 7 poses acima.
  - Questionário: o botão "Usar poses do fisiculturismo" abre confirmação; confirmar salva o template com as 7 poses; a confirmação avisa "A atualização aberta já tem fotos" quando o ciclo atual (não enviado) tem fotos.
  - Etapa de fotos: um ciclo com foto de `front` (fora da lista) mostra "Outras fotos" com essa foto e o botão de remover; sem fotos fora da lista, o bloco não aparece.
  - Zip: inclui a foto de chave fora da lista (nome do arquivo com a chave).
- [ ] Implementar.
- [ ] `npm run lint && npm test`.
- [ ] Commit `feat(atualizacao): poses obrigatórias do fisiculturismo`.

### Tarefa 2: Estatísticas da aba Treino (puro)
**Files:**
- Create: `frontend/src/features/training/trainingStats.ts`, `trainingStats.test.ts`
- Modify: `frontend/src/features/summary/summaryData.ts` só para extrair e reaproveitar o cálculo do calendário (sem mudar o comportamento do Resumo)

**Interfaces:**
- Produces:
  ```ts
  interface TrainingStatsInput { protocol: SummaryInput['protocol']; plans: WorkoutPlanAt[]; overrides: RotationOverrideAt[]; sessions: SessionLocal[]; sets: SetLocal[]; exercises: ExerciseLocal[] }
  interface WeekBar { weekStart: string /* segunda */; done: number; planned: number }
  interface ExerciseTrend { exerciseId: string; name: string; sessions: number; points: E1rmPoint[] }
  interface TrainingStats { weeks: WeekBar[]; calendar: CalendarDay[]; trends: ExerciseTrend[] }
  function buildTrainingStats(input: TrainingStatsInput, today: string): TrainingStats
  ```
- Ciclo = do `activatedOn` do protocolo até hoje (ou até a data de atualização, se passou), como o Resumo; sem protocolo: últimas 8 semanas até hoje. Semanas começam na segunda. `trends`: os 6 exercícios com mais sessões no período (empate: nome), pontos de e1RM pela melhor série de cada sessão (`bestSet`/`e1rm` de `domain/strength`, como `ExerciseHistoryPage`).

- [ ] Testes: semana com 3 previstos e 2 feitos; série só de aquecimento não conta; troca de dia (override) muda o previsto; sessão aberta com série válida conta; sem protocolo usa 8 semanas; top 6 por número de sessões e pontos em ordem de data; calendário igual ao do `buildSummary` para a mesma entrada.
- [ ] Implementar.
- [ ] `npm run lint && npm test`.
- [ ] Commit `feat(treino): estatísticas da aba Treino`.

### Tarefa 3: Aba Treino e treino só leitura
**Files:**
- Create: `frontend/src/features/training/{TrainingPage.tsx,TrainingPage.test.tsx,WeekBars.tsx,DaySwap.tsx,SessionPage.tsx,SessionPage.test.tsx}`
- Modify: `frontend/src/routes.tsx`; `frontend/src/app/AppShell.tsx` (`WIDE` mantém `/treino`)
- Reuse: `CycleCalendar`, `E1rmChart`, `SessionReadView`, `deleteSessionAndMark` (`data/adherenceLinks.ts`), a lista de `HistoryPage` (sem duplicados)

**Interfaces:**
- Consumes: `buildTrainingStats` (Tarefa 2), `rotationOverrideRepo.set`, `resolveDay`.
- Produces: rotas `/treino` (TrainingPage), `/treino/:id` (SessionPage), redirecionamentos `/treino/historico` → `/treino` e `/treino/historico/:id` → `/treino/:id`; `/treino/exercicio/:id` fica.
- TrainingPage, de cima para baixo: linha "Previsto hoje: <nome do dia | Descanso> · Trocar" (`DaySwap`: lista de dias da ficha ativa + "Descanso", grava a troca de hoje, `syncNow()`, recarrega; sem ficha ativa: "Nenhuma ficha de treino ativa." com link para o Planejamento); "Treinos por semana" (`WeekBars`, barras feito/previsto com legenda e texto acessível "Semana de DD/MM: N de M"); "Calendário do ciclo" (`CycleCalendar`); "Evolução de carga" (um card por tendência com nome, `E1rmChart` e link para `/treino/exercicio/:id`; vazio: "Sem cargas registradas no período."); "Histórico" (todas as sessões, mais recentes primeiro, chip "Hevy" e título do Hevy, "Em andamento" para sessão sem `endedAt`; cada linha leva a `/treino/:id`).
- SessionPage: `SessionReadView` para qualquer sessão; botão "Excluir do app" com confirmação, usando `deleteSessionAndMark`, depois volta para `/treino`. Sessão inexistente: "Treino não encontrado." com link para `/treino`.

- [ ] Testes: sem ficha/protocolo abre sem erro; "Trocar" grava a troca e o "Previsto hoje" muda; gráficos com dados de teste; histórico com sessão do Hevy (chip) e sessão do app aberta ("Em andamento"); `/treino/historico` redireciona; SessionPage exclui e volta; sessão inexistente.
- [ ] Implementar.
- [ ] `npm run lint && npm test`.
- [ ] Commit `feat(treino): aba Treino só para consulta`.

### Tarefa 4: Remover o registro de treino
**Files:**
- Delete (e seus testes), conferindo com `tsc`/`oxlint` que nada mais usa: `features/workout/{WorkoutTodayPage,SessionView,SetRow,RestTimerBar,SwapExerciseDialog,LogOtherDay,DiscardSession,FinishSummary,DuplicateSheet,HistoryPage,SessionEditPage}.tsx`, `features/workout/{logDay,sessionFlow,useActiveSession,useRestTimer,restDurations,duplicates}.ts` e o que mais ficar órfão (`setInput`, `subSets`, `useToday`, funções de escrita de sessão/série em `workoutRepo` usadas só pelo fluxo — **não** remover as usadas pela sincronização ou pelo importador).
- Modify: `features/today/targetKinds.ts` (`linkOf` do treino → `/treino`, sem `?dia=`), `features/today/TodayHero.tsx`, `features/today/TargetRow.tsx` (linha do treino = status + link para `/treino`; sem "Registrar treino de outro dia"), testes do Hoje.

- [ ] Testes ajustados: Hoje com treino do dia feito por sessão mostra "Feito" e o link vai para `/treino`; dia passado idem.
- [ ] Apagar e ajustar até `npm run lint && npm test` verdes; `grep -rn "Começar treino\|Registrar treino de outro dia\|Manter só um" frontend/src` vazio.
- [ ] Commit `refactor(treino): remove o registro de treino pelo app`.

### Tarefa 5: E2E
**Files:**
- Modify: `frontend/e2e/{workout,hevy,today,screens,offline}.spec.ts`, `frontend/playwright.config.ts` se mudar a ordem/dependências.

- [ ] `workout.spec.ts`: importa e ativa a ficha (mantém o que outros projetos usam como dependência, ex.: dia A previsto hoje), abre a aba Treino e vê "Previsto hoje", troca para outro dia e volta.
- [ ] `hevy.spec.ts`: sem duplicado; depois de sincronizar, o histórico da aba Treino mostra o treino com o chip "Hevy" (exato), abrir mostra a leitura; Hoje mostra "Feito" no treino.
- [ ] `today.spec.ts`, `screens.spec.ts`, `offline.spec.ts`: tirar o que passa pelo registro (substituir a cobertura offline por marcação no Hoje ou check-in).
- [ ] `npx playwright test --list` lista tudo; `npm run lint`.
- [ ] Commit `test(e2e): aba Treino só consulta`. Verde no CI.

### Tarefa 6: Atualização geral da documentação
**Files:**
- Modify: `docs/backlog.md`, `README.md`

- [ ] Backlog: "Feito" com Hevy (PR #29), horário das refeições (#24), desvios (#22), item que acabou (#21), atualização enviada no Resumo (#30), Treino só consulta e poses (esta branch); pendente: app nativo iOS (Capacitor; conta grátis expira em 7 dias, Apple Developer US$ 99/ano para TestFlight).
- [ ] README: funcionalidades atuais (Hoje, Check-in, Resumo, Treino só consulta via Hevy, Atualização com poses de fisiculturismo, Planejamento), sem mencionar o registro de treino no app.
- [ ] Commit `docs: backlog e README atualizados`.

---
## Ordem
- Paralelas desde o início (worktrees `feat/treino-consulta-tN` a partir de `feat/treino-consulta`): Tarefas 1, 2 e 6.
- Depois da 2: Tarefa 3. Depois da 3: Tarefa 4. Depois da 4: Tarefa 5.
- Conflitos: só a Tarefa 3 mexe em `routes.tsx`; só a 4 apaga arquivos; a 1 é a única que toca `update/` e `settings/`.
