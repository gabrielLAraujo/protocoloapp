# Treino inteligente — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ficha importada já estruturada (grupamento, par do catálogo, técnicas), GIFs dos exercícios, revisão por etapas e técnicas com comportamento no treino.
**Architecture:** Servidor sincroniza o catálogo público do ExerciseDB numa tabela e o expõe com ETag; dicionário pt-BR versionado casa nomes do PDF com grupamento e `catalogId`; o documento da ficha ganha técnicas estruturadas (TS + C#); a revisão vira assistente; a sessão cria sub-séries e agrupa bi-sets.
**Tech Stack:** .NET 10, EF Core, BackgroundService, HttpClient; React 19, zod, SQLite local, Workbox runtime caching, Vitest, Playwright.
**Spec:** `docs/superpowers/specs/2026-10-20-treino-inteligente-design.md`

## Global Constraints
- Tudo de `CLAUDE.md` (inglês no código, pt-BR na UI, **nenhum dado real**, commits sem marca do Claude; autor Gabriel). Branch `feat/treino-inteligente` (base `main`); squash final; merge só com OK do Gabriel.
- Migrations só aditivas. Sem copiar GIFs/dados do ExerciseDB para o repositório (só ids e nomes no dicionário).
- ExerciseDB: `GET https://oss.exercisedb.dev/api/v1/exercises?limit=25[&after=<nextCursor>]` → `{ success, meta: { total, hasNextPage, nextCursor }, data: [{ exerciseId, name, gifUrl, bodyParts[], equipments[], targetMuscles[], secondaryMuscles[], instructions[] }] }`. `limit` acima de 25 é ignorado; a paginação às vezes repete páginas — parar quando uma página não traz id novo.
- `MuscleGroup` existente: `chest|back|shoulders|biceps|triceps|quads|hamstrings|glutes|calves|abs|forearms|lower_back|mobility|other`.

## Review Focus
1. Nome com erro de digitação ou abreviação do PDF ("puley", "leg 45", "terra sumô") → casa com o dicionário (Task 3).
2. "combinado com" um exercício que não está no mesmo dia → fica texto, não vira bi-set (Task 4).
3. ExerciseDB indisponível ou formato novo → importação e treino funcionam sem GIF (Tasks 2, 5).
4. Drop na última série + rest-pause no mesmo exercício → sub-séries certas, sem duplicar ao reabrir a sessão (Task 7).
5. Voltar no assistente depois de editar um dia → edição preservada; "Ativar" só com todos os dias confirmados (Task 6).

---
### Task 1: Guarda de privacidade no CI
**Files:** `scripts/privacy-guard.mjs`, `privacy/denylist.sha256`, `package.json` raiz ou `frontend/package.json` (`npm run privacy`), `.github/workflows/ci.yml` (job leve antes dos outros); teste `scripts/privacy-guard.test.mjs` (node:test).
**Interfaces:** `normalize(text)` (minúsculas, sem acento, só `[a-z0-9]` e espaços); termos = palavras e pares de palavras consecutivas; `sha256(term)` comparado com a lista. Saída: `arquivo:linha` sem imprimir o termo. Ignora binários, `node_modules`, lockfiles, `privacy/`.
- [ ] Teste com lista fictícia (hash de "termo proibido exemplo") → falha; sem ocorrência → passa.
- [ ] Gerar a lista real a partir de uma relação de termos fornecida pelo controlador (arquivo fora do repo), commitar só os hashes. CI verde.

### Task 2: Catálogo do ExerciseDB no servidor
**Files:** `backend/src/ProtocoloApp.Api/Features/ExerciseCatalog/{CatalogExercise.cs,Configuration.cs,ExerciseCatalogSync.cs,ExerciseCatalogEndpoints.cs,ExerciseDbClient.cs,Options.cs}`, migration `ExerciseCatalog` (também `exercises.catalog_id`); testes de integração.
**Interfaces:** tabela `catalog_exercises` (`id` text PK = exerciseId, `name`, `body_parts text[]`, `target_muscles text[]`, `secondary_muscles text[]`, `equipments text[]`, `gif_url`, `synced_at`); `app_secrets`/tabela de estado com `catalog_synced_at`. `ExerciseCatalogSync : BackgroundService` (ver spec). `GET /api/exercise-catalog` → `{ version, items: [{ id, name, bodyParts, targetMuscles, equipments, gifUrl }] }` com `ETag` = versão; `If-None-Match` → 304. `exercises.catalog_id` + `PUT /api/exercises/{id}` aceita `catalogId` (deve existir no catálogo ou ser null) + pull envia `catalogId`. HttpClient com host permitido `oss.exercisedb.dev`, timeout 20 s, sem redirecionamento. Logs só com contagens/código.
- [ ] Testes: paginação com `after`, parada em página sem id novo, limite de páginas (100), upsert idempotente, gifUrl só `https://static.exercisedb.dev/`; endpoint 200/304; `catalogId` inválido → 400. `[migration:ExerciseCatalog]`, CI verde.

### Task 3: Dicionário pt-BR e casamento de nomes
**Files:** `fixtures/exercise-dictionary.json`, `frontend/src/domain/exerciseMatch.ts` (+ teste), `frontend/src/domain/exerciseDictionary.ts` (carrega a fixture via import JSON com caminho que funcione no build Docker, como `schedule-cases.json`).
**Interfaces:** entrada `{ key, name, aliases: string[], group: MuscleGroup, equipment, catalogId: string|null, catalogName: string|null }`; `normalizeExerciseName(s)`; `matchExercise(name, { userExercises, dictionary }): { kind: 'user'|'dictionary'|'none', exerciseId?, entry?, confidence: 'high'|'low' }`.
- [ ] ~150 entradas cobrindo os exercícios mais comuns de musculação (peito, costas, ombros, braços, pernas, glúteos, panturrilha, abdômen, lombar), com sinônimos e grafias comuns no Brasil; `catalogId` escolhido da lista do ExerciseDB (o controlador indica onde obtê-la); conferir que cada `catalogId` existe na lista.
- [ ] Testes com nomes fictícios/grafias com erro (Review Focus 1), prioridade do usuário sobre o dicionário, ambíguo → low.

### Task 4: Técnicas estruturadas no documento da ficha
**Files:** `frontend/src/domain/planDocuments.ts` (zod), `backend/.../Plans/PlanDocuments.cs` + validadores, `frontend/src/features/plans/pdf/workoutParser.ts` (+ testes), `frontend/src/domain/techniques.ts` (tipos, rótulos e explicações pt-BR).
**Interfaces:** ver spec ("Técnicas estruturadas"). Campos opcionais (documentos antigos continuam válidos). Parser preenche `techniques`, `drops`, `restPause`, mantendo `technique` com o texto que sobrar.
- [ ] Testes por padrão (drop na última/todas/N drops, rest-pause, bi-set só dentro do dia — Review Focus 2, SST, pico, isometria, parciais, ponto zero, carga progressiva, intervalo alongado); C# aceita e valida faixas; fixtures fictícias.

### Task 5: Catálogo e mídia no aparelho
**Files:** `frontend/src/data/{catalogRepo.ts,migrations.ts}`, `frontend/src/ui/ExerciseMedia.tsx` (GIF com placeholder, ampliar, "Ver no YouTube"), `frontend/src/sw.ts` (runtime cache `static.exercisedb.dev`), importação (`importPlan.ts`/parser) usando `matchExercise` para preencher `exerciseId`/`newExercises` com grupo e `catalogId`; ativação grava `catalog_id` e aprende aliases.
- [ ] Testes: cache do catálogo com ETag (304 mantém), mídia sem catálogo → só YouTube, importação preenche grupo/par, SW: rota CacheFirst limitada.

### Task 6: Revisão da ficha por etapas
**Files:** `frontend/src/features/plans/workoutWizard/*` (passos Rotação, Dia, Exercícios novos, Ativar; folha de edição com busca no catálogo + GIF), `PlanReviewPage.tsx` (usa o assistente para ficha).
- [ ] Usar o skill `frontend-design` mantendo a direção visual. Testes: navegação, confirmar dia, voltar preserva edição (Review Focus 5), Ativar exige todos confirmados, troca de par aprende alias.

### Task 7: Técnicas no treino
**Files:** `frontend/src/features/workout/*` (etiquetas com explicação, sub-séries automáticas, bloco de bi-set, mídia no cartão).
- [ ] Testes: drop cria N sub-séries com carga sugerida, rest-pause idem, reabrir a sessão não duplica (Review Focus 4), bi-set alterna e descansa no fim do par.

### Task 8: E2E, docs e PR
- [ ] E2E: importar ficha fictícia → assistente → ativar → treino com GIF (rota de imagem stub) → registrar série com drop. Docs (README, runbook: `ExerciseCatalog__Enabled`, aviso de licença/uso pessoal). Squash + PR.
