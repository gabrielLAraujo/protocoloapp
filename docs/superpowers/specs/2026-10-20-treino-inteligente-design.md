# Subprojeto 6 — Treino inteligente: importação estruturada, mídia dos exercícios e revisão por dia

- **Data:** 2026-10-20
- **Status:** desenho aprovado pelo Gabriel em conversa (fonte de mídia: GIFs do ExerciseDB; grupamento: dicionário próprio; técnicas: etiqueta + explicação, sub-séries automáticas, bi-set agrupado; abordagem A). Detalhes decididos pelo Claude com delegação ("prossiga tomando as decisões").
- **Base:** `2026-10-19-leitor-pdf-design.md` (leitor local), `2026-10-18-planejamento-treino-resumo-design.md` (documento da ficha, sessão de treino).

## 1. Objetivo
1. A ficha importada já chega estruturada: cada exercício com grupamento muscular, exercício do catálogo, séries e **técnicas avançadas** reconhecidas.
2. Cada exercício tem **GIF** de execução (ExerciseDB) e atalho "Ver no YouTube".
3. A revisão da importação da ficha é **por etapas**: Rotação → um dia por vez → Exercícios novos → Ativar.
4. No treino, as técnicas viram comportamento: etiqueta com explicação, **sub-séries automáticas** (drop, rest-pause) e **bi-set agrupado**.

### Critério de sucesso
Importar a ficha da consultoria e chegar ao "Ativar" confirmando 6 dias sem editar exercício a exercício; ≥ 90 % dos exercícios com grupamento correto e GIF.

### Fora de escopo
Revisão por etapas do protocolo; vídeos próprios; tradução das instruções do ExerciseDB.

## 2. Decisões
| Tema | Decisão | Motivo |
|---|---|---|
| Catálogo de mídia | API pública gratuita do ExerciseDB (`https://oss.exercisedb.dev/api/v1/exercises`, sem chave, `limit` máx. 25, paginação por `after=<nextCursor>`, CORS liberado). O **servidor** sincroniza o catálogo (≈ 1 500 itens: `exerciseId`, `name`, `bodyParts`, `targetMuscles`, `secondaryMuscles`, `equipments`, `gifUrl`) numa tabela própria; instruções não são guardadas | Offline, sem martelar a API, sem depender de CORS |
| Licença da mídia | GIFs **não** são copiados para o repositório nem para o R2: o app carrega de `static.exercisedb.dev` e o service worker guarda em cache os já vistos (CacheFirst, até 400 itens, 90 dias). Sem catálogo/GIF → só "Ver no YouTube" | Termos da API não declaram licença; uso pessoal, sem redistribuir |
| Sincronização do catálogo | `BackgroundService` no início (se vazio ou com mais de 30 dias) com pausa de 1,2 s entre páginas, parada quando uma página não traz itens novos; `ExerciseCatalog__Enabled` (padrão `true`). Cliente lê `GET /api/exercise-catalog` (ETag, ~150 KB) e guarda em tabela local | Respeitar a API; app funciona sem ela |
| Dicionário pt-BR | `frontend/src/domain/exercise-dictionary.json` versionado (dentro de `frontend/` porque o build Docker do front só copia essa pasta e o app usa o dicionário em tempo de execução): ~150 exercícios comuns de academia com `key`, `name` (pt-BR), `aliases` (sinônimos e grafias comuns), `group` (`MuscleGroup`), `equipment`, `catalogId` (id do ExerciseDB) e `catalogName` (para conferência). Conteúdo genérico de academia, sem dados do usuário | Grupamento e GIF corretos sem IA |
| Casamento na importação | Ordem: exercícios do usuário (nome normalizado + aliases) → dicionário (nome/aliases normalizados, tolerância a erro de digitação por distância de edição ≤ 2 em palavras ≥ 5 letras e a palavras de equipamento ausentes) → sem par (`lowConfidence`). Normalização: minúsculas, sem acento, sem pontuação, sem palavras de técnica | Determinístico e testável |
| Aprendizado | Ao ativar, cada exercício novo é criado com `group` e `catalog_id` do par escolhido; se o usuário trocou o par na revisão, o nome do PDF entra nos `aliases` do exercício. Próxima importação casa direto | "Você escolhe uma vez e o app lembra" |
| Exercício no servidor | `exercises` ganha `catalog_id text null` (migration aditiva); `PUT /api/exercises/{id}` aceita `catalogId`; pull envia `catalogId` | Mídia por exercício do usuário |
| Técnicas estruturadas | Documento da ficha ganha `techniques: Technique[]` por exercício e `drops?: number`, `restPause?: number` por série. Tipos: `drop` (`count`, `sets: "last" | "all" | number[]`), `rest_pause` (`count`), `biset` (`with`: chave do outro exercício), `sst` (`rests: number[]`), `peak` (`seconds`), `isometric` (`seconds`), `partials` (`reps?`), `zero_point` (`seconds`), `progressive_load`, `stretch_interval` (intervalo alongado). Texto livre restante continua em `technique` | Dados para o treino agir |
| Explicações | Tabela fixa pt-BR por tipo (uma frase), exibida ao tocar na etiqueta | Clareza no treino |
| Sub-séries | Ao concluir uma série com `drops`/`restPause`, a sessão cria as sub-séries (`set_logs.kind` `drop`/`rest_pause` com `parent_set_id`) já com carga sugerida (drop: −20 % arredondado a 1 kg; rest-pause: mesma carga) e descanso curto (drop 0 s, rest-pause 15 s) | Usa o modelo existente |
| Bi-set | Exercícios com `biset` mútuo aparecem num bloco único; o registro alterna A1 → B1 → descanso do bloco | Escolha do Gabriel |
| Revisão por etapas | `/planejamento/revisao/:id` para ficha vira assistente: **Rotação**, **Dia X** (um por etapa), **Exercícios novos**, **Ativar**; pontos de progresso, "Voltar", "Confirmar dia"; edição de exercício em folha inferior (nome, par do catálogo com busca e GIF, grupo, séries, técnicas). Protocolo mantém a tela atual | Escolha do Gabriel |
| Processo | Implementadores com modelo mais leve; revisões com o mais capaz; uma worktree por tarefa paralela; verificação automática de privacidade no CI; squash final com autor Gabriel | Custo e segurança |

