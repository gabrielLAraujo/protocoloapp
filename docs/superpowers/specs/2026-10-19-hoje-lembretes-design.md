# Subprojeto 3 — Hoje, lembretes (Web Push) e acabamento visual

- **Data:** 2026-10-19
- **Status:** implementado na branch `feat/hoje` (tarefas 1–9 do plano). Decisões tomadas pelo Claude com delegação explícita do Gabriel ("tome as decisões seguras na minha ausência"); revisar antes do merge.
- **Base:** spec geral (seção 5.1) e `2026-10-18-planejamento-treino-resumo-design.md`. iPhone usa a PWA instalada (iOS 16.4+).

## 1. Objetivo
1. Tela **Hoje**: a linha do tempo do dia (refeições, itens do protocolo, cardio, treino) com marcação feito / parcial / não fiz.
2. **Lembretes por Web Push** vindos do servidor, nos horários que o Gabriel definir, só para o que ainda não foi marcado.
3. **Acabamento visual** consistente (ícones, cores, estados vazios, tipografia) nas telas existentes.
4. Corrigir a pendência do PR #3: o Resumo carrega trocas de treino desde a ativação mais antiga da ficha.

### Fora de escopo
Notificações no APK Android (fica o que existe); questionário e fotos (subprojeto 5).

## 2. Decisões
| Tema | Decisão | Motivo |
|---|---|---|
| Horários | Entidade `schedule_slot` (por usuário): `slot` (`meal_1..n`, `pre_workout`, `post_workout`, `fasting`, `before_bed`, `cardio`, `workout`, `checkin`), `day_type` (`training`/`off`), `time` (HH:mm), `reminder_enabled` | Os PDFs não trazem horário |
| Itens do dia | Calculados no cliente (`buildDay(date, protocol, workoutPlans, overrides, schedule)`): refeições do protocolo, itens cujo `schedule` vale no dia (daily, weekdays, every_n_days, training_days_only, off_days_only), cardio (se previsto), treino (se dia de treino), check-in | Mesma lógica offline |
| Marcação | Entidade `adherence_log` (`date`, `target_type` meal/protocol_item/cardio, `target_key`, `status` done/partial/missed, `reason?`, `note?`), id determinístico UUIDv5 `${userId}:adherence:${date}:${type}:${key}` | Um registro por alvo e dia, sem duplicar entre aparelhos |
| Push | VAPID com par de chaves gerado pelo servidor na primeira subida e guardado no banco (`app_secrets`), biblioteca `WebPush` (NuGet); `push_subscriptions` por aparelho; `GET /api/push/public-key`, `POST /api/push/subscribe`, `DELETE /api/push/subscribe`, `POST /api/push/test` | Sem segredo manual; padrão Web Push suportado pelo iOS 16.4+ instalado |
| Agendador | `BackgroundService` a cada 60 s: para cada usuário com inscrição, calcula no servidor (mesma regra do cliente, em C#) os lembretes cujo horário caiu no último minuto (fuso America/Sao_Paulo) e cujo alvo não tem `adherence_log` do dia; envia um push por alvo; registro `reminder_sends` (único por usuário+data+slot) evita repetição | Funciona com o app fechado |
| Conteúdo do push | Título "Protocolo"; corpo pt-BR curto sem doses ("REF 2 — 12:30", "Itens em jejum", "Hora do cardio"); abre `/hoje` | Nada sensível na tela bloqueada |
| Service worker | `vite-plugin-pwa` passa para `injectManifest` com `src/sw.ts` (precache + `push` + `notificationclick`), mantendo o fluxo "Nova versão disponível" | Push precisa de SW próprio |
| Permissão | Botão "Ativar lembretes" em Configurações (gesto do usuário, exigido pelo iOS); só aparece quando instalado na Tela de Início no iOS | Regra do iOS |
| Visual | Pass de design com ícones SVG próprios (sem lib), escala tipográfica e espaçamento revisados, cores semânticas já existentes, modo escuro conferido | Coerência |

## 3. Dados
- Servidor: `schedule_slots`, `adherence_logs` (sync, `ISyncEntity`), `push_subscriptions` (`endpoint` único, `p256dh`, `auth`, `user_agent`, `created_at`, `last_success_at`, `failure_count`), `reminder_sends` (`user_id`, `date`, `slot_key`, `sent_at`, único), `app_secrets` (`key`, `value`). Migrations aditivas.
- Cliente: tabelas locais `schedule_slots`, `adherence_logs` (migration local 4), repositórios e adaptadores.

## 4. Telas
- **Hoje** (`/hoje`, nova aba entre Resumo e Treino; o Check-in passa para dentro de Hoje como um item, e a aba Check-in sai da barra): cabeçalho com data e tipo de dia ("Dia de treino — B" / "Descanso"); itens em ordem de horário (sem horário no fim), cada um com nome, horário, detalhes (alimentos/dose em texto) recolhíveis e botões ✓ Feito / ½ Parcial / ✗ Não fiz (motivos rápidos: sem fome, sem tempo, passou mal, refeição livre, outro); atrasados destacados; contador "N de M feitos".
- **Horários** (`/configuracoes/horarios`): grade por slot × tipo de dia com campos de hora e liga/desliga lembrete; valores padrão sugeridos na primeira vez (refeições a cada 3 h a partir de 07:00; cardio 07:30; treino 18:00; check-in 21:30; antes de dormir 22:30).
- **Configurações** (`/configuracoes`, no menu "Mais"): Lembretes (status da permissão, "Ativar lembretes", "Enviar teste"), Horários, Diagnóstico.
- **Resumo**: novo cartão "Dieta" (% feito = (feito + 0,5 × parcial) / previstos até hoje) e "Itens do protocolo".

## 5. Erros
- Push com 404/410 → inscrição removida; outros erros incrementam `failure_count` (remove após 5).
- Sem permissão ou não instalado → Configurações explica como instalar/permitir.
- Agendador nunca derruba o app (try/catch por usuário, log sem conteúdo).

## 6. Testes
- Back: regras de agenda em C# com a mesma fixture JSON do cliente (casos compartilhados em `fixtures/schedule-cases.json`); agendador com relógio falso (envia no minuto certo, não reenvia, pula alvo marcado); endpoints de push (posse, unicidade do endpoint); handlers de sync novos.
- Front: `buildDay` (mesma fixture), repos, tela Hoje (marcar, motivo, atrasado), Horários, Configurações (sem `PushManager` → mensagem).
- E2E: marcar uma refeição offline → sincroniza → Resumo mostra a % da dieta.
