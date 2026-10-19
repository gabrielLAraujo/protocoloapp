# ProtocoloApp — Design geral

- **Data:** 2026-10-18
- **Status:** aguardando revisão do Gabriel
- **Escopo deste documento:** visão do produto, arquitetura, modelo de dados, fluxos e divisão em subprojetos. O subprojeto 1 (Fundação) está detalhado na seção 9. Os subprojetos 2–5 terão cada um o seu spec antes do plano.

> Regra do repositório: **nenhum dado real** (protocolo, doses, fotos, PDFs, questionários) entra no repositório. Todos os exemplos neste documento e nas fixtures são fictícios.

---

## 1. Objetivo

Um app pessoal (um usuário) para acompanhar uma consultoria de bodybuilding:

1. **Guardar o planejamento** que o coach envia em PDF — protocolo (dieta, suplementos, cardio, compostos, orientações) e ficha de treino — via **upload**, com histórico de versões.
2. **Dizer o que fazer no dia a dia** — linha do tempo do dia com lembretes (refeições, itens do protocolo, cardio, treino) e registro de cumprimento.
3. **Registrar o treino estilo Hevy** — séries, carga, reps, timer de descanso por exercício, histórico e recordes.
4. **Avisar datas** — próxima atualização e mensalidade.
5. **Guardar fotos** de cada atualização, com guia de enquadramento para manter o padrão.
6. **Gerar o Questionário de Atualização já preenchido**, no mesmo formato do original do coach, a partir dos registros.

Também é projeto de estudo/portfólio: offline-first, sync idempotente, extração estruturada com LLM, object storage, app híbrido.

### Critérios de sucesso

- No dia da atualização, o questionário sai em PDF com as respostas objetivas calculadas e as subjetivas em rascunho, exigindo só revisão.
- Registrar treino e checks funciona sem internet e nada se perde ao sincronizar.
- Trocar de protocolo = upload do PDF + revisão + "Ativar"; lembretes se ajustam sozinhos.
- APK instalável baixado de uma release do GitHub (sem loja).

### Fora de escopo (por ora)

- Multiusuário, acesso do coach, publicação em loja, iOS.
- Sugestão ou ajuste de doses/dieta pelo app — o app **só registra e lembra** o que foi prescrito.
- Contagem de macros por grama.

---

## 2. Decisões tomadas

| Tema | Decisão | Motivo |
|---|---|---|
| Front mobile + web | **React + Vite + Capacitor** (um front) | Reaproveita o stack do Fechamento; APK + web com um código |
| iPhone | **PWA** instalada pelo Safari (Adicionar à Tela de Início), offline-first (service worker + SQLite WASM); o APK segue para Android | Sem conta de desenvolvedor Apple nem loja; o mesmo front |
| Back | **.NET 10 Minimal APIs + EF Core + Postgres 18** | Mesmo padrão do Fechamento |
| Banco local | **SQLite** via `@capacitor-community/sqlite` (web via jeep-sqlite/WASM) | Leve e maduro no Android; mesmo código na web |
| Registro de treino | Completo (séries/carga/reps/timer) | Necessário para calcular evolução de força por grupo |
| Upload de PDF | **Extração com a API do Claude** (saída estruturada) + tela de revisão | Robusto a mudanças de layout; nada ativa sem revisão |
| Questionário | Objetivas calculadas; subjetivas via **check-in diário + rascunho por IA** | Evita responder de memória no dia |
| Aderência | Check por item: `done` / `partial` / `missed` + motivo + nota | Gera % de erro e o "por quê" |
| Fotos e PDFs | **Cloudflare R2** (bucket privado, URLs pré-assinadas) | Grátis no volume esperado, sem egress; MinIO CE foi arquivado. Acesso via API S3 → trocável (Garage/SeaweedFS) |
| Lembretes | **Notificações locais** do Capacitor (Android); no iPhone, **Web Push do servidor** (PWA instalada, iOS 16.4+) — desenho adiado para o subprojeto 3 | Locais funcionam offline; o iOS não tem notificação local em PWA |
| Auth | Identity com **Bearer token** (access curto + refresh em secure storage) | Cookie não funciona bem a partir do APK |
| Entrega | Coolify (push na `main`) + APK assinado em GitHub Release | Igual ao Fechamento + APK sem loja |

---

## 3. Arquitetura