## 3. Privacidade automática (CI)
`scripts/privacy-guard.mjs` lê `privacy/denylist.sha256` (hashes SHA-256 de termos normalizados — nunca o termo em texto) e falha se algum arquivo versionado (exceto binários, `node_modules`, lockfiles) contém palavra ou par de palavras cujo hash esteja na lista. A lista é gerada fora do repositório a partir dos PDFs reais; o job roda no CI e como `npm run privacy` local.

## 4. Telas
- **Revisão da ficha (assistente):** etapa Rotação (sequência/dias da semana editáveis); etapa Dia (lista compacta: miniatura do GIF, nome, chip de grupo, resumo de séries "4× 10–15", etiquetas de técnica, destaque "Confira"; toque abre a folha de edição); etapa Exercícios novos (grupo e par do catálogo dos que não existem no catálogo do usuário); Ativar.
- **Treino:** cartão do exercício com GIF (toque amplia), etiquetas de técnica (toque explica), botão "Ver no YouTube" (`https://www.youtube.com/results?search_query=<nome + "execução">`); bi-set em bloco; sub-séries automáticas.
- **Histórico do exercício:** GIF no topo.

## 5. Erros
ExerciseDB fora do ar ou com mudança de formato → sincronização registra só o código de erro e tenta de novo no próximo início; importação e treino funcionam sem GIF. GIF que falha → placeholder com ícone. Par ambíguo → "Confira".

## 6. Testes
Dicionário: casamento com nomes fictícios e grafias com erro; técnicas: cada padrão; sincronização do catálogo com `HttpMessageHandler` falso (paginação, parada em página repetida, limites); endpoint com ETag; sub-séries e bi-set na sessão; assistente de revisão (navegação, confirmar dia, edição, aprendizado de aliases); guarda de privacidade (hash encontrado → falha); E2E: importar ficha fictícia, percorrer o assistente, ativar, ver GIF (rota stub) e registrar drop.
