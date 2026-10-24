# Sincronização com o Hevy — Design

Subprojeto aprovado pelo Gabriel em 24/10. Os treinos registrados no Hevy entram sozinhos no ProtocoloApp como sessões encerradas e contam como treino feito em todo lugar (Hoje, Resumo, questionário de atualização, evolução de força).

## Regras que valem para tudo

- **Nenhuma chave real e nenhum treino real no repositório**, nem em testes, fixtures, logs ou mensagens de erro. Os testes usam JSON fictício (títulos inventados, cargas redondas) e chaves obviamente falsas (`test-key-0000-...`).
- **A chave da API do Hevy é do usuário:** ele a digita no app; ela vai **uma vez** ao servidor e nunca volta. O status mostra só "conectado" e os **4 últimos caracteres**.
- **A chave nunca aparece em log**, nem a URL com ela, nem o cabeçalho `api-key` (redigido no log do `HttpClient`). Conteúdo de treino (títulos, notas, cargas) também não vai para log: só contagens, códigos de status e tipos de erro.
- **Visual sóbrio, clínico**, só com os componentes de `src/ui`.

## 1. Chave e criptografia

- **Onde o usuário informa:** Configurações → Hevy. Formulário com a chave (campo de senha), botão "Conectar". Dá para **substituir** (informar outra) e **remover**.
- **Envio:** `PUT /api/integrations/hevy` com `{ apiKey, syncFrom? }`. Antes de gravar, o servidor testa a chave no Hevy (`GET /v1/workouts?page=1&pageSize=1`). Chave recusada → 422 "O Hevy recusou a chave. Confira a chave e se a conta é Pro."
- **Armazenamento:** criptografada no servidor com **AES-GCM**. A chave de criptografia vem da variável de ambiente `Integrations__EncryptionKey` (32 bytes aleatórios em base64). Formato gravado: `versão (1 byte) | nonce (12) | texto cifrado | tag (16)`, com o id do usuário como dado associado (a cifra de um usuário não abre como de outro).
- **Sem `Integrations__EncryptionKey`** (ou com valor inválido): o app sobe normalmente. As funções do Hevy respondem "não configurado no servidor" (status `serverConfigured: false`; `PUT` e `sync` → 503 com essa mensagem), e o agendador não faz nada. Um aviso de uma linha no log na partida, sem o valor.
- **Chave de criptografia trocada** (a cifra não abre mais): status `lastError: "key_unreadable"` → "A chave salva não pode mais ser lida. Informe a chave do Hevy de novo."
- **Remover:** `DELETE /api/integrations/hevy` apaga a chave e o cursor. Os treinos já importados ficam.
- A variável no Coolify é criada pelo assistente do Gabriel; o runbook documenta o comando para gerar o valor (`openssl rand -base64 32`).

## 2. API pública do Hevy

- Base `https://api.hevyapp.com`, cabeçalho `api-key`. A conta precisa ser Pro.
- Endpoints usados:
  - `GET /v1/workouts/events?page&pageSize&since`: eventos `updated` (com o `workout` inteiro) e `deleted` (com `id` e `deleted_at`).
  - `GET /v1/workouts?page&pageSize`: a carga inicial.
  - `GET /v1/workouts/{id}`: reler um treino.
  - `GET /v1/exercise_templates?page&pageSize`: o grupo muscular de um exercício desconhecido.
- **Workout:** `id`, `title`, `description`, `start_time`, `end_time`, `updated_at`, `created_at`, `exercises[]`. Cada exercício tem `title`, `exercise_template_id`, `superset_id`, `notes` e `sets[]`. Cada série tem `index`, `type` (`normal` | `warmup` | `dropset` | `failure`), `weight_kg`, `reps`, `distance_meters`, `duration_seconds` e `rpe`.
- **Cliente tolerante:** a documentação não pôde ser conferida desta sessão (`api.hevyapp.com` bloqueado no proxy). O formato acima é a referência, mas o cliente:
  - ignora campos desconhecidos;
  - aceita número nulo ou ausente;
  - pula um item malformado e o conta (só a contagem vai para o log);
  - trata envelope inesperado como erro de formato, nunca como "lista vazia".

  Os testes cobrem isso com fixtures JSON fictícias. Na primeira execução real, quem implementa confere os nomes contra `https://api.hevyapp.com/docs`.
- **Paginação:** envelope `{ page, page_count, <lista> }`, com `pageSize` 10 para treinos e eventos e 100 para templates. Uma pausa curta entre as páginas e um teto de páginas por execução.
- **Erros:**
  - 401/403 → `unauthorized`;
  - 429 → `rate_limited`;
  - 5xx ou tempo esgotado → `unavailable`;
  - JSON inesperado → `format`.

  Nenhum erro derruba o host. O próximo ciclo tenta de novo.

## 3. Sincronização

