# Leitor de PDF sem IA

- **Data:** 2026-10-19
- **Status:** escolha do Gabriel ("Leitor próprio, sem IA"); detalhes decididos pelo Claude.
- **Base:** `2026-10-18-planejamento-treino-resumo-design.md` (importação, revisão, ativação).

## 1. Objetivo
Importar o PDF do protocolo e o da ficha de treino sem custo de API: o app lê o texto do PDF e monta o rascunho com regras feitas para o modelo de PDF da consultoria (Word exportado em PDF). A revisão e a ativação continuam iguais. A extração por IA continua disponível quando houver chave com crédito.

## 2. Decisões
| Tema | Decisão | Motivo |
|---|---|---|
| Onde roda | No aparelho (TypeScript), com `pdfjs-dist`: texto com coordenadas (x, y) por página | Grátis, offline, privado; o PDF continua indo para o R2 como hoje |
| Rascunho | Endpoint novo `POST /api/plans/drafts { fileId, kind, document, lowConfidence, newExercises }` → 201 `{ planVersionId }`; o servidor valida o documento com as mesmas regras de `PUT /api/plans/{id}` (rascunho pode ter campos vazios), casa exercícios por nome normalizado/aliases como a extração faz e guarda `extractionSource = "local"` | Mesmo fluxo de revisão/ativação |
| Escolha do leitor | Padrão: leitor local. Se a IA estiver disponível (`GET /api/plans/extraction` → `{ ai: true|false }`), a tela oferece "Ler com IA" como alternativa | Sem custo por padrão |
| Ficha de treino | Blocos de dia: linha `(<nome>) <séries padrão>` abre um dia (chaves A, B, C… na ordem); `DESCANSO` entre blocos vira `off` na rotação `sequence`; linhas `- ` são exercícios (continuação na linha seguinte quando não começa com `-`); linhas sem `-` dentro do bloco viram nota do dia | Formato da consultoria |
| Exercício | Nome = texto antes do primeiro padrão de séries/técnica/intervalo; séries por `(1x12 a 14) (1x9 a 11)…`, `3x 8 a 12`, `5 series 6 a 8`, `2x RM` (reps nulas, nota), "+ drop"/"+ 3 drop" → técnica `drop` na série; sem séries → herda as séries padrão do dia; intervalo por `intervalo 2 min|75 seg|3 minutos|1 minuto` → `restSeconds`; `SST (intervalo 40, 25, 10…)` → `restSequence`; "combinado com X" → nota/técnica; o resto vira `technique` (texto) | Cobre os casos do modelo |
| Protocolo | Leitura por colunas (x): rótulos à esquerda (`REF n`, `PÓS TREINO`, `Intra Treino`), alimentos ao centro (`•`), suplementos à direita (`- dose nome (timing)`); datas `DATA DE ATUALIZAÇÃO: 12 de março` / `DATA DE MENSALIDADE: 3 de abril` (ano inferido: `updateDate` é a ocorrência mais próxima da data do upload; `billingDate` é a próxima ocorrência no dia do upload ou depois); `FASE:`; cardio (`Sessões na semana`, `Duração`, `Intensidade`, `Horário`); `Consuma NO MÍNIMO: 3,5 litros` → `water_min_l`; `Direito a UMA refeição livre` → `free_meals_per_week`; seções de ergogênicos/hormonal/termogênicos (`NOME: dose frequência`) → itens `compound`/`hormone`/`thermogenic`; fórmula de sono → `sleep_optional` antes de dormir | Formato da consultoria |
| Timing dos suplementos | Texto entre parênteses manda (`jejum` → `fasting`, `após comer` → `after_meal`, `antes de dormir` → `before_bed`); sem indicação, o suplemento vai para a refeição da mesma linha (`with_meal:<key>`); se não der para casar, `any` | Na ficha, a posição indica a refeição |
| Confiança | Tudo que foi inferido (ano das datas, timing pela posição, séries herdadas, exercício sem séries) entra em `lowConfidence` e aparece destacado na revisão | Revisão rápida |
| Alimentos | `180gr tilápia OU peito de peru` → `food = tilápia`, `grams = 180`, `alternatives = [peito de peru]`; `1 caps`, `3 claras` → `grams = null`, texto completo em `food` | Fiel ao PDF |
| Privacidade | Nada do PDF real entra no repositório: testes com textos/coordenadas fictícios no mesmo formato; a validação contra o PDF real é feita só localmente | Regra do repositório |

## 3. Testes
- Front: parser da ficha (dias, DESCANSO, séries variadas, intervalos, SST, drop, continuação de linha, herança de séries), parser do protocolo (colunas, datas com ano inferido, timing, cardio, água, refeições livres, seções de compostos), montagem do rascunho com `lowConfidence`; tela de importação usando o leitor local.
- Back: `POST /api/plans/drafts` (posse do arquivo, validação, casamento de exercícios, 201).
- E2E: importar ficha fictícia com o leitor local (sem stub da IA) → revisar → ativar.
