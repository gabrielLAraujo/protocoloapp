# Subprojeto 2+4 — Planejamento (importação), Treino e Resumo

- **Data:** 2026-10-18
- **Status:** aprovado em conversa; aguardando revisão do documento
- **Base:** spec geral `2026-10-18-protocoloapp-design.md` (seções 4–5). Este documento substitui os subprojetos 2 e 4 da tabela 9 e acrescenta a tela **Resumo**. A marcação diária de refeições/itens do protocolo continua no subprojeto 3.

> Nada real no repositório: PDFs, protocolos e fichas de exemplo são fictícios (fixtures escritas à mão).

## 1. Objetivo

1. Importar o **PDF do protocolo** e o **PDF da ficha de treino** com extração por IA, revisar e ativar versões.
2. Registrar o **treino estilo Hevy**, offline, a partir da ficha ativa.
3. Mostrar o **Resumo do ciclo**: linha do tempo até a próxima atualização, calendário, treinos/cardio feitos × previstos, médias do check-in, peso e evolução de força.

### Critérios de sucesso
- Upload do PDF real → rascunho revisável em < 60 s → ativar → o treino do dia aparece.
- Um treino inteiro registrado em modo avião sincroniza sem perda nem duplicata.
- O Resumo mostra corretamente "faltam N dias", treinos feitos/previstos e o calendário do ciclo ativo.

### Fora de escopo
- Check de refeições/suplementos/compostos e lembretes (subprojeto 3). O protocolo aqui é **somente consulta**.
- Questionário e fotos (subprojeto 5).
- Notificação do timer com o app em segundo plano no iOS (limitação da PWA; ver 5.4).

## 2. Decisões

| Tema | Decisão |
|---|---|
| Extração | API da Anthropic (Messages, bloco `document` PDF em base64) com **tool use** forçado num JSON Schema por tipo; modelo em `Anthropic:Model` (padrão `claude-sonnet-5-5`), chave em `Anthropic:ApiKey` |
| Armazenamento do planejamento | Uma linha por versão com o **documento JSON tipado** em `jsonb` (`plan_versions`); catálogo de exercícios em tabela própria |
| Rotação | A que vier no PDF: `sequence` (com DESCANSO) ou `fixed_weekdays`; âncora = data de ativação; ajuste manual "hoje vou fazer o treino X" |
| Ciclo | Datas vêm do protocolo ativo (`update_date`, `billing_date`); início = `activated_at` do protocolo (editável na revisão) |
| Cardio | Campos novos no `daily_checkin`: `cardio_done bool?`, `cardio_minutes int?` |
| Sync | Planejamento só leitura no cliente (pull). Sessões/séries/trocas são entidades sincronizáveis novas |

## 3. Modelo de dados

### 3.1 Servidor (Postgres)

- **`plan_versions`** (`ISyncEntity`, criado só pelo servidor): `id`, `user_id`, `kind` (`protocol` | `workout`), `status` (`draft` | `active` | `archived`), `source_file_id` (→ `files`), `document jsonb` (ver 3.3), `raw_extraction jsonb` (resposta bruta da IA, auditoria), `low_confidence jsonb` (lista de caminhos JSON), `activated_at`, `created_at`, `updated_at`, `version`, `client_updated_at` (= `updated_at`), `deleted_at`.
  - Índice único parcial: um `active` por (`user_id`, `kind`).
  - Pull envia `document` + `status` + `activated_at`; `raw_extraction` nunca vai ao cliente.
- **`exercises`** (`ISyncEntity`, servidor): `id`, `user_id`, `name`, `normalized_name` (único por usuário), `primary_muscle_group` (enum texto: `chest|back|shoulders|biceps|triceps|quads|hamstrings|glutes|calves|abs|forearms|lower_back|mobility|other`), `aliases text[]`.
- **`workout_sessions`** (sincronizável, nasce no cliente): `id`, `user_id`, `date`, `plan_version_id`, `workout_day_key`, `started_at`, `ended_at?`, `note?`.
- **`set_logs`** (sincronizável): `id`, `user_id`, `session_id`, `exercise_id`, `planned_exercise_key?`, `set_index`, `weight_kg` (0–1000, 2 casas), `reps` (0–200), `kind` (`normal|drop|partial|rest_pause|warmup`), `parent_set_id?`, `completed_at`.
- **`exercise_changes`** (sincronizável): `id`, `user_id`, `session_id`, `planned_exercise_key`, `action` (`swapped|skipped`), `replacement_exercise_id?`, `note?`.
- **`rotation_overrides`** (sincronizável): `id`, `user_id`, `date`, `workout_day_key` (ou `off`) — "hoje vou fazer o treino X"; a rotação continua a partir dele.
- **`daily_checkins`**: + `cardio_done bool?`, `cardio_minutes int? (0–300)`.