```
[APK Android (Capacitor)] ──┐
                            ├──HTTPS──> API .NET 10 (container no Coolify) ──> Postgres 18 (Coolify)
[Web (mesmo build React)] ──┘                 │                         └──> Cloudflare R2
        │                                     └──> API Claude (extração / rascunho)
  SQLite local
  (fonte de verdade offline + fila de sync)
```

- **Um container** serve a API e os arquivos estáticos do build web (mesmo modelo do Fechamento, imagem em `backend/Dockerfile`).
- **Offline-first:** o front lê e escreve sempre no SQLite local. Um *sync engine* envia mudanças locais (push) e baixa mudanças do servidor (pull) quando há rede.
- **Upload direto ao R2:** a API emite URL pré-assinada de PUT; o app envia o arquivo direto ao R2 e confirma na API. Download também por URL pré-assinada (5 min).
- **Chamadas ao Claude** só pela API (a chave nunca vai ao app).

### Estrutura do repositório

```
backend/
  src/ProtocoloApp.Api/
    Features/            # uma pasta por feature (Auth, Sync, Protocols, Workouts, Updates, Files)
    Shared/              # Db, Storage (S3), Ai, Errors, Time
  tests/ProtocoloApp.Api.Tests/   # xUnit + Testcontainers
  Dockerfile
frontend/
  src/
    app/                 # rotas, layout, providers
    features/            # today, workout, protocol, update, settings
    data/                # SQLite (schema local, repositórios), sync engine
    platform/            # notificações, câmera, secure storage (wrappers do Capacitor)
    api/                 # openapi-fetch + schema.d.ts gerado
  android/               # projeto Capacitor (gerado, versionado)
infra/devbox/            # imagem do dev box (reaproveitada do Fechamento)
docs/superpowers/{specs,plans}/
.github/workflows/ci.yml
```

Convenções do Fechamento: código em inglês, UI em português, EF Core em snake_case com enums como texto, FluentValidation, problem details (RFC 9457), rate limiting, `main` só com OK do Gabriel, commits/PRs sem marca do Claude.

---

## 4. Modelo de dados

Todas as entidades sincronizáveis têm: `id uuid` (gerado no cliente), `created_at`, `updated_at`, `deleted_at` (soft delete só para sync), `version` (inteiro incrementado pelo servidor).

### 4.1 Planejamento (vem do upload; versionado)

- **`protocol_version`** — `phase_name`, `update_date`, `billing_date`, `status` (`draft` | `active` | `archived`), `source_file_id`, `extracted_json` (bruto, para auditoria), `activated_at`.
  - **`meal`** — `slot` (`pre_workout` | `intra_workout` | `post_workout` | `meal_1`…`meal_n`), `position`, `notes`.
    - **`meal_item`** — `food`, `quantity_g`, `alternatives` (lista; ex.: "frango OU carne magra"), `position`.
  - **`protocol_item`** — `category` (`supplement` | `compound` | `hormone` | `thermogenic` | `sleep_optional`), `name`, `dose_text` (texto livre, como no PDF), `timing` (`fasting` | `after_meal` | `before_bed` | `with_meal:<slot>` | `any`), `schedule` (regra, ver 4.2), `optional bool`.
  - **`cardio_plan`** — `sessions_per_week` ou `daily`, `duration_min`, `intensity`, `preferred_time`.
  - **`guideline`** — `kind` (`water_min_l` | `free_meals_per_week` | `text`), `value`, `text`.
- **`workout_plan_version`** — `status`, `source_file_id`, `extracted_json`, `rotation` (ver 4.2).
  - **`workout_day`** — `label` (ex.: "B"), `name` (ex.: "Superiores A"), `position`, `notes` (ex.: "Alongamento leve ao final").
    - **`planned_exercise`** — `exercise_id`, `position`, `set_scheme` (lista de `{reps_min, reps_max, technique?}` — ex.: `[{12,14},{9,11},{7,9},{6,8,"drop"}]`), `rest_seconds` ou `rest_sequence` (ex.: SST `[40,25,10,10,25,40]`), `technique_notes` (cadência, pausa isométrica…), `combined_with` (bi-set).
- **`exercise`** — catálogo: `name`, `primary_muscle_group` (`chest` | `back` | `shoulders` | `biceps` | `triceps` | `quads` | `hamstrings` | `glutes` | `calves` | `abs` | `forearms` | `mobility`), `aliases`.

