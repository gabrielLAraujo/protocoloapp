# Dias anteriores — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Corrigir dias anteriores: navegar no Hoje até o início do ciclo (ou 35 dias), marcar itens, desvios, água e check-ins daquela data, registrar um treino esquecido e corrigir as séries de um treino passado.

**Architecture:**
- Só front. O servidor não limita datas em `adherence_log`, `daily_checkin`, `diet_deviation`, `workout_session` e `set_log` (os validadores só exigem a data), então nada muda lá.
- Um módulo `features/today/dayParam.ts` concentra a regra do dia escolhido: limites (`dayLimits`: início do ciclo em andamento de `updateCycleRepo.current()`, senão hoje − 35; nunca futuro), leitura de `?dia=` (`resolveDay`, fora do limite volta para o limite) e o hook `useChosenDay()` usado no Hoje e nos check-ins.
- O Hoje lê `?dia=`; num dia passado esconde o cartão de próxima tarefa, celebração, sequência, atualização, "A repor" e semana. As linhas de check-in e treino levam `?dia=`.
- Treino: `SessionView` ganha `mode: 'live' | 'log'`. No registro não há cronômetro, as séries ganham horário no próprio dia (`workoutRepo.logSet/logSubSet` aceitam `completedAt`; `startSession` aceita `startedAt`) e o botão é "Salvar treino" (`saveLoggedSession`: encerra no horário da última série e acerta a marca do treino daquela data).
- Histórico: cada sessão encerrada abre `/treino/historico/:id` no modo de registro.

**Tech Stack:** React 19, SQLite local, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-ajustes-atualizacao-design.md` (trilha C)

## Global Constraints
- Tudo de `CLAUDE.md`: código em inglês, UI em pt-BR, nenhum dado real, autor Gabriel, commits sem marca do Claude.
- Visual sóbrio: só `src/ui` e `ui/styles.ts`; alvos de 44 px; setas alinhadas à data.
- Hoje sem `?dia=` continua igual (URL `/hoje`, seletores do E2E inalterados).
- Sem migration.

## Review Focus
1. `?dia=` inválido, futuro ou antes do limite → cai no limite (hoje ou o mais antigo).
2. Dia passado: nada de "Atrasado", próxima tarefa ou celebração; marcar grava naquela data.
3. Check-in de outro dia salva naquela data e volta para `/hoje?dia=`; o aviso "o dia mudou" não aparece.
4. Treino registrado: sessão com a data escolhida, encerrada, sem cronômetro; marca do treino na data.
5. Editar sessão passada: apagar todas as séries de trabalho limpa a marca "feito" daquele dia.

---
### Task 1: Regra do dia (`dayParam.ts`)
- [ ] Testes: `dayLimits` com ciclo em coleta (início), ciclo enviado ou futuro (35 dias), sem ciclo; `resolveDay` com ausente, inválido, futuro, antes do limite, dentro; `shiftDay` respeita os limites.
- [ ] Implementar e o hook `useChosenDay()` (lê o ciclo do aparelho, `?dia=`, devolve `{ date, today, isPast, min, setDate }`).

### Task 2: Hoje com navegação
- [ ] Testes (`TodayPage.test.tsx`): setas ‹ › mudam `?dia=`, › desligada hoje, ‹ desligada no limite; dia passado mostra "Dia dd/MM" + "Dia anterior", sem "Próxima tarefa" nem "Atrasado"; marcar grava na data; link do check-in leva `?dia=`.
- [ ] Implementar (`TodayPage`, `TodayHero` sem próxima tarefa, `linkOf(target, date)`, água "Total do dia").

### Task 3: Check-in de outro dia
- [ ] Testes (`CheckinPages.test.tsx`): `/checkin/manha?dia=ontem` abre e salva ontem, volta para `/hoje?dia=`; dia fora do limite cai em hoje.
- [ ] Implementar em `CheckinPartPage`.

### Task 4: Registrar treino de outro dia
- [ ] Testes do repo: `startSession` com `startedAt`, `logSet`/`logSubSet` com `completedAt`; `saveLoggedSession` encerra e marca / limpa.
- [ ] Testes (`WorkoutTodayPage.test.tsx`): "Registrar treino de outro dia" → data + dia da ficha → sessão no modo de registro (sem cronômetro) → "Salvar treino" grava encerrada na data; `?dia=` abre já com a data.
- [ ] Implementar (`LogOtherDay`, `SessionView mode="log"`).

### Task 5: Corrigir treino do Histórico
- [ ] Testes (`HistoryPage.test.tsx`): sessão encerrada abre a edição; mudar carga, apagar e adicionar série; salvar volta ao histórico.
- [ ] Implementar rota `/treino/historico/:id` (`SessionEditPage`).

### Task 6: E2E e verificação
- [ ] `workout.spec.ts`: início do ciclo do protocolo = ontem (o ciclo cobre ontem).
- [ ] `today.spec.ts`: marcar a refeição de ontem; registrar treino de ontem.
- [ ] `npm run lint`, `npm test`, `npm run build`, privacidade; PR e CI verde.