- **Quando:** um `BackgroundService` a cada **30 minutos** e o botão **"Sincronizar agora"** (`POST /api/integrations/hevy/sync`). As duas formas não rodam ao mesmo tempo para o mesmo usuário (lock consultivo). Se já houver uma rodando, a manual recebe 409 "Sincronização já em andamento".
- **Incremental:** usa `since` = início da última sincronização bem-sucedida, menos 5 minutos de folga. A importação é idempotente: um treino com `updated_at` igual ao guardado é ignorado. O cursor só avança quando a execução termina sem erro.
- **Primeira sincronização:** a partir do **início do ciclo de atualização em andamento**. Sem ciclo, são os últimos 30 dias. O usuário pode escolher outra data ("Importar a partir de"). Ela usa `GET /v1/workouts` página a página, até uma página inteira ficar antes da data ou até o teto. Trocar a data zera o cursor e reimporta a partir dela.
- **Cada treino do Hevy** vira uma `workout_session` **encerrada**:
  - na data local de `start_time` (America/Sao_Paulo);
  - com `source = "hevy"` e `external_id` = id do Hevy, único por usuário;
  - `started_at`/`ended_at` do Hevy;
  - `note` = `description`;
  - `external_title` = `title`.
- **Ficha e dia:** a sessão precisa de `plan_version_id` e `workout_day_key`. A ficha é a versão de treino ativa naquela data (a de maior ativação até o fim do dia). O dia é escolhido nesta ordem:
  1. o nome normalizado do dia igual ao título do Hevy (ex.: "Treino A");
  2. o dia com mais exercícios em comum com o treino;
  3. o dia da rotação naquela data;
  4. o primeiro dia da ficha.

  Sem ficha de treino na data, o treino **não é importado** e é contado em "sem ficha na data". Os treinos do Hevy não criam troca de rotação.
- **Séries:**
  - carga = `weight_kg`, com nulo virando 0 (peso corporal);
  - repetições = `reps`;
  - `rpe` gravado numa coluna nova;
  - `set_index` por exercício, na ordem do Hevy;
  - `planned_exercise_key` preenchido quando o exercício mapeado está no dia escolhido; senão fica nulo ("exercício extra").
- **Tipos de série:**
  - `normal` e `failure` → `normal`;
  - `warmup` → `warmup`;
  - `dropset` → `drop`, com `ParentSetId` = a última série principal do mesmo exercício e o mesmo `set_index` dela. Um dropset sem série antes vira `normal`.
  - Série sem repetições (só tempo ou distância) ou fora dos limites (carga acima de 1000 kg, mais de 200 repetições, mais de 50 séries) é pulada e contada.
- **Atualizado no Hevy → substitui:** a mesma sessão (mesmo id) ganha os dados novos, e todas as séries antigas são apagadas (soft delete) e recriadas.
- **Apagado no Hevy → remove:** soft delete da sessão e das séries.
- **Apagado no app → não volta:** uma sessão Hevy apagada no aparelho (por exemplo em "manter só um") fica apagada. Atualizações seguintes do mesmo treino são ignoradas.
- **Aos aparelhos:** tudo é gravado com `SyncWrites` (lock do usuário e versão nova). As sessões e séries chegam pelo pull normal.
- **Conta como treino feito:** ao importar uma sessão com pelo menos uma série que não é aquecimento, o servidor marca `adherence_log` (`workout`/`workout`/`done`) na data, como `finishSessionAndMark` faz no aparelho. Ao remover ou substituir, se não sobrar sessão com série de trabalho naquela data, a marca `done` é limpa (regra de `saveLoggedSession`). Resumo, força e questionário já leem sessões e séries, então não mudam.

## 4. Mapeamento de exercícios

- **Tabela `hevy_exercise_links`:** liga `exercise_template_id` (com o `title` visto) a um exercício do usuário, com `status`:
  - `auto`: casou sozinho;
  - `pending`: a confirmar;
  - `confirmed`: o usuário escolheu.
- **Casamento automático no servidor.** A sincronização roda sem aparelho e cada série precisa de `exercise_id` (chave estrangeira) no momento da importação; por isso não dá para casar no aparelho. O servidor ganha um port **mínimo** da parte exata de `exerciseMatch.ts`: `normalizeExerciseName`, `foldWord`, palavras de equipamento e `exactKey`.
- **Ordem do casamento:**
  1. nome ou apelido de um exercício do usuário com o mesmo `exactKey`;
  2. entrada do dicionário pt-BR (o mesmo `exercise-dictionary.json`, embutido no assembly) com o mesmo `exactKey`, e daí o exercício do usuário com o mesmo `catalogId` ou com nome ou apelido igual a um nome da entrada.
- **Adaptação para os títulos do Hevy:** o equipamento entre parênteses ("Bench Press (Barbell)", "Supino (Barra)") vira palavra antes da normalização. Os nomes em inglês de equipamento (barbell, dumbbell, cable, machine, smith machine) viram os tokens canônicos. No índice exato do dicionário, um nome sem equipamento também vale com o equipamento da própria entrada.
- **Sem fuzzy no servidor:** um casamento incerto exige confirmação mesmo. O fuzzy fica no aparelho, como sugestão na lista de confirmação (o `matchExercise` atual).
- **Paridade entre C# e TS:** um arquivo de casos compartilhado (`fixtures/exercise-match-cases.json`) roda nos testes das duas linguagens.
- **Sem casamento:** o treino entra assim mesmo. É criado um exercício do usuário com o título do Hevy (o "provisório"), com o grupo muscular do template do Hevy quando dá (senão "outro"), e a ligação fica `pending`.
  - Se já existe um exercício com o mesmo nome normalizado, ele é usado e a ligação fica `auto`.
  - Cada série importada guarda o template de origem (`hevy_template_id`, só no servidor, fora do payload).