### 4.2 Regras de agenda (JSON tipado, validado no back e no front)

```jsonc
// protocol_item.schedule
{ "type": "daily" }
{ "type": "weekdays", "days": ["mon","wed","fri","sun"] }
{ "type": "every_n_days", "n": 3, "anchor": "2026-10-18" }   // "dia sim, 2 dias não"
{ "type": "training_days_only" }
{ "type": "off_days_only" }

// workout_plan_version.rotation
{ "type": "sequence", "items": ["A","B","C","off","D","E","F","off"], "anchor": "2026-10-20" }
{ "type": "fixed_weekdays", "map": { "mon": "A", "tue": "B", "wed": "off", ... } }
```

Uma função pura `resolveDay(date) → { dayType, workoutDay?, items[] }` (TS no front, C# no back para os cálculos do questionário) é a única fonte dessa lógica; ambas as versões passam pela mesma suíte de casos (fixture JSON compartilhada).

### 4.3 Registros do dia a dia (nascem no celular)

- **`schedule_slot`** — horário por `slot` e por `day_type` (`training` | `off`); inclui `cardio`, `workout`, `sleep`.
- **`adherence_log`** — `date`, `target_type` (`meal` | `protocol_item` | `cardio`), `target_id`, `status` (`done` | `partial` | `missed`), `reason` (`no_appetite` | `no_time` | `felt_sick` | `free_meal` | `other`), `note`. Único por (`date`, `target_type`, `target_id`).
- **`daily_checkin`** — `date` (único), `sleep_quality 1–5`, `bowel` (`normal` | `loose` | `constipated`), `energy_wake 1–5`, `energy_day 1–5`, `anxiety 1–5`, `water_l`, `weight_kg?`, `note`.
- **`workout_session`** — `date`, `workout_day_id`, `started_at`, `ended_at`, `note`.
  - **`set_log`** — `planned_exercise_id?`, `exercise_id`, `set_index`, `weight_kg`, `reps`, `kind` (`normal` | `drop` | `partial` | `rest_pause`), `parent_set_id?` (drops), `completed_at`.
  - **`exercise_change`** — exercício `swapped` / `skipped`, de → para, nota (alimenta "o que mudou no treino").

### 4.4 Atualização

- **`update_cycle`** — `period_start`, `period_end` (= `update_date` do protocolo ativo), `status` (`collecting` | `draft` | `sent`), `weight_kg`, `answers_json` (rascunho do questionário), `pdf_file_id`, `photos_zip_file_id`.
- **`photo`** — `update_cycle_id`, `pose` (`front_relaxed` | `front_flexed` | `back_relaxed` | `back_flexed` | `side_left` | `side_right` | …), `file_id`, `taken_at`.
- **`file`** — `storage_key` (R2), `content_type`, `size`, `sha256`, `kind` (`protocol_pdf` | `workout_pdf` | `photo` | `questionnaire_pdf` | `photos_zip`).

### 4.5 Sync

- **Push** `POST /sync/push`: lote de mudanças `{entity, id, op (upsert|delete), payload, client_updated_at}`. Idempotente por `(entity, id, client_updated_at)`. Conflito: *last-write-wins* por `client_updated_at` (um usuário). Resposta por item: `applied` | `stale` | `rejected{errors}`.
- **Pull** `GET /sync/pull?since=<server_version>`: tudo com `version > since`, paginado.
- Planejamento (protocolo/treino) é *read-only* no cliente: criado/ativado pela API, chega por pull.
- Itens `rejected` ficam numa lista "precisa de atenção" no app. Nada é descartado em silêncio.

---

## 5. Fluxos

### 5.1 Hoje (tela inicial)
Linha do tempo gerada por `resolveDay(hoje)` + `schedule_slot`: cada refeição/item/cardio com botões **feito / parcial / não fiz** (motivo + nota opcionais); atrasados destacados. Topo: card do treino do dia, água vs meta, check-in diário (se pendente), contagem para atualização e mensalidade.

**Lembretes:** notificações locais com ações "Feito" e "Adiar 15 min"; janela de 7 dias reagendada ao abrir o app e ao mudar protocolo/agenda. Aviso fixo se a permissão de notificação/alarme exato estiver negada.

### 5.2 Treino (estilo Hevy)
Abre o treino do dia com o `set_scheme` já montado e o último desempenho de cada exercício ao lado. Marcar série inicia o timer de descanso do exercício (vibração + notificação com tela bloqueada; suporta `rest_sequence`). Trocar/pular exercício registra `exercise_change`. Ao finalizar: PRs e volume por grupo.

### 5.3 Upload de protocolo / treino
PDF → URL pré-assinada → R2 → `POST /protocols/import` (ou `/workout-plans/import`) → API chama o Claude com o JSON Schema da seção 4 → cria versão `draft` → tela de revisão com **diff** contra a versão ativa, campos editáveis, campos de baixa confiança destacados, novos exercícios mapeados a grupo muscular → **Ativar** (arquiva a anterior, reagenda lembretes, grava datas).

Falha da IA (timeout / JSON inválido) → 1 retry → senão draft vazio com o PDF ao lado para preenchimento manual.

### 5.4 Atualização e questionário
- 3 dias antes de `update_date`: aviso para fotos.
- Câmera com **overlay da mesma pose da atualização anterior** (semitransparente); checklist de poses.
- **Respostas objetivas (calculadas no back):**
  - % erro dieta = (`missed` + 0,5 × `partial`) / refeições previstas — por semana e no ciclo.
  - Refeições erradas por semana (com motivos agrupados).
  - Treinos e cardios perdidos = previstos por `resolveDay` − registrados.
  - Suplementos/compostos não usados = itens com `missed`, com motivo.
  - 2 exercícios com maior e menor evolução por grupo = variação do **1RM estimado (Epley: `w × (1 + reps/30)`)** da melhor série, início vs fim do ciclo (mín. 2 sessões do exercício no ciclo; senão "sem dados suficientes").
  - O que mudou no treino = `exercise_change` do ciclo.
  - Peso, água média.
- **Respostas subjetivas:** a API envia ao Claude os agregados dos `daily_checkin` + notas do ciclo e recebe um rascunho por pergunta; o usuário edita.
- **Saída:** PDF no layout do questionário original (template versionado no código, gerado no back — QuestPDF) + `.zip` das fotos; compartilhamento via share sheet do Android.

---

## 6. Erros e observabilidade

- Problem details (RFC 9457) em todos os erros da API; validação com FluentValidation.
- Logs estruturados com trace id; **conteúdo do protocolo e respostas nunca vão para logs**.
- Healthcheck real (`/health` checa Postgres e R2).
- Rate limiting em auth e import.
- No app: indicador de pendências de sync; lista "precisa de atenção"; erros de rede não bloqueiam o uso offline.

## 7. Testes

- **Back (xUnit + Testcontainers/Postgres):** sync (idempotência, LWW, pull paginado), regras de agenda (fixture compartilhada com o front), cálculos do questionário, import com respostas do Claude gravadas (sem chamar a API real no CI), auth.
- **Front (Vitest):** `resolveDay` (mesma fixture), agendamento de lembretes, fila de sync (retry/backoff, rejeitados), cálculo de 1RM.
- **E2E (Playwright, build web):** dia → checks; treino → séries e timer; upload → revisão → ativar; atualização → questionário → PDF.
- Fixtures 100% fictícias.

## 8. Entrega

- **Web/API:** Coolify faz deploy a cada push na `main` (imagem `backend/Dockerfile`), subdomínio `protocolo.frauchesgabriel.work` (a confirmar).
- **iPhone (PWA):** o mesmo build web é instalável (manifest + service worker; Safari, Compartilhar, Adicionar à Tela de Início). O shell do app fica em cache para abrir offline e uma versão nova aparece como "Nova versão disponível". O back serve `sw.js`, `manifest.webmanifest` e `index.html` com `no-cache` e os arquivos de `/assets/*` com hash no nome como `immutable` (os sem hash, como `sql-wasm.wasm`, também `no-cache`). Lembretes no iOS virão de Web Push do servidor (subprojeto 3); o APK continua só para Android.
- **APK:** job no CI gera APK assinado (keystore nos secrets do GitHub) e publica como GitHub Release; o app consulta a última release e avisa quando há versão nova.
- **Limites do ambiente na nuvem (iguais ao Fechamento):** Claude não altera workflows do GitHub — escreve o `.yml` e o Gabriel commita; migrations e `gen:api` rodam no PC ou no dev box; testes do back só no CI.
- **Segredos (Coolify / GitHub secrets):** `ConnectionStrings__Db`, `R2__AccountId`, `R2__AccessKeyId`, `R2__SecretAccessKey`, `R2__Bucket`, `Anthropic__ApiKey`, `Auth__SigningKey`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

---

## 9. Subprojetos

| # | Subprojeto | Entrega | Depende de |
|---|---|---|---|
| 1 | **Fundação** | Repo, back e front esqueletos, auth, sync engine, R2, CI (back/front/imagem/APK), deploy Coolify, shell Capacitor | — |
| 2 | **Protocolo e treino** (entregue) | Upload, extração IA, revisão com diff, versões, catálogo de exercícios | 1 |
| 3 | **Hoje** | `resolveDay`, agenda, lembretes, aderência, check-in diário | 2 |
| 4 | **Registro de treino** (entregue) | Sessão, séries, timer, histórico, PRs | 2 (paralelo ao 3) |
| 5 | **Atualização** | Fotos com overlay, cálculos, rascunho IA, PDF + zip | 3, 4 |

Os subprojetos 2 e 4 foram entregues juntos, com a tela **Resumo** (ciclo, calendário e números), no spec `2026-10-18-planejamento-treino-resumo-design.md`.

### 9.1 Subprojeto 1 — Fundação (detalhe)

**Objetivo:** ter o caminho completo funcionando ponta a ponta com uma entidade trivial, antes de qualquer feature: login no APK e na web → criar registro offline → sincronizar → ver no outro dispositivo; deploy automático e APK baixável.

**Inclui:**
1. **Repositório** com a estrutura da seção 3, `README`, `.editorconfig`, `.gitignore` (inclui `*.pdf`, `*.jpg` fora de `fixtures/`), `infra/devbox` copiado do Fechamento (PR #14).
2. **Back:** projeto .NET 10, `Shared/Db` (EF Core, Npgsql, snake_case, enums texto), migration inicial, problem details, logs estruturados, rate limiting, `/health`, OpenAPI.
3. **Auth:** Identity com um usuário criado pelo comando `create-user` (mesmo padrão do Fechamento; sem cadastro público); `POST /auth/login` → access token (15 min) + refresh token (30 dias, rotativo, revogável); `POST /auth/refresh`; `POST /auth/logout`. Reuso de um refresh já gasto revoga a família inteira, exceto numa janela de graça de 60 s após o gasto enquanto o sucessor nunca foi usado (resposta perdida por sinal ruim): aí o sucessor é revogado e a família rotaciona de novo — nunca há mais de um refresh vivo por família (dois refresh simultâneos com o mesmo token dão 200 nos dois, mas só o token do segundo continua vivo).
4. **Sync engine:** tabela `sync_change` / coluna `version` com sequência global; endpoints `push`/`pull` da seção 4.5; validado com uma entidade de prova `daily_checkin` (já é do domínio e é simples).
5. **Storage:** `Shared/Storage` com cliente S3 apontando para R2; `POST /files/upload-url`, `POST /files/{id}/confirm`, `GET /files/{id}/download-url`.
6. **Front:** Vite + React + TanStack Query + openapi-fetch + react-hook-form/zod; SQLite local com migrations do schema local; repositório `daily_checkin`; fila de sync com retry/backoff e lista de rejeitados; tela de login; tela mínima de check-in diário; indicador de sync.
7. **Capacitor:** projeto Android, plugins SQLite, secure storage, local notifications (só permissão + notificação de teste), camera (só permissão); ícone e nome "Protocolo".
8. **CI** (`.github/workflows/ci.yml`, commitado pelo Gabriel): jobs Back (build + testes com Testcontainers), Front (lint + typecheck + Vitest + build), Imagem Docker, **APK** (build assinado + GitHub Release na `main`).
9. **Deploy:** app no Coolify com Postgres 18, variáveis da seção 8, domínio configurado.

**Pronto quando:**
- Login funciona no APK e na web.
- Check-in criado no APK em modo avião aparece na web depois que o celular volta a ter rede (e reenviar o lote não duplica).
- Upload e download de um arquivo de teste pelo R2 funcionam.
- Push na `main` → produção atualizada; release com APK instalável.
- Todos os jobs do CI verdes.

**Dependências do Gabriel:** criar o repositório vazio `gabrielLAraujo/protocoloapp`; bucket R2 + chaves; chave da API Anthropic; keystore Android (comando será fornecido no plano); app e Postgres no Coolify; commitar o workflow.
