# Visual clínico — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Nova base visual "clínico claro" (tokens, Inter, componentes) e layouts novos de Hoje, Resumo e Protocolo; demais telas herdam a base.

**Architecture:**
- Os tokens ficam em `frontend/src/index.css` (`@theme` + `:root` / dark).
- Os componentes de base ficam em `frontend/src/ui/`.
- As telas usam só tokens e componentes.
- Nada muda em dados, rotas ou sincronização.

**Tech Stack:** React 19, Tailwind v4, `@fontsource-variable/inter`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-visual-clinico-design.md`

## Global Constraints
- Tudo de `CLAUDE.md`: código em inglês, UI em pt-BR, nenhum dado real, autor Gabriel, commits sem marca do Claude.
- Branch `feat/visual-clinico`, com squash final. Merge e deploy só com OK do Gabriel.
- Valores de cor, fonte, escala e raio exatamente como na spec. Contraste AA nos dois temas.
- Alvos de toque ≥ 44 px. Os textos acessíveis atuais usados pelos testes continuam iguais, exceto onde a interação muda (Task 2).
- Sem dependência nova além de `@fontsource-variable/inter`.

## Review Focus
1. Tema escuro do sistema → todas as telas legíveis, nenhuma cor fixa fora dos tokens (Task 1, teste de contraste; revisão visual nas capturas).
2. Fonte carregada offline (PWA e APK) → o build inclui os arquivos woff2 no precache do SW (Task 1).
3. Hoje com 15+ itens, nomes longos e itens sem horário → agrupamento certo, nada corta o horário nem o chip (Task 2).
4. Marcar Parcial/Não fiz pelo menu → abre a folha de motivo atual e grava como antes; tocar "Feito" de novo desfaz (Task 2).
5. Protocolo com refeição sem gramas, item sem horário ou sem dose → nada quebra a tabela (Task 4).

---
### Task 1: Base visual
**Files:**
- `frontend/package.json` (`@fontsource-variable/inter`);
- `src/main.tsx` (import da fonte) e `src/index.css` (tokens, escala, raios, sombras, `font-feature-settings` com `tnum` onde for usado);
- `src/ui/{styles.ts,Card.tsx,Button.tsx}`;
- novos `src/ui/{ListRow.tsx,SectionHeader.tsx,Stat.tsx,Chip.tsx,BrandMark.tsx}` com testes;
- `src/app/{AppShell.tsx,BottomNav.tsx}`, `src/features/sync/SyncStatus.tsx`;
- `src/ui/contrast.test.ts`.

**Interfaces:**
- `ListRow({ icon?, title, subtitle?, value?, to?, onClick?, trailing?, children? })`;
- `SectionHeader({ title, action?: ReactNode })`;
- `Stat({ label, value, caption? })`;
- `Chip({ tone: 'neutral'|'ok'|'warn'|'danger'|'accent', icon?, children })`;
- `cardClasses({ tone: 'default'|'accent'|'list', padding })`.

- [ ] Teste de contraste: lê os valores dos tokens do `index.css` e confere tinta, secundário, destaque e estados sobre fundo e superfície ≥ 4,5:1, e borda de controle ≥ 3:1, nos dois temas.
- [ ] Componentes e cabeçalho/barra conforme a spec. Testes atuais verdes; lint, build e privacy passam.
- [ ] Fonte no precache: `dist/` contém o woff2 e o manifest do SW o inclui.

### Task 2: Hoje
**Files:** `src/features/today/{TodayPage.tsx,TargetRow.tsx,DayTimeline.tsx,WeekCard.tsx,ProgressRing.tsx}` e testes; novo `TodayHero.tsx`, novo `StatusMenuSheet.tsx`; `e2e/today.spec.ts` e `e2e/workout.spec.ts` se usarem os botões "Parcial"/"Não fiz".

**Interfaces:**
- `groupByPeriod(rows): { period: 'morning'|'afternoon'|'evening'|'anytime', rows }[]`, com cortes 12:00 e 18:00;
- `nextRow(rows, now)` devolve a primeira linha em aberto com horário ≥ agora, ou a primeira atrasada.

- [ ] Testes:
  - agrupamento (bordas 11:59 / 12:00 / 17:59 / 18:00, sem horário);
  - próxima tarefa;
  - o check marca "Feito" e um segundo toque limpa;
  - o menu "⋯" → "Não fiz" abre a folha de motivo e grava;
  - atrasado mostra o chip sem pintar o cartão;
  - a folha de detalhes da refeição lista alimento e gramas.
- [ ] E2E ajustado e verde.

### Task 3: Resumo
**Files:** `src/features/summary/{SummaryPage.tsx,CycleTimeline.tsx,CycleCalendar.tsx,StatCard.tsx,WeightSparkline.tsx,StrengthByGroup.tsx}` e testes.

- [ ] Layout da spec: ciclo em destaque, 3 `Stat`, constância, lista compacta, calendário sem tracejado, peso só com 2 ou mais pesagens (senão uma frase).
- [ ] Os testes atuais de dados continuam iguais; os testes de render foram atualizados.

### Task 4: Protocolo (apresentação da dieta)
**Files:** `src/features/plans/ProtocolView.tsx` e teste; `labels.ts` se faltar rótulo de momento.

- [ ] Testes:
  - refeição com e sem gramas;
  - gramas alinhadas, com `tabular-nums`;
  - suplementos agrupados por momento, na ordem do dia;
  - item sem dose ou horário;
  - cardio e orientações.

### Task 5: Demais telas
**Files:**
- `src/features/{workout,plans,checkin,achievements,settings,login}/**/*.tsx`;
- `src/ui/{Sheet.tsx,EmptyState.tsx}`.

- [ ] Ajuste de hierarquia e espaçamento com os componentes da Task 1, sem mudar fluxo nem textos de ação.
- [ ] Nenhuma cor fixa fora dos tokens: `grep` sem `#`, `bg-white`, `text-black`, `slate-` ou `gray-` nos `.tsx`.
- [ ] Testes e E2E verdes.

### Task 6: Verificação e PR
- [ ] CI verde.
- [ ] Revisão das capturas do job `screenshots` nos dois temas, todas as telas.
- [ ] Squash, PR.
