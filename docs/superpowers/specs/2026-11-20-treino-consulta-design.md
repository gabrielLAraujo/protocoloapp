# Treino só para consulta (Hevy) e poses de fisiculturismo

## Por quê
O Gabriel registra todos os treinos no Hevy, e a sincronização (PR #29) já traz cada treino para o app. A parte de **fazer o treino pelo app** não é mais usada e só ocupa espaço. A aba Treino passa a servir para **consultar**: os treinos registrados e os gráficos do que foi feito, do que faltou e das cargas.

As fotos da atualização seguem o padrão das **poses obrigatórias do fisiculturismo**, e o app deve guiar por elas.

## Objetivos
1. **Aba Treino (`/treino`) = consulta.** No topo, os gráficos:
   - **Treinos por semana:** feitos × previstos nas semanas do ciclo do protocolo ativo. Previstos pela rotação da ficha com as trocas de dia, como o Resumo; feitos são as sessões com pelo menos uma série válida (não aquecimento).
   - **Calendário do ciclo:** feitos e faltas, o mesmo componente do Resumo (`CycleCalendar`).
   - **Evolução de carga:** os exercícios mais treinados no ciclo, cada um com o gráfico de e1RM que já existe (`E1rmChart`), levando à página do exercício.

   Abaixo dos gráficos, o histórico de treinos, como o `HistoryPage` de hoje: Hevy e app, mais recentes primeiro.
2. **Todos os treinos só para leitura.** Abrir um treino mostra a visualização de leitura (`SessionReadView`), também para os antigos feitos no app. Fica "Excluir do app", que já existe para os do Hevy, e passa a valer para todos.
3. **Sai do app:**
   - iniciar, registrar, finalizar e descartar treino;
   - timer de descanso e troca de exercício;
   - "Registrar treino de outro dia" (`LogOtherDay`) e a edição de séries (`SessionEditPage` em modo edição);
   - o aviso de duplicado "Manter só um" (`DuplicateSheet`, `duplicates.ts`).

   Remover os arquivos que ficarem sem uso e os testes deles.

   Treinos do app que ficaram abertos (nunca finalizados) abrem na mesma visualização de leitura, com "Em andamento" e "Excluir do app"; contam como feitos nos gráficos se tiverem série válida (a mesma regra do Resumo). As rotas antigas (`/treino/historico`, `/treino/historico/:id`) redirecionam para as novas.
4. **Hoje:** a linha do treino mostra o status do dia, marcado pela sessão (vinda do Hevy) como hoje: feito quando há uma sessão com série válida. Não há marcação à mão de treino; um treino esquecido se corrige no Hevy, e a sincronização traz. A linha (e o `?dia=` de dias passados) leva à aba Treino, que é só consulta. Sai o "Registrar treino de outro dia" do Hoje. Hoje e os gráficos usam a mesma regra (sessão com série válida), então não discordam.
5. **Poses da atualização:** as poses padrão (`DEFAULT_POSES`) passam a ser as obrigatórias do fisiculturismo:
   - Duplo bíceps de frente (`front_double_biceps`)
   - Expansão dorsal de frente (`front_lat_spread`)
   - Peitoral de lado (`side_chest`)
   - Duplo bíceps de costas (`back_double_biceps`)
   - Expansão dorsal de costas (`back_lat_spread`)
   - Tríceps de lado (`side_triceps`)
   - Abdômen e coxa (`abs_thighs`)

   Em Configurações → Questionário, um botão **"Usar poses do fisiculturismo"** troca as poses do questionário salvo por essas, com confirmação. O fixture de exemplo usa as mesmas poses (e o teste do back que confere o fixture é ajustado). Guiar = os rótulos novos; sem texto ou imagem extra por pose.

   Fotos já tiradas com chaves antigas: se a atualização aberta tiver foto de uma pose que não está mais na lista, a etapa de fotos mostra essas fotos num bloco "Outras fotos" (só ver e remover), e elas continuam no zip. A confirmação do botão avisa quando a atualização aberta já tem fotos. Na primeira atualização com as poses novas, a câmera não tem a foto anterior de referência (chave nova) — esperado.
6. **Atualização geral da documentação:**
   - `docs/backlog.md`: o que está feito (Hevy, horário das refeições, desvios, item que acabou e esta mudança) e o que falta (app nativo iOS).
   - README: as funcionalidades atuais.

## Não objetivos
- Não mexer no servidor, na sincronização nem no esquema. O back continua aceitando sessões e séries; os dados antigos ficam como estão.
- Não apagar treinos antigos feitos no app.
- Não mudar o Resumo (ele continua com o calendário e os números).
- Não fazer o app nativo iOS (fica no backlog).

## Anti-objetivos
- Perder ou esconder treinos antigos do app.
- Quebrar a marcação de treino feito no Hoje que vem do Hevy.
- Deixar código morto do fluxo de registro.

## Restrições
As do `CLAUDE.md`: código em inglês e UI em pt-BR, nenhum dado real, sem marca do Claude, `npm run lint` e `npm test` verdes, E2E verde no CI.

O E2E `workout.spec.ts` hoje registra um treino offline pelo app, e `hevy.spec.ts` usa esse treino para o aviso de duplicado. Os dois precisam ser reescritos:
- o de treino vira importar a ficha e ver a aba Treino;
- o do Hevy deixa de checar o duplicado e checa os gráficos ou o histórico.

`today.spec.ts` e `screens.spec.ts` também passam pelo registro e precisam ser ajustados. O offline continua coberto por outro fluxo (check-in ou marcação no Hoje) se o `offline.spec.ts` depender do registro.

## Abordagens
- **A (escolhida): transformar em consulta e apagar o registro.** App mais simples, sem código morto, servidor intacto. É a mudança maior no front e nos E2E.
- B: só esconder os botões. Rápida e reversível, mas deixa o código e os testes de telas que ninguém usa.
- C: A sem gráficos novos. Menos trabalho, mas deixa feito e faltas fora da aba Treino, contra o pedido.

## Decidido com o Gabriel
- Aba Treino só com o registro de treinos e os gráficos do que foi feito, do que faltou e das cargas (abordagem A).
- Fotos com as poses obrigatórias do fisiculturismo (duplo bíceps de frente e de costas, expansão dorsal etc.).

## Escolhas minhas (podem ser revistas)
- A lista das 7 poses, com os nomes de pose obrigatória da IFBB, e "Peitoral de lado" e "Tríceps de lado" sem fixar o lado.
- O número de exercícios no gráfico de carga: os 6 mais treinados no ciclo.
- "Excluir do app" para todos os treinos, para limpar um registro antigo errado.

## Para quem for construir
Layout dos gráficos (seguir o visual clínico e sóbrio e as duas colunas no desktop), nomes de componentes, o que reaproveitar do Resumo e do `ExerciseHistoryPage`.
