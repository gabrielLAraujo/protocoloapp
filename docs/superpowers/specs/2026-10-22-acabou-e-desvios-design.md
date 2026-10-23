# Item que acabou e desvios na dieta — Design

Aprovado por Gabriel em 22/10. Duas partes independentes, cada uma num PR.

## 1. Item que acabou

- **Motivo novo:** `ran_out`, rótulo "Acabou".
  - Vale só para itens do protocolo (`protocol_item`). A folha de motivo mostra "Acabou" apenas para esse tipo, e o servidor recusa `ran_out` em outros tipos.
  - Conta como "Não fiz" (status `missed` ou `partial`, igual aos outros motivos).
- **Cartão "A repor" no Hoje:**
  - Lista os itens cujo último registro, nos últimos 14 dias, foi "Acabou" e que não foram marcados "Feito" depois disso. Cada item aparece com o nome e a data em que acabou.
  - Some sozinho quando o item volta a ser marcado "Feito".
  - Fica abaixo do cartão Água no celular e no painel da direita no desktop. Sem itens, o cartão não aparece.
- **Resumo:** na lista de números do ciclo, a linha "Itens que acabaram: N dias", contando os registros `ran_out` no ciclo. A linha só aparece quando N > 0.
- **Servidor:** a migration atualiza o check constraint `ck_adherence_logs_reason` e a validação do payload de adesão. O enum é gravado como texto `ran_out`.

## 2. Desvios na dieta

- **Entidade nova `diet_deviations`:**
  - `id` (uuid do cliente), `date` (dia local), `meal_key` (texto, nulo para "refeição fora do plano"), `time` (HH:mm, opcional; usado na refeição extra), `description` (texto obrigatório, até 200 caracteres), `quantity` (texto opcional, até 60 caracteres).
  - Também os campos padrão de sincronização: `client_updated_at`, `version`, `deleted_at`.
  - Sincroniza pelo mesmo mecanismo de push/pull das outras entidades, com tabela local no SQLite e migration local.
  - O conteúdo do texto nunca vai para logs.
- **Hoje:**
  - **Dentro de uma refeição:** o "⋯" de cada refeição ganha "Comi algo fora do plano". A folha pede o que foi e a quantidade (opcional) e grava com o `meal_key` da refeição.
  - **Refeição extra:** um botão "Refeição fora do plano", abaixo da lista do dia. A folha pede o que foi, a quantidade e o horário (padrão: agora), e grava com `meal_key` nulo.
  - **Selo na refeição:** a linha de uma refeição com desvio ganha o selo "Desvio" (cor de aviso, só no texto). A folha de detalhes lista os desvios, cada um com editar e apagar.
  - **Linhas próprias:** as refeições extras aparecem como linhas no período do seu horário, com o selo "Fora do plano", e podem ser abertas para editar ou apagar.
- **Adesão:** a dieta do dia passa a ser feitas ÷ (previstas + desvios).
  - Isso vale para o anel do dia, para a meta da semana "Dieta ≥ 90%", para a sequência e para a porcentagem de dieta do Resumo.
  - Os itens do protocolo não mudam.
- **Resumo:** a linha "Desvios na dieta: N no ciclo". Tocar abre uma folha com a lista por dia.
- **Testes:**
  - Cálculo da adesão com desvios: 0 previstas, desvio sem refeição prevista e apagado deixa de contar.
  - Sincronização: push, pull, edição e exclusão.
  - Validação do servidor.
  - Componentes.
  - Um passo E2E: registrar um desvio e ver o selo.

## Fora do escopo

- Calorias ou macros do desvio.
- Fotos.
- Lembrete de compra para os itens que acabaram.
