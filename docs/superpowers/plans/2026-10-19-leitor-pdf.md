# Leitor de PDF sem IA — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Importar protocolo e ficha de treino lendo o PDF no aparelho, sem API paga.
**Architecture:** `pdfjs-dist` extrai itens de texto com coordenadas; parsers puros em TS montam `ProtocolDocument`/`WorkoutDocument` (mesmos tipos/zod do front) + `lowConfidence`; um endpoint novo cria o rascunho; revisão/ativação inalteradas.
**Tech Stack:** React 19, TypeScript, pdfjs-dist, Vitest; .NET 10 Minimal APIs.
**Spec:** `docs/superpowers/specs/2026-10-19-leitor-pdf-design.md`

## Global Constraints
- Tudo de `CLAUDE.md`. Branch `feat/leitor-pdf` (base `main`). Merge só com OK do Gabriel.
- **Nenhum texto dos PDFs reais em testes, fixtures, commits ou logs.** Fixtures fictícias no mesmo formato (nomes de exercícios/alimentos genéricos, doses inventadas). Os PDFs reais (em `/root/.claude/uploads/...`) podem ser lidos localmente só para validar o parser.
- Documento gerado tem que passar no zod do front e no validador do servidor para rascunho.

## Review Focus
1. Linha de exercício quebrada em duas linhas do PDF → um exercício só (Task 2).
2. Bloco sem séries no cabeçalho ou exercício sem séries → herda/vazio com `lowConfidence`, nunca quebra (Task 2).
3. Suplemento na coluna da direita sem refeição na mesma linha → `any` + `lowConfidence` (Task 3).
4. Data "3 de fevereiro" quando o upload é em dezembro → ano seguinte (Task 3).
5. PDF escaneado (sem texto) → mensagem "Esse PDF não tem texto selecionável; preencha à mão" (Task 4).

---
### Task 1: Rascunho vindo do aparelho (servidor)
**Files:** `backend/src/ProtocoloApp.Api/Features/Plans/{PlanEndpoints.cs,PlanContracts.cs,PlanVersion.cs?}`; Tests `IntegrationTests/Plans/*`.
**Interfaces:** `POST /api/plans/drafts { fileId, kind, document, lowConfidence: string[], newExercises: {name, group}[] }` → 201 `{ planVersionId }` (draft; arquivo do usuário; documento validado como no `PUT` de rascunho; `exerciseId` preenchido por nome normalizado/aliases como na extração). `GET /api/plans/extraction` → `{ ai: boolean }` (`Anthropic:ApiKey` configurada). Sem migration se possível (origem pode ir em coluna existente ou ser omitida). `[codegen]` para atualizar `frontend/openapi.json`.
- [ ] Testes: arquivo de outro usuário → 404; documento inválido → 400 com campos; sucesso cria draft com exercícios casados; `extraction` reflete a config.
- [ ] CI verde, commit.

### Task 2: Parser da ficha de treino
**Files:** `frontend/src/features/plans/pdf/{pdfText.ts,workoutParser.ts}` + testes; `package.json` (`pdfjs-dist`).
**Interfaces:** `extractPdfLines(data: ArrayBuffer): Promise<PdfLine[]>` (`PdfLine = { page, y, items: { x, text }[] , text }`, linhas agrupadas por y com tolerância, ordenadas); `parseWorkout(lines: PdfLine[]): { document: WorkoutDocument, lowConfidence: string[] }` seguindo a spec (dias, DESCANSO → `off`, rotação `sequence`, séries, intervalos, SST, drop, continuação, notas).
- [ ] Testes com linhas fictícias cobrindo cada padrão da spec e Review Focus 1–2.
- [ ] Validar localmente contra o PDF real da ficha (não commitar nada dele): todos os dias e exercícios reconhecidos; registrar no relatório só contagens.
- [ ] Lint/test/build, commit.

### Task 3: Parser do protocolo
**Files:** `frontend/src/features/plans/pdf/protocolParser.ts` + testes.
**Interfaces:** `parseProtocol(lines: PdfLine[], uploadedOn: string): { document: ProtocolDocument, lowConfidence: string[] }` seguindo a spec (colunas por x, refeições, alimentos com alternativas, suplementos com timing, datas com ano inferido, fase, cardio, água, refeições livres, seções de compostos/hormônios/termogênicos, fórmula de sono, orientações em texto).
- [ ] Testes com linhas fictícias (coordenadas) cobrindo cada regra e Review Focus 3–4.
- [ ] Validar localmente contra o PDF real do protocolo (só contagens no relatório).
- [ ] Lint/test/build, commit.

### Task 4: Tela de importação, e2e e PR
**Files:** `frontend/src/features/plans/{PlansPage.tsx,importPlan.ts}` (+ testes), `frontend/e2e/*`, README.
- Envio: sobe o PDF (como hoje), lê no aparelho, cria o rascunho via `POST /api/plans/drafts`, abre a revisão. Se `extraction.ai`, botão secundário "Ler com IA". PDF sem texto → mensagem da Review Focus 5.
- [ ] Testes de tela; e2e com PDF fictício gerado para o teste (em `frontend/e2e/fixtures/`), sem stub da IA.
- [ ] CI verde; PR `feat/leitor-pdf` → `main` (sem merge).