Todas com FK para o usuário e checks de faixa no banco; filhos validados no handler (`ValidateReferencesAsync`: sessão/exercício pertencem ao usuário).

### 3.2 Cliente (SQLite)
Espelho das tabelas acima (`plan_versions` só com `document`/`status`/`activated_at`), migrations locais numeradas.

### 3.3 Documentos (JSON, validados por FluentValidation e por zod no cliente)

```jsonc
// kind = protocol
{
  "phaseName": "Bulk 2026",
  "updateDate": "2026-11-15",
  "billingDate": "2026-11-29",
  "meals": [{ "key": "meal_1", "label": "REF 1", "items": [{ "food": "aveia", "grams": 90, "alternatives": [] }], "notes": null }],
  "items": [{ "key": "it_1", "category": "supplement|compound|hormone|thermogenic|sleep_optional",
              "name": "Creatina", "doseText": "6 g", "timing": "any|fasting|after_meal|before_bed|pre_workout|intra_workout|post_workout",
              "schedule": { "type": "daily" } }],
  "cardio": { "sessionsPerWeek": 7, "durationMin": 15, "intensity": "HIIT", "preferredTime": "manhã" },
  "guidelines": [{ "kind": "water_min_l", "value": 4.2 }, { "kind": "free_meals_per_week", "value": 2 }, { "kind": "text", "text": "..." }],
  "trainingSplitNote": "3 treinos para 1 off"
}
// kind = workout
{
  "rotation": { "type": "sequence", "items": ["A","B","C","off","D","E","F","off"] }
           | { "type": "fixed_weekdays", "map": { "mon": "A", "tue": "B", "...": "off" } },
  "days": [{ "key": "A", "name": "Pernas", "notes": "Trabalho de flexibilidade peitoral",
             "exercises": [{ "key": "A1", "exerciseId": "uuid", "name": "Leg 45",
               "sets": [{ "repsMin": 8, "repsMax": 12, "technique": null }],
               "restSeconds": 90, "restSequence": null, "technique": "com elástico + 10 parciais após a falha",
               "supersetWith": null }] }]
}
```

`schedule` segue as regras da spec geral 4.2. A extração preenche `exerciseId` casando por `normalized_name`/aliases com o catálogo; nomes novos viram exercícios novos com grupo sugerido pela IA (confirmado na revisão).

## 4. API

- `POST /api/plans/import` `{ fileId, kind }` → 202 `{ planVersionId }` (draft). Extração síncrona com timeout de 90 s; 1 retry em JSON inválido/timeout; falha → draft vazio com `extractionError` e o PDF disponível para preenchimento manual.
- `GET /api/plans/{id}` → documento + `lowConfidence` + diff contra o ativo (calculado no servidor: adicionados/removidos/alterados por chave).
- `PUT /api/plans/{id}` (só draft) → documento editado, validado.
- `POST /api/plans/{id}/activate` → arquiva o ativo do mesmo `kind`, ativa este (`activated_at` = agora, ou `cycleStart` informado para protocolo), cria exercícios novos confirmados. Idempotente.
- `GET /api/plans?kind=&status=` → lista de versões (histórico).
- Exercícios: `GET /api/exercises`, `PUT /api/exercises/{id}` (grupo/aliases).
- Entidades novas no `/api/sync` (handlers `workout_session`, `set_log`, `exercise_change`, `rotation_override`; `plan_version` e `exercise` só no pull).
- Logs nunca contêm o conteúdo do documento nem do PDF; o PDF vai ao Claude só pelo backend.

## 5. Front

