# Atualização (questionário e fotos) — Design

Subprojeto 5. Escolhas do Gabriel em 23/10: o questionário vira uma tela no app e gera PDF; as fotos são tiradas com câmera guiada e baixadas em `.zip`.

## Regras que valem para tudo

- **Nada do questionário real entra no repositório.** Isso vale para o texto das perguntas, que é do coach. O repositório guarda só o **mecanismo** e um modelo fictício para os testes.
- **O modelo real fica nos dados do Gabriel:** no servidor, por usuário, editável no app. A carga inicial é feita a partir do formulário que ele já usa e não passa pelo Git.
- **Sem IA:** a conta não tem créditos. As respostas subjetivas são escritas por ele, com um apoio montado a partir dos dados (as notas dos check-ins do ciclo, ao lado do campo).

## 1. Modelo do questionário

- **Entidade `questionnaire_template`** (uma ativa por usuário). Guarda `sections[]`, e cada seção tem `title` e `questions[]`. Cada pergunta tem:
  - `key`: estável;
  - `text`;
  - `kind`: `text` | `long_text` | `number` | `choice`;
  - `options`: só para `choice`;
  - `fill`: opcional, a métrica que preenche a pergunta (lista abaixo).
- **Tela do modelo:** em Configurações → Questionário de atualização. Dá para ver e editar o texto das perguntas, a ordem e o `fill` de cada uma, e para importar ou exportar o modelo em JSON (o arquivo fica no aparelho, nunca no repositório).
- **Métricas de `fill`**, todas calculadas no servidor sobre o ciclo (de `period_start` a `update_date`):
  - `diet_error_pct`: % de erro na dieta, por semana e no ciclo. Desvios e "parcial" contam como erro, conforme as regras atuais.
  - `diet_wrong_meals`: refeições erradas por semana, com os motivos agrupados.
  - `diet_deviations`: lista dos desvios do ciclo.
  - `missed_workouts`: treinos previstos menos os feitos.
  - `missed_cardio`.
  - `items_missed`: itens do protocolo não usados, com o motivo, incluindo "Acabou".
  - `strength_changes`: os 2 exercícios com maior e os 2 com menor evolução por grupo, pelo 1RM de Epley. Precisa de no mínimo 2 sessões; com menos, a resposta é "sem dados suficientes".
  - `training_changes`: o que mudou no treino no ciclo, como trocas de ficha e de exercício.
  - `weight`: peso no início e no fim do ciclo, com a variação.
  - `water_avg`: água média e a meta.
  - `sleep_avg`, `energy_avg`, `anxiety_avg`: médias de 1 a 5.
  - `checkin_notes`: as notas da noite do ciclo, em ordem de data. Serve de apoio nas perguntas subjetivas.

## 2. Ciclo de atualização

- **Entidade `update_cycle`**: `period_start`, `period_end` (= `update_date`), `status` (`collecting` | `draft` | `sent`), `answers` (JSON com `key` → texto) e `photos[]` (ids de arquivo com a pose).
- **Criação:** o ciclo é criado sozinho quando há um protocolo ativo com data de atualização.
- **Ao enviar:** o status vira `sent`. O próximo ciclo começa na ativação do protocolo novo.
- **Sincronização:** pelo push/pull de sempre. Só o `answers` muda pelo aparelho; as métricas o servidor calcula sob demanda em `GET /api/update-cycles/{id}/metrics`. Para funcionar offline, o aparelho guarda a última resposta.

## 3. Tela "Atualização"

- **Onde fica:** um item no menu ("Atualização") e um cartão no Hoje a partir de 3 dias antes da data, com o lembrete push que já existe para fotos.
- **Etapas:**
  1. **Fotos**: checklist das poses.
  2. **Questionário**: as seções do modelo.
  3. **Revisar e enviar**.
- **Respostas preenchidas sozinhas:** quem tem `fill` já vem respondido, com o selo "Calculado" e o botão "Recalcular". Dá para editar o texto, e a edição prevalece.
- **Respostas subjetivas:** quem não tem `fill` usa um campo livre. Ao lado aparece "Ver notas do ciclo", que abre os check-ins do período.
- **Rascunho:** é salvo a cada mudança, localmente, e sincronizado.
- **Saída:**
  - **PDF:** gerado no aparelho por impressão do navegador, com folha de estilo própria no layout do questionário: título, seções, pergunta em negrito, resposta abaixo. Não depende de servidor nem de biblioteca nova.
  - **Copiar texto:** todas as respostas em texto simples.
  - **Baixar fotos (.zip):** montado no aparelho.

## 4. Fotos

- **Poses:** a lista vem configurada, com padrão "Frente", "Costas", "Lado direito", "Lado esquerdo" e "Abdômen". Ela fica editável no modelo.
- **Câmera:**
  - usa `getUserMedia` na web e no PWA, e a câmera do Capacitor no APK;
  - mostra a foto da mesma pose no ciclo anterior por cima, com 35% de opacidade e controle de opacidade;
  - tem temporizador de 5 s e opção de câmera traseira ou frontal;
  - se a câmera não estiver disponível, cai para escolher um arquivo.
- **Envio:**
  - a foto vai para o R2 (`FileKind.photo`) por URL pré-assinada, como os PDFs;
  - no aparelho fica só uma miniatura, sem guardar a foto em tamanho cheio;
  - sem rede, a foto fica numa fila no IndexedDB e sobe quando a conexão volta.
- **Zip:** é feito no aparelho com JSZip ou fflate (a escolha fica para o plano, pelo tamanho), baixando cada foto pela URL assinada.
- **Privacidade:**
  - as fotos nunca entram em log, no repositório nem nas fixtures;
  - os testes usam imagens geradas na hora, como um retângulo colorido.

## Fora do escopo

- Rascunho por IA.
- Enviar ao coach direto pelo app: o envio é pelo compartilhamento ou download.
- Comparação lado a lado das fotos entre ciclos (fica para depois).

## Testes

- **Servidor:** cálculo de cada métrica com dados fictícios e casos de borda (ciclo vazio, exercício com 1 sessão, desvios e "Acabou"), validação do modelo e sincronização do `update_cycle`.
- **Front:**
  - editor do modelo;
  - preenchimento automático e edição que prevalece;
  - rascunho offline;
  - geração do texto e da folha de impressão;
  - câmera com fallback, simulada;
  - fila de envio das fotos;
  - zip.
- **E2E:** abrir Atualização, ver uma resposta calculada, escrever uma subjetiva, enviar uma foto gerada no teste e gerar o texto.
