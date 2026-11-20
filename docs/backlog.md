# Backlog

Itens pedidos e ainda não especificados. Cada um vira spec + plano quando entrar.

## Pendente

- **App nativo iOS:** gerar o app para iPhone com o Capacitor (a mesma base do APK Android). Com conta Apple grátis, o app
  instalado pelo Xcode expira em 7 dias e precisa ser reinstalado; para distribuir pelo TestFlight é preciso o Apple
  Developer Program (US$ 99/ano). Até lá, o iPhone usa o app web instalado na Tela de Início (ver
  [Lembretes no iPhone](../README.md#lembretes-no-iphone)).

## Feito

- **Treino só para consulta e poses de fisiculturismo** (branch `feat/treino-consulta`): a aba Treino passa a mostrar a
  troca do treino do dia, treinos por semana, calendário do ciclo, evolução de carga e o histórico só para leitura; sai o
  registro de treino pelo app. As poses padrão da Atualização viram as 7 obrigatórias do fisiculturismo
  ([spec](superpowers/specs/2026-11-20-treino-consulta-design.md), [plano](superpowers/plans/2026-11-20-treino-consulta.md)).
- **Atualização enviada no Resumo** (PR #30): marcar a atualização como enviada fecha o ciclo e o Resumo para de contar
  atraso até o novo protocolo chegar.
- **Sincronização com o Hevy** (PR #29): os treinos do Hevy entram como sessões encerradas e contam como treino feito
  ([spec](superpowers/specs/2026-10-24-hevy-design.md), [plano](superpowers/plans/2026-10-24-hevy.md)).
- **Dias anteriores, questionário com parâmetros e medidores do check-in** (PRs #26, #27, #28): corrigir marcações e
  check-ins de dias passados, valor inicial e parâmetros das perguntas do questionário, Estresse e Psicológico no check-in
  da noite ([spec](superpowers/specs/2026-10-23-ajustes-atualizacao-design.md)).
- **Atualização: questionário e fotos** (PR #25) ([spec](superpowers/specs/2026-10-23-atualizacao-design.md),
  [plano](superpowers/plans/2026-10-23-atualizacao.md)).
- **Horário das refeições no protocolo** (PR #24): cada refeição mostra o horário configurado, o mesmo de Hoje.
- **Desvios na dieta** (PR #22): registrar o que saiu do plano em Hoje e contar na adesão da dieta
  ([spec](superpowers/specs/2026-10-22-acabou-e-desvios-design.md), [plano](superpowers/plans/2026-10-22-desvios-dieta.md)).
- **Item que acabou** (PR #21): motivo "Acabou" para itens do protocolo, cartão "A repor" em Hoje e linha no Resumo.