- **"Exercícios do Hevy para confirmar":** uma lista no app (Configurações → Hevy). Cada item mostra:
  - o título do Hevy;
  - quantas séries usam o exercício;
  - a sugestão do aparelho (`matchExercise`), já selecionada.

  O usuário escolhe um exercício seu ou "Manter como exercício novo" e toca em "Confirmar" (`PUT /api/integrations/hevy/exercises/{id}`). Ao confirmar com outro exercício:
  - as séries daquele template passam para ele;
  - o título do Hevy vira apelido dele;
  - o provisório, se ficou sem uso e não aparece em ficha, é apagado.

  "Ver todos" mostra também as ligações `auto` e `confirmed`, para corrigir um casamento errado do mesmo jeito.

## 5. Duplicado no mesmo dia

- Uma sessão do ProtocoloApp e uma do Hevy, ambas encerradas, na mesma data e no mesmo dia de ficha (`plan_version_id` + `workout_day_key`), geram um aviso no Histórico: "Treino registrado no app e no Hevy".
- O botão **"Manter só um"** abre uma folha com as duas opções (séries e volume de cada uma): "Manter o do app" ou "Manter o do Hevy". A outra é apagada pelo fluxo normal de exclusão de sessão. Apagar a do Hevy não a traz de volta (§3).

## 6. Telas

- **Configurações → Hevy** (`/configuracoes/hevy`):
  - estado "Não configurado no servidor" quando falta a variável;
  - desconectado: campo "Chave da API do Hevy", "Importar a partir de" (data, com o início do ciclo como padrão) e "Conectar";
  - conectado: "Conectado · chave terminada em XXXX", "Última sincronização: dd/MM HH:mm" (ou "Nunca"), o último resultado ("3 importados, 1 atualizado, 0 removidos") ou o último erro em pt-BR, e os botões "Sincronizar agora", "Trocar chave", "Mudar data inicial" e "Remover";
  - a linha "Exercícios do Hevy para confirmar (N)" quando N > 0.

  Depois de "Sincronizar agora", o aparelho roda o pull (`syncNow`).
- **Configurações:** uma linha "Hevy" no menu, com o selo "N para confirmar" quando há pendentes.
- **Histórico:** o selo "Hevy" (`Chip`) nas sessões importadas, com o título do Hevy ao lado do dia, e o aviso de duplicado (§5). A sessão do Hevy abre **só para ver**, com a nota "Registrado no Hevy. Para corrigir, edite no Hevy." e o botão "Excluir do app".
- **Lista de confirmação** (`/configuracoes/hevy/exercicios`), como no §4.

## 7. Dados

- **`hevy_connections`** (uma por usuário): chave cifrada, 4 últimos caracteres, `sync_from`, cursor, últimas tentativa e sucesso, último erro (código), último resultado (contagens).
- **`hevy_exercise_links`:** os campos do §4.
- **`workout_sessions`:**
  - `source` (`app` | `hevy`, padrão `app`), definido pelo servidor (o push não altera);
  - `external_id`, único por usuário quando presente, inclusive em sessão apagada;
  - `external_updated_at`;
  - `external_title` (só pull).
- **`set_logs`:** `rpe` (opcional, de 1 a 10 em passos de 0,5; sincronizado) e `hevy_template_id` (só no servidor).
- **Migration** EF gerada só pelo Codegen. Migration local SQLite com as colunas novas.

## Referência conferida da API do Hevy (24/10, swagger público em api.hevyapp.com/docs)

- Header `api-key` (formato uuid). `GET /v1/user/info` serve para testar a chave.
- `GET /v1/workouts/events?page&pageSize&since` (pageSize máx. **10**; `since` padrão `1970-01-01T00:00:00Z`) → `{ page, page_count, events: [ {type:"updated", workout} | {type:"deleted", id, deleted_at} ] }`.
- `GET /v1/workouts?page&pageSize` (pageSize máx. 10), `GET /v1/workouts/{workoutId}`, `GET /v1/workouts/count`.
- Workout: `id`, `title`, `routine_id?`, `description?`, `start_time`, `end_time`, `updated_at`, `created_at`, `exercises[]`.
- Exercise: `index`, `title`, `notes?`, `exercise_template_id`, `superset_id?` (número), `sets[]`.
- Set: `index`, `type` (`normal` | `warmup` | `dropset` | `failure`), `weight_kg?`, `reps?`, `distance_meters?`, `duration_seconds?`, `rpe?`, `custom_metric?`.
- ExerciseTemplate: `id`, `title`, `type`, `primary_muscle_group`, `secondary_muscle_groups[]`, `equipment`, `is_custom`, `thumbnail_url?`.
- `GET /v1/exercise_history/{exerciseTemplateId}` existe (não usado agora).