### 5.1 Planejamento (`/planejamento`)
Cards "Protocolo" e "Treino" com a versão ativa (fase, datas, data de ativação) e "Enviar novo PDF". Upload → spinner "Lendo o PDF…" → tela de revisão: diff (+/−/~), campos editáveis por seção, itens de baixa confiança em destaque, exercícios novos com seletor de grupo, rotação editável, (protocolo) início do ciclo. Botão "Ativar". Visualização somente leitura do protocolo ativo (refeições, itens, cardio, orientações).

### 5.2 Treino (`/treino`)
- Topo: treino do dia (`resolveDay`) ou "Descanso", com "Trocar o treino de hoje" (override).
- Sessão: lista de exercícios do dia; cada um com as séries planejadas pré-montadas, "Última vez: 80 kg × 10, 80 × 9…", campos carga/reps (teclado decimal pt-BR), tipo da série, botão ✓.
- ✓ inicia o **timer de descanso** do exercício (ou da `restSequence`), barra fixa no rodapé: contagem regressiva grande, +15 s / pular, vibração (`navigator.vibrate`) ao zerar com o app aberto.
- Trocar/pular exercício (registra `exercise_change`), nota por exercício, adicionar série extra.
- "Finalizar": resumo — duração, volume por grupo, recordes (maior carga, maior e1RM por exercício).
- Sessão em andamento sobrevive a reload/fechar app (estado no SQLite).
- Histórico (`/treino/historico`, `/treino/exercicio/:id`): sessões passadas e gráfico de e1RM (Epley `w × (1 + reps/30)`, melhor série da sessão).

### 5.3 Resumo (`/resumo`, nova aba inicial depois do login)
- Linha do tempo: início do ciclo → `updateDate`, marcador de hoje, "Faltam N dias para a atualização", "Mensalidade em DD/MM".
- Calendário do ciclo (grade por semana): dia de treino feito (verde), perdido (vermelho, dia de treino passado sem sessão), descanso (cinza), futuro (contorno), ponto de cardio feito.
- Cartões: treinos feitos/previstos (até hoje) e %, cardio feito/previsto (`sessionsPerWeek` do protocolo), médias de sono, disposição ao acordar/no dia, ansiedade, água vs meta (`water_min_l`), curva de peso (sparkline).
- Evolução de força: por grupo muscular, 2 exercícios com maior e 2 com menor Δ e1RM (início × fim do ciclo, mín. 2 sessões; senão "sem dados suficientes").
- Sem ciclo ativo: estado vazio com atalho para importar o protocolo.

### 5.4 Limitações conhecidas
- iOS PWA em segundo plano não dispara alerta local do timer; ao voltar, o timer mostra o tempo decorrido. Web Push fica para o subprojeto 3.

## 6. Erros
- Upload/extração: mensagens pt-BR ("Não consegui ler esse PDF", "A IA demorou demais — tente de novo ou preencha à mão"); nunca perde o PDF enviado.
- Ativação com documento inválido → 400 com os campos.
- Sync: códigos estáveis novos (`invalid_reference`, `session_not_found`).

## 7. Testes
- Back: extração com `HttpMessageHandler` falso devolvendo respostas gravadas (fixtures fictícias) — sucesso, JSON inválido + retry, timeout; validação dos documentos; ativação (um ativo por kind, idempotência); diff; handlers de sync novos (posse, referências, LWW); migration com `has-pending-model-changes`.
- Front: `resolveDay` (sequence com âncora e override, fixed_weekdays), contagem de previstos no ciclo, e1RM e PRs, motor do timer (fake timers), agregados do Resumo, telas principais (Testing Library).
- E2E: importar ficha fictícia (IA falsa no ambiente de teste via `Anthropic:BaseUrl` apontando para um stub), ativar, registrar treino offline, sincronizar, ver no Resumo.

## 8. Entrega
- Branch `feat/treino`, plano em `docs/superpowers/plans/`, execução por subagentes com revisão por tarefa e revisão final; merge só com OK do Gabriel.
- Coolify: `Anthropic__ApiKey` (lida de `ANTHROPIC_API_KEY` no PC do Gabriel), `Anthropic__Model` opcional.
