# Medidores de estresse e psicológico — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Dois medidores opcionais no check-in da noite (estresse 0–10, psicológico 1–5), sincronizados, no Resumo e nas métricas da atualização (`stress_avg`, `mood_avg`).

**Architecture:** Dois campos novos na parte `evening` do `daily_checkin`, no mesmo molde de `anxiety` (entidade, configuração EF, payload/validador, sync por partes; front: migration SQLite, repositório, schema, formulário). As médias entram em `CheckinMetrics` e no contrato de métricas como `ScoreAverage`.

**Tech Stack:** .NET 10 / EF Core / FluentValidation; React 19, SQLite local, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-ajustes-atualizacao-design.md` (trilha B)

## Global Constraints
- Tudo de `CLAUDE.md`: código em inglês, UI em pt-BR, nenhum dado real, autor Gabriel, commits sem marca do Claude.
- `stress` inteiro 0–10, `mood` inteiro 1–5, ambos anuláveis e **opcionais**: não entram na regra de noite completa (disposição, ansiedade e água) nem no lembrete. Payloads antigos (sem os campos) continuam válidos.
- Fazem parte da parte `evening`: gravar a noite (ou só a água) envia e substitui os dois.
- Migration EF só pelo Codegen (`[migration:CheckinStressMood]`), que também regenera `frontend/openapi.json`; depois `npm run gen:api`. Migration local SQLite versão 9 (`ALTER TABLE ... ADD COLUMN`).
- Contrato de métricas: JSON `stressAvg` e `moodAvg` (`{ avg, days }`, média com uma casa); chaves `stress_avg` e `mood_avg` depois de `anxiety_avg` em `FillMetric.All` e `FILL_METRICS`. No front, os dois têm default `{ avg: null, days: 0 }` para ler métricas guardadas antes da mudança.

## Review Focus
1. Noite com disposição, ansiedade e água mas sem os medidores → válida e completa (validador e `checkinParts`).
2. `stress` 11 / -1 e `mood` 0 / 6 → recusados no servidor (`invalid_payload:stress` / `:mood`) e no form.
3. Água registrada no Hoje depois da noite não apaga os medidores (`changeWater` mantém o resto da parte).
4. Pull de payload sem os campos → nulos; push sempre os envia.

---
### Task 1: Back-end — campos, validação e sync
**Files:** `Features/DailyCheckins/{DailyCheckin.cs,DailyCheckinPayload.cs,DailyCheckinConfiguration.cs,DailyCheckinSyncHandler.cs}`; testes `UnitTests/Sync/DailyCheckinPayloadValidatorTests.cs`, `IntegrationTests/DailyCheckins/CheckinPartsTests.cs`.
- [ ] RED: faixas (`stress` 0 e 10 aceitos, -1 e 11 → `stress`; `mood` 0 e 6 → `mood`); noite completa sem medidores aceita; payload só com `stress` sem `parts` conta como dado.
- [ ] Implementar: `MinStress=0`, `MaxStress=10`; check constraints `ck_daily_checkins_stress`/`_mood`; `WriteEvening` e `CreatePayload` com os dois.
- [ ] Integração: round-trip da noite com os medidores; água sozinha depois mantém o que o front reenvia.
- [ ] Commit `[migration:CheckinStressMood]`, `git pull` do commit do bot.

### Task 2: Métricas da atualização
**Files:** `Features/Updates/{FillMetric.cs,Metrics/CheckinMetrics.cs,Metrics/TrainingMetricsModels.cs,Metrics/UpdateMetricsResponse.cs,Metrics/UpdateMetricsLoader.cs}`; testes `UnitTests/Updates/CheckinMetricsTests.cs`, `IntegrationTests/Updates/UpdateMetricsTests.cs`.
- [ ] RED: médias contam só dias com valor (`stress` 0 conta); vazio → `{ null, 0 }`; a integração fixa as chaves `stressAvg`/`moodAvg`.
- [ ] Implementar `StressAvg`/`MoodAvg` em `CheckinResult` e na resposta.

### Task 3: Front — dados e formulário
**Files:** `data/{migrations.ts,dailyCheckinRepo.ts}`, `features/checkin/{checkinSchema.ts,EveningCheckinPage.tsx,ScaleField.tsx}`, `features/sync/syncErrors.ts` (+ testes).
- [ ] RED: migration 9 mantém linhas; repo grava/lê/envia `stress`/`mood`, `fromPayload` sem eles → null, `changeWater` mantém; schema aceita vazio e faixa; página mostra "Estresse (0 a 10)" e "Psicológico (1 a 5)" com as ajudas.
- [ ] `ChoiceField` ganha `hint` opcional; com mais de 6 opções quebra em linhas (alvos ≥ 44 px).

### Task 4: Front — Resumo e métricas
**Files:** `features/summary/{summaryData.ts,SummaryPage.tsx}`, `features/update/{updateMetrics.ts,fillText.ts,testMetrics.ts}`, `domain/fillMetrics.ts`, `features/settings/templateFile.ts` (+ testes).
- [ ] RED: `buildSummary` traz `stress`/`mood`; Resumo mostra "Estresse" (média, 0–10) e "Psicológico" (média, 1–5); `fillText('stress_avg')` → "Média 3,0 de 10 em 4 dias."; contrato aceita a resposta nova e a antiga.
- [ ] `FILL_LABELS`: "Média de estresse", "Média do psicológico".

### Task 5: E2E e entrega
- [ ] `e2e/smoke.spec.ts`: na noite, escolher estresse e psicológico; no aparelho B, conferir marcados.
- [ ] `npm run lint`, `npm test`, `npm run build`, `npm run privacy`; CI verde; PR "Check-in: medidores de estresse e psicológico".
