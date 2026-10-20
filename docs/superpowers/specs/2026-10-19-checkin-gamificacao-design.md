# Subprojeto 3b — Check-in em partes, gamificação e erro "IA sem créditos"

- **Data:** 2026-10-19
- **Status:** implementado (branch `feat/checkin-gamificacao`). Escolhas do Gabriel em conversa (check-in Manhã + Noite; gamificação: anel do dia, sequência, metas da semana/medalhas); detalhes decididos pelo Claude.
- **Base:** `2026-10-19-hoje-lembretes-design.md` (tela Hoje, `buildDay`, `adherence_log`).

## 1. Objetivo
1. **Check-in em duas partes**, cada uma salva sozinha na hora em que acontece: **Manhã** (sono, disposição ao acordar, peso, intestino) e **Noite** (disposição no dia, ansiedade, água, observação). O cardio fica só no item Cardio do Hoje.
2. **Gamificação** na tela Hoje e no Resumo: anel de progresso do dia, sequência de dias na meta e metas da semana com medalhas.
3. **Erro de importação claro** quando a conta da API da Anthropic está sem créditos.

### Fora de escopo
Pontos/níveis (não escolhido); ranking/social; questionário e fotos (subprojeto 5).

## 2. Decisões
| Tema | Decisão | Motivo |
|---|---|---|
| Modelo do check-in | Continua **uma linha por dia** (`daily_checkins`); os campos de cada parte passam a aceitar nulo no servidor e no aparelho. Cada parte salva a linha inteira com os campos da outra parte preservados | Sem entidade nova; Resumo e médias continuam iguais (ignoram nulos) |
| Conflito entre aparelhos | Handler do servidor faz **merge por campo**: um campo nulo no payload não apaga um valor já gravado (vale para os campos das partes; `note` e `weight_kg` idem). Para limpar a observação, o cliente envia string vazia, que vira nulo no servidor | Manhã no iPhone e Noite no PC antes do pull não se apagam |
| Validação | Uma parte só é aceita completa: Manhã exige sono, disposição ao acordar e intestino (peso opcional); Noite exige disposição no dia, ansiedade e água (observação opcional). O servidor valida "cada campo, se presente, na faixa" | Mantém os dados úteis |
| Hoje | Os itens `checkin` viram dois: `checkin_morning` ("Check-in da manhã", slot `checkin_morning`, padrão 07:00) e `checkin_evening` ("Check-in da noite", slot `checkin`, padrão 21:30). Concluído = a parte salva no dia. Lembretes por push iguais aos outros | Lembrete na hora de cada parte |
| Compatibilidade | Linhas antigas (completas) contam como as duas partes feitas. `adherence` com `target_key = checkin` passa a valer como `checkin_evening` | Sem migração de dados |
| Cardio | O campo `cardio_done`/`cardio_minutes` sai do formulário; o item Cardio do Hoje grava `cardio_done` e o minuto opcional ("Quantos minutos?") no check-in do dia, criando a linha se precisar (com os outros campos nulos) | Uma só fonte para o cardio |
| Pontuação do dia | `score = (feitos + 0,5 × parciais) / previstos` sobre todos os alvos do dia (refeições, itens, cardio, treino, duas partes do check-in); hoje conta só o que já venceu ou foi marcado (mesma regra do cartão Dieta) | Coerente com o Resumo |
| Anel do dia | No topo do Hoje, anel com a % do dia e "N de M"; anima ao subir (sem animação com `prefers-reduced-motion`); ao chegar a 100 % de tudo o que estava previsto para o dia inteiro, celebração curta (confete em CSS/SVG próprio, sem biblioteca) uma vez por dia | Escolha do Gabriel |
| Meta do dia | Dia "na meta" = score ≥ 90 % do dia inteiro (fechado à meia-noite); hoje só conta quando chega a 90 % | Tolerância para um item esquecido |
| Sequência | Dias seguidos na meta até ontem (+ hoje se já bateu); recorde do ciclo e geral. Mostrada no Hoje (chama + número) e no Resumo | Escolha do Gabriel |
| Metas da semana | Semana seg–dom. Metas: Dieta ≥ 90 %, Itens do protocolo ≥ 90 %, todos os treinos previstos feitos, cardio previsto feito, água na meta (`water_min_l`) em ≥ 5 dias, check-ins completos em 7 dias. Cartão "Semana" no Hoje com progresso de cada meta | Escolha do Gabriel |
| Medalhas | Derivadas dos dados (sem entidade nova): "Semana perfeita" (todas as metas), "Dieta 100 % por 7 dias", "Sequência 7/14/30", "Todos os treinos do ciclo". Tela `/conquistas` no menu Mais com as conquistadas (data) e as bloqueadas (progresso) | Cálculo local, offline, sem sync extra |
| Push mais robusto | Falhas transitórias (429, 5xx, timeout) não contam para a remoção da inscrição (só 4xx exceto 429); se nenhum aparelho recebeu e nenhum foi removido, o registro em `reminder_sends` é desfeito para o próximo minuto tentar de novo dentro da tolerância de 2 min | Itens da revisão final do subprojeto 3 |
| Créditos da IA | O extrator reconhece `invalid_request_error` cuja mensagem cita "credit balance" e grava `extractionError = "no_credits"`; o app mostra "A IA está sem créditos. Recarregue em console.anthropic.com → Plans & Billing e tente de novo — ou preencha à mão." O log registra só o código | Mensagem acionável |

## 3. Dados
- Servidor: migration que torna nulos `sleep_quality`, `bowel`, `energy_wake`, `energy_day`, `anxiety`, `water_l` em `daily_checkins` (os checks de faixa continuam); validador por campo; merge por campo no handler.
- Cliente: migration local equivalente; repositório com `saveMorning`, `saveEvening`, `setCardio`; `buildDay` (TS e C#) com os novos alvos; fixture compartilhada atualizada.
- Sem tabelas novas para gamificação.

## 4. Telas
- **Hoje:** anel do dia + chama da sequência no cabeçalho; cartão "Semana" (metas com barras); itens "Check-in da manhã" e "Check-in da noite" abrindo `/checkin/manha` e `/checkin/noite`.
- **Check-in:** duas telas curtas; `/checkin` mostra as duas partes do dia com o estado de cada uma.
- **Resumo:** cartão "Sequência" (atual e recorde) e "Semanas na meta".
- **Conquistas** (`/conquistas`, menu Mais).

## 5. Testes
- Back: merge por campo (parte da manhã + parte da noite de aparelhos diferentes não se apagam), validação por parte, `buildDay` C# com os novos alvos (fixture), extrator com resposta "credit balance" → `no_credits`.
- Front: repos das partes, cálculo de score/meta/sequência/metas/medalhas (funções puras com datas fixas), anel (100 % dispara a celebração uma vez), telas do check-in.
- E2E: manhã salva offline → noite salva → sincroniza → Resumo conta o check-in completo.
