# Comparação de fotos com IA e Hevy ao abrir o app

## Intenção

O Gabriel quer ver a própria evolução física entre atualizações: as fotos da mesma pose lado a lado, com marcações do que
melhorou desenhadas por cima e um resumo curto. É **só para ele**: nada disso entra no questionário, no PDF nem no zip de
fotos que vai para a coach.

Junto, o treino feito no Hevy deve aparecer no app logo que ele abre o app, sem esperar a sincronização de 30 em 30
minutos do servidor.

## Objetivos

- Escolher **quaisquer duas atualizações** com fotos e uma pose; por padrão abre a **anterior × a atual** (a atual é o
  ciclo mais recente com foto daquela pose; a anterior, o ciclo com foto da mesma pose logo antes dela).
- Fotos lado a lado (antes à esquerda, depois à direita), com a data de cada atualização.
- Botão "Analisar com IA": a IA compara as duas fotos e devolve marcações (círculos com rótulo curto) sobre a foto
  **depois** e um resumo de 3 a 5 pontos do que melhorou (e, se houver, o que manteve ou piorou, em tom neutro).
- O app desenha as marcações sobre as fotos e permite **salvar a imagem de comparação** no aparelho: PNG com a pose, as
  duas fotos com as datas, as marcações numeradas e o resumo numerado embaixo (o número liga marca e item). Salvar usa o
  mesmo padrão do zip de fotos (`navigator.share` no celular, download na web).
- A análise fica guardada no servidor por par de fotos (`file_id` antes + `file_id` depois): abrir de novo não gasta
  tokens. "Analisar de novo" refaz e substitui.
- Hevy: o app pede uma sincronização do Hevy ao abrir, ao voltar do fundo e ao entrar na aba Treino, no máximo uma vez a
  cada 5 minutos, e depois puxa as mudanças locais. Sem Hevy conectado, nada acontece.

## Não objetivos

- Não altera nem gera imagem do corpo; a foto é a original, só com desenho por cima.
- Não envia nada à coach nem muda o fluxo da Atualização (questionário, fotos, zip, PDF).
- Não mede o corpo (sem medidas estimadas, % de gordura ou nota).
- Não funciona offline: a tela busca as fotos inteiras pela URL assinada e a análise pelo servidor. Sem rede, mostra a
  miniatura local se houver, ou um aviso.

## Antiobjetivos

- A IA inventar melhora que não dá para ver, ou falar de forma clínica/ofensiva. O prompt pede só o que é visível, tom de
  treinador, e permite "sem diferença visível".
- Gastar tokens sem o Gabriel pedir: a análise só roda no clique.
- Foto ou texto da análise em logs (regra do projeto: conteúdo de payloads nunca em logs).

## Abordagens

- **A (escolhida):** a IA devolve marcações estruturadas (coordenadas normalizadas 0–1 sobre a foto depois, raio, rótulo)
  e um resumo; o app desenha num canvas e exporta PNG. Barato, guardável, sem alterar a foto. Limite: posição aproximada,
  porque o enquadramento das fotos varia.
- **B:** só texto da IA, fotos lado a lado sem desenho. Mais simples, mas perde a imagem marcada pedida.
- **C:** gerar uma imagem nova com IA. Descartada: o modelo usado não gera imagens e uma imagem gerada pode alterar o
  corpo, o que destrói a comparação.

## Desenho

### Tela

- Nova rota **`/atualizacao/comparar`** (texto da UI: "Comparar fotos"), com link na tela da Atualização (perto das
  fotos) e no Resumo/Atualização onde fizer sentido para o builder; aparece só quando há pelo menos duas atualizações com
  foto da mesma pose.
- Topo: seletor de pose (as poses que têm foto em pelo menos dois ciclos, pelos rótulos do questionário; poses antigas
  usam `FORMER_POSE_LABELS`) e dois seletores de atualização ("Antes" e "Depois", pela data do ciclo).
- Corpo: as duas fotos lado a lado (no celular, também lado a lado, cada uma com metade da largura), com a data embaixo.
- Abaixo: "Analisar com IA" (ou o resultado guardado, com "Analisar de novo"), a lista do resumo e "Salvar imagem".
- Estados: carregando, analisando ("Analisando as fotos…"), erro com mensagem curta (sem crédito, IA indisponível,
  timeout), sem fotos suficientes.

### Servidor

- `POST /api/photo-comparisons` com `{ beforeFileId, afterFileId, pose }` → chama a IA com as duas imagens e um tool
  forçado; grava e devolve `{ id, beforeFileId, afterFileId, pose, summary: string[], marks: [{ x, y, r, label }],
  model, createdAt }`. `x`, `y`, `r` são frações (0–1) da largura/altura da foto **depois**. Limites: até 6 marcas, rótulo
  até 40 caracteres, resumo de 1 a 5 itens até 140 caracteres cada; valores fora disso são cortados/descartados.
- `GET /api/photo-comparisons?beforeFileId=&afterFileId=` → a análise guardada (404 se não houver).
- As duas fotos têm de ser do usuário (arquivos dele em ciclos dele); senão 404. Erros em problem details.
- Nova tabela `photo_comparisons` (migration), uma linha por par (único em `user_id, before_file_id, after_file_id`);
  "Analisar de novo" substitui.
- Reaproveitar o `AnthropicClient` (mesma chave/modelo de `Anthropic:*`), estendendo-o para aceitar uma lista de anexos
  (`image` ou `document`, com `media_type`) e a descrição do tool por chamada; a lógica de nova tentativa/crédito do
  `PlanExtractor` vira um helper compartilhado. `max_tokens` baixo (~2000) na comparação.
- Sem biblioteca de imagem no back: o cliente já reduz as fotos no envio (JPEG, lado maior ≤ 2560 px). O servidor confere
  o tamanho de cada foto e devolve 413 se passar do limite da API.
- Validação: `pose` tem de bater com a pose dos dois `file_id` em ciclos não apagados do usuário (jsonb
  `update_cycles.photos`) e arquivos `Photo` confirmados dele; senão 404. Antes = depois → 400; "antes" de ciclo
  posterior ao "depois" → 400 (o front não deixa escolher).
- Erros em problem details com a extensão `code`: `no_credits` e `unavailable` → 503, `timeout` → 504, resposta
  inválida/recusada → 502, imagem grande demais → 413. O front traduz o `code` para pt-BR. (O "Ler com IA" devolve 201
  com rascunho vazio; aqui não há rascunho, por isso o mapeamento próprio.)
- A análise **não** entra no payload de sync nem no `update_cycle`; é só leitura por endpoint.

### Hevy ao abrir

- O cliente chama `POST /api/integrations/hevy/sync` (o mesmo do "Sincronizar agora") nos três momentos, com trava de 5
  minutos guardada no aparelho (localStorage com try/catch) que conta para qualquer tentativa, inclusive 404/409/erro e o
  botão manual. Depois de 200, roda `syncNow()`. Falhas são silenciosas (o status nas Configurações mostra o erro). Sem
  intervalo mínimo no servidor (usuário único; o lock por usuário já evita execuções simultâneas).
- E2E: o `hevy.spec.ts` assume que só "Sincronizar agora" chega ao stub; desligar a sincronização ao abrir no E2E (flag de
  build/ambiente) ou ajustar o spec.

## Restrições

- Regras do `CLAUDE.md`: código em inglês, UI em pt-BR, problem details, nada de payload em logs, versões só em
  `Directory.Packages.props`, `openapi.json` regenerado e versionado, sem dado real em fixtures (fotos de teste
  fictícias, já existentes em `**/fixtures/**`).
- E2E: a IA não é chamada no CI; o stub `frontend/e2e/fixtures/anthropic-stub.mjs` ganha resposta para o novo tool e
  registra os blocos `image` (quantidade, tipo, hash), sem o conteúdo. As fotos de teste são PNG gerados em memória, como
  no `update.spec.ts`.
- As fotos vão para a API da Anthropic só quando o Gabriel toca em "Analisar com IA" (ele autorizou usar a IA para isso).

## Fica para o builder

- Posição exata dos links para a tela de comparação.
- Estilo das marcações (cor do token de destaque, contorno para contraste, numeração ligando marca e item do resumo).
- Texto do prompt (seguindo os antiobjetivos) e o schema do tool.
