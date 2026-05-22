# Website Log Horas — IRN

Aplicacao web para registo de horas de trabalho no OpenProject do IRN (Instituto dos Registos e do Notariado). Apresenta um calendario mensal, recomendacoes inteligentes baseadas no **historico de estados** das tarefas e um **assistente de IA** que distribui horas a partir de uma descricao em linguagem natural.

## Quick start

```bash
npm install
npm run dev
# abre http://localhost:3000
```

Cola o teu API token do OpenProject (Profile → Access tokens) e entra. O calendario carrega as tarefas e o historico.

## Funcionalidades

- **Recomendacoes baseadas no historico de estados.** Cada tarefa tem uma timeline completa (Novo → Em Desenvolvimento → MR em DEV → Desenvolvido…). Em cada dia, o motor sabe em que estado a tarefa estava e atribui mais horas a dias de desenvolvimento ativo e menos a dias de revisao/QA. Tarefas em estado terminal nesse dia sao automaticamente excluidas.
- **Pesos por estado configuraveis.** No painel de definicoes podes ajustar quanto cada estado contribui (slider 0–1). Por defeito: "Em Desenvolvimento" = 1.0, "MR em DEV/QA" = 0.4, "Em Teste" = 0.3, "Novo" = 0.2, terminal = 0.
- **Assistente de IA pluggable.** Carrega `Ctrl+K`, descreve o teu trabalho ("trabalhei nos Documentos Compostos esta semana"), revê a proposta e aceita. Suporta **Google Gemini**, **Groq** e **Ollama** (local).
- **Calendario mensal** com feriados nacionais portugueses (fixos + moveis baseados na Pascoa).
- **Visualizacao do estado das horas** (verde = correto, vermelho = em falta, amarelo = incorreto), pip colorido por tarefa indicando o peso do estado no dia.
- **Timeline de actividade** dentro do modal de cada tarefa — barra horizontal segmentada por estado, com tooltips das datas.
- **Preencher Semana / Mes** automaticamente, respeitando o historico de estados e o horario configurado.
- **Pinning manual** de tarefas a dias especificos (prioridade no scoring).
- **Filtragem por sprint** com auto-deteccao do sprint com mais tarefas; periodo destacado no calendario.
- **Atalhos de teclado** completos (ver tabela abaixo).
- **Atualizacao otimista** dos dias apos guardar/apagar, com spinners por dia em operacoes bulk.
- **Toast notifications** nao-bloqueantes (sucesso, erro, aviso).
- **Sidebar de tarefas** com pesquisa difusa, filtro por sprint e atalho de logout.

### Estados das tarefas (defaults)

| Estado | Peso | Comportamento |
|--------|------|---------------|
| Em Desenvolvimento / In Progress | 1.0 | Maximo de horas |
| A Desenvolver | 0.8 | Quase total |
| MR em DEV / MR em QA | 0.4 | Reduzido (revisao) |
| Em Teste / QA | 0.3 | Reduzido (testing) |
| Desenvolvido / Developed | 0.3 | Ainda recebe horas (touch-ups, QLD, bug-fixes) |
| Novo / New | 0.2 | Toque ligeiro |
| On Hold / Bloqueado / Rejeitado | 0.1 | Horas reduzidas se houve trabalho |
| Fechado / Closed | 0.0 | **Unico estado verdadeiramente terminal** |

Todos os pesos sao ajustaveis no painel Definicoes → Pesos.

## Atalhos de teclado

| Atalho | Acao |
|--------|------|
| `Ctrl+K` / `Cmd+K` | Abrir paleta de comandos (IA) |
| `←` / `→` | Mes anterior / seguinte |
| `T` | Saltar para hoje |
| `W` | Preencher semana |
| `M` | Preencher mes |
| `S` | Abrir definicoes |
| `Esc` | Fechar modal/paleta |

Atalhos que nao sao `Ctrl+K` nem `Esc` ficam desativados enquanto o cursor esta num campo de texto.

## AI Setup

A configuracao do fornecedor de IA fica em **Definicoes → IA**. A chave fica **apenas no teu browser** (localStorage) e e enviada por pedido para o endpoint do fornecedor — o servidor nao a regista.

### Google Gemini (recomendado)

1. Cria uma chave gratuita em [ai.google.dev](https://ai.google.dev).
2. Modelo usado: `gemini-2.5-flash-lite` (gratuito, ~1000 req/dia).
3. Cola a chave no campo "API Key" e clica em "Testar ligacao".

### Groq

1. Cria conta gratuita em [console.groq.com](https://console.groq.com).
2. Gera uma chave em "API Keys".
3. Modelo usado: `llama-3.3-70b-versatile` (latencia ~200 ms).

### Ollama (totalmente local, sem chave)

1. Instala em [ollama.com](https://ollama.com).
2. Faz pull de um modelo: `ollama pull qwen2.5:7b` (ou `llama3.1:8b`).
3. Confirma que esta a correr (`http://localhost:11434`).
4. No painel, escolhe **Ollama**, coloca a URL e o nome do modelo. **Os dados nunca saem da tua maquina.**

## Como rodar

### Desenvolvimento local

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

### Comandos

| Comando | Descricao |
|---------|-----------|
| `npm run dev` | Servidor de desenvolvimento (3000) |
| `npm run build` | Build de producao |
| `npm run start` | Servidor de producao |
| `npm run lint` | ESLint |

### Deploy com Docker

```bash
./deploy.sh    # Linux/Mac
deploy.bat     # Windows
```

Producao corre na porta **3700** (container: `website-log-horas`).

## Stack

- **Next.js 16** (App Router) + Turbopack
- **React 19**
- **TypeScript** (strict)
- **Tailwind CSS 4** com design tokens em `app/globals.css`
- **Fuse.js** (correspondencia difusa de tarefas; unica dependencia adicionada para a IA)
- **OpenProject REST API v3**

Nao usa SDKs dos fornecedores de IA — todas as chamadas sao `fetch`.

## Arquitetura

```
app/
  page.tsx                          # Login screen + montagem do Calendar/AppShell
  layout.tsx                        # Root layout (lang=pt)
  globals.css                       # Tokens de design + animacoes
  api/
    openproject/
      verify-token/route.ts         # Token + tarefas + activity timeline + horas + sprints
      get-task/route.ts             # Tarefa por ID
      add-time-entries/route.ts     # Criar entradas (decimal → ISO 8601)
      clear-time-entries/route.ts   # Apagar entradas (scoped por utilizador)
    ai/
      distribute/route.ts           # Orquestrador da distribuicao IA
components/
  Layout/
    AppShell.tsx                    # Shell: sidebar + topbar + main + drawer
    Sidebar.tsx                     # Tarefas, sprint, pesquisa, logout
    TopBar.tsx                      # Nav, paleta, settings cog
    SettingsDrawer.tsx              # Drawer com tabs Horario/Pesos/IA/Meetings
  Calendar/
    index.tsx                       # Orquestrador (state, API actions, AI flow)
    DayCell.tsx                     # Celula com status pip e animacoes
    TaskModal.tsx                   # Detalhes + ActivityTimelineStrip
    ConfirmationModal.tsx
    ClearHoursModal.tsx
    ClearMonthModal.tsx
  CommandPalette/index.tsx          # Paleta IA (Ctrl+K)
  AIPreviewModal/index.tsx          # Pre-visualizar e editar proposta IA
  AISettings/index.tsx              # Picker do fornecedor de IA
  ActivityTimelineStrip/index.tsx   # Strip horizontal de estados
  StatusWeightSettings/index.tsx    # Sliders de pesos
  QuickHoursForm/index.tsx          # Formulario rapido de horas (com timeline)
  WeekFillModal/index.tsx           # Preencher semana
  MonthFillModal/index.tsx          # Preencher mes
  ScheduleSettings/index.tsx        # Configuracao do horario
  TaskAssignmentModal/index.tsx     # Atribuir tarefas a dias
  Toast/                            # Sistema de notificacoes
hooks/
  useWorkSchedule.ts                # Horario Verao/Inverno (localStorage)
  useTaskAssignments.ts             # Pinning (localStorage)
  useStatusWeights.ts               # Pesos por estado (localStorage)
  useAIProvider.ts                  # Config IA (localStorage, so cliente)
  useKeyboardShortcuts.ts           # Atalhos globais
lib/
  calendar-utils.ts                 # Utilitarios (formatHours, toKey, etc.)
  holidays.ts                       # Feriados nacionais
  recommendations.ts                # Motor unificado (timeline + historico + pins)
  task-filtering.ts                 # Filtro coarse activeFrom/activeUntil (inalterado)
  status-timeline.ts                # Pesos por defeito + helpers timeline
  ai/
    provider.ts                     # Interface AIProvider
    gemini.ts / groq.ts / ollama.ts # Adapters
    factory.ts                      # getProvider(config)
    matcher.ts                      # Fuse.js wrapper
    prompt.ts                       # Prompt PT + validador JSON
    distribute.ts                   # Orquestrador (match → LLM → validar)
types/index.ts                      # Tipos centralizados
plans/                              # Planos historicos + activity-aware redesign
```

## Changelog

### 2026-05-22 — "Tarefa activa no dia" deixa de incluir Desenvolvido parado

Problema: `tarefas_activas_por_dia` incluia qualquer tarefa com um segmento "Desenvolvido" aberto a cobrir o dia — mesmo as que ficaram Desenvolvidas ha semanas e estao paradas. Isso enchia a shortlist (23 tarefas, quase todas paradas) e o modelo registava horas nelas em vez das que estavam mesmo a ser trabalhadas.

- [lib/ai/prompt.ts](lib/ai/prompt.ts): `isActiveOnDay` redefinida. Uma tarefa e activa no dia `d` se (a) nesse dia estava num estado de PIPELINE de trabalho (Em Desenvolvimento, MR para DEV, Em DEV (em testes), Em Code Review, Em Testes, EM QA) — "Desenvolvido"/"Novo"/"On hold"/"Bloqueado"/terminal NAO contam; OU (b) mudou de estado a ate 2 dias de `d` (ex: chegou a "Desenvolvido" nesse proprio dia). Comparacao de estados insensivel a acentos. Charter actualizado com a nova definicao.

### 2026-05-22 — Historico de estados completo no prompt

- [lib/ai/prompt.ts](lib/ai/prompt.ts): deixamos de filtrar os segmentos ao intervalo pedido (`segmentsOverlappingRange` removido). A IA passa a receber o HISTORICO COMPLETO de cada tarefa — todos os estados por que passou e quando — tal como aparece na timeline da UI. Antes, num pedido de 1 dia, so via o segmento que tocava esse dia e perdia o contexto (Novo → MR para DEV → Desenvolvido → EM QA…). Charter actualizado para o modelo saber que `segments` e o historico completo.

### 2026-05-22 — Serializacao de tarefas no prompt: legivel + ordenada

- [lib/ai/prompt.ts](lib/ai/prompt.ts): os segmentos passam de tuplos para objectos auto-descritivos `{estado, de, ate}` (chaves PT, como na UI) — legivel para o modelo e para nos. `ate` so aparece quando o estado ja terminou; `inferido: true` marca assumpcoes. Charter actualizado.
- As tarefas no prompt passam a estar ordenadas por dia ascendente (pela data da ultima mudanca de estado em intervalo), para o modelo as ler do mais antigo para o mais recente.

### 2026-05-22 — Janela de sprints (anterior + atual + proxima)

- Novo [lib/sprint-filtering.ts](lib/sprint-filtering.ts): `getSprintWindowNames` / `filterTasksToSprintWindow`. "Atual" = ultima sprint cujo `startDate` ja passou; a janela e `[anterior, atual, proxima]` sobre a ordem cronologica. Tarefas fora da janela — e tarefas SEM sprint — sao descartadas. Salvaguarda: se nenhuma sprint tiver datas, nao filtra (evita lista vazia).
- Aplicado globalmente em [components/AppDataProvider.tsx](components/AppDataProvider.tsx) ao carregar os dados, por isso a sidebar, o calendario e o assistente de IA passam todos a ver o mesmo conjunto. Deixam de aparecer work packages abertos ha mais de ~1 mes.

### 2026-05-22 — Descricao do MR como contexto (IDs + excerto)

- [lib/gitlab/client.ts](lib/gitlab/client.ts): a descricao do MR e agora lida. O `extractTaskIds` corre tambem sobre ela, por isso um `Refs: #32195` no corpo (mesmo que o titulo nao o tenha) produz match automatico/deterministico. Novo helper `snippetOf` condensa a descricao (remove markdown, colapsa espacos) num excerto de ate 240 chars.
- `GitLabActivity.descriptionSnippet` (novo campo, [types/index.ts](types/index.ts)) transporta esse excerto. O prompt ([lib/ai/prompt.ts](lib/ai/prompt.ts)) inclui-o como `desc` em cada item GitLab, dando ao modelo contexto fuzzy para escolher a tarefa quando nao ha id resolvido. Charter actualizado.
- Commits nao trazem corpo (o evento de push so da `commit_title`), por isso isto aplica-se a MRs.

### 2026-05-22 — Shortlist de tarefas activas por dia no prompt

- `buildDistributePrompt` ([lib/ai/prompt.ts](lib/ai/prompt.ts)) passa a incluir `tarefas_activas_por_dia`: para cada dia-alvo (chaves de `expectedHoursPerDay`), uma lista pre-calculada dos taskIds em desenvolvimento activo nesse dia (segmento a cobrir a data num estado de trabalho — "Em Desenvolvimento", "Desenvolvido", "MR para DEV", "Em DEV (em testes)", "EM QA"). O modelo enche a cobertura a partir desta lista em vez de reanalisar os 60 segmentos e fazer aritmetica de datas — o passo que modelos fracos erram. Charter actualizado para usar a lista directamente.

### 2026-05-22 — Parser tolerante a `dayKey` em falta

- `parseDistributeResponse` ([lib/ai/prompt.ts](lib/ai/prompt.ts)): aceita `date` como alias de `dayKey` e, quando o intervalo cobre um unico dia (`from === to`), assume esse dia se o modelo omitir o campo. Antes, accoes `log_hours` validas eram descartadas com "Ignorada log_hours com dayKey invalido" so porque o modelo (ex: DeepSeek) nao incluiu `dayKey`. Mensagem de aviso agora diz "(em falta)" quando o campo nao vem de todo.

### 2026-05-22 — Cobertura do dia baseada na timeline (GitLab como reforco)

Quando a unica pista era um commit/MR sem `#ID` correspondente, o assistente deixava o dia vazio (modelos fracos chegavam a inventar uma associacao errada). Agora a timeline lidera e o GitLab e reforco:

- **`docs/ai/charter.md` — seccao "Cobertura do dia" reforcada.** O alvo passa a ser sempre encher cada dia util ate `expectedHoursPerDay[d]`, distribuindo pelas tarefas em desenvolvimento activo no dia. Adicionada definicao explicita de "tarefa em desenvolvimento activo num dia" (segmento que inclui a data em estado de trabalho) e um **FALLBACK obrigatorio**: se a evidencia GitLab nao chegar, completa com essas tarefas (com `confidence` baixa e `reason` a indicar que e por estado/timeline). So deixa o dia por encher quando nao existe nenhuma tarefa activa, registando a falha numa linha do `reasoning` ("Faltam Xh em \<dia\> sem evidencia suficiente para atribuir").
- **Presets de instrucao reescritos** ([components/CommandPalette/index.tsx](components/CommandPalette/index.tsx) `GITLAB_PROMPT` e prefill por dia em [components/Calendar/index.tsx](components/Calendar/index.tsx)) para liderarem com "preenche ate ao limite com tarefas em desenvolvimento activo" e tratarem o GitLab como reforco.
- Nota: o `reasoning` (texto livre) substitui o pedido inicial de "warnings" — o schema da resposta nao tem campo `warnings` (esses sao gerados pelo parser, nao pelo modelo).

### 2026-05-20 — Fase 13: Seguranca, hygiene SOLID, performance, /setup, vista GitLab por dia

**Seguranca (rotas API + GitLab):**
- Novo `lib/security/`: `url-validation.ts` (`assertValidExternalUrl` — valida que o URL do OpenProject/GitLab e http(s) bem-formado antes de qualquer fetch), `validate.ts` (`assertNumericId` para taskId/statusId), `safe-error.ts` (`genericUpstreamError` — nunca devolve o corpo bruto da resposta upstream ao cliente).
- Aplicado em todas as rotas `app/api/openproject/*` e em `lib/gitlab/client.ts`. Fecha o vetor de fuga do token GitLab (o erro deixava de incluir `body.slice(0,200)`) e o eco de respostas OpenProject (add/clear time-entries, update-status, get-task).
- `next.config.ts`: headers de seguranca (X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, CSP com frame-ancestors 'none', HSTS). CSP mantida conservadora para nao quebrar a hidratacao do Next.
- Nota: validacao de URL minima (sem allowlist nem bloqueio de IPs privados) por decisao — o deploy do IRN e interno e uma allowlist arriscaria parti-lo.

**Hygiene / SOLID:**
- ESLint baseline a 0 erros: corrigido setState-em-useEffect (`QuickHoursForm`, agora deriva via `useMemo` + overrides por taskId), setState-em-useMemo (`WeekFillModal`, agora padrao de reset em render), `any` nas rotas (novo `lib/openproject/api-types.ts`), deps desnecessarias e cleanup de ref no Toast.
- Novos utilitarios partilhados: `lib/storage/localStore.ts` (+ `createLocalStorageHook.ts`) — primitivas SSR-safe que removem o try/catch duplicado; `useAIProvider`/`useGitLabConfig`/`useTimelineInference`/`useWorkSchedule` migrados. `lib/work-schedule.ts` (`expectedHoursForDate`/`expectedHoursForDayKey`) — unifica a logica antes duplicada em `distribute.ts` e `useWorkSchedule`. `lib/net/opFetch.ts` (wrapper de fetch autenticado) e `lib/net/mapLimit.ts` (concorrencia limitada).

**Performance / Next.js:**
- `verify-token`: o fan-out N+1 de atividades por tarefa passa a usar `mapLimit` (6 em simultaneo) em vez de `Promise.all` sem limite.
- `app/page.tsx`: removido o `useEffect([])` com eslint-disable — agora corre uma vez com guarda de ref; `fetchTodos` em `useCallback`.
- `lib/ai/charter.ts`: faz log (sem segredos) quando recorre ao fallback, para um bundle serverless sem `docs/ai/charter.md` ser visivel em vez de silencioso.

**/setup (substitui o cartao de login):**
- Nova rota `app/setup/page.tsx`: OpenProject (obrigatorio) + GitLab (opcional) + IA (opcional), reutilizando `GitLabSettings` e `AISettings`. Sem token, `app/page.tsx` redireciona para `/setup`; o logout tambem.

**Payload da IA legivel + timestamps:**
- As chaves do Contexto JSON passaram de abreviadas (`t`/`r`/`d`/`seg`/`h`/`sid`/`k`/`u`/`n`) para auto-descritivas (`title`/`taskIds`/`date`/`segments`/`hoursLogged`/`statusId`/`kind`/`unmatchedRefIds`/`name`); `dias_esperados`→`expectedHoursPerDay`. `docs/ai/charter.md` sincronizado.
- Cada commit/MR leva agora `time` (HH:MM); a forma resumida leva `firstTime`/`lastTime`. Nova regra no charter: usar o intervalo de tempos do dia para estimar duracao, arredondando a 0.5h e sem ultrapassar o alvo.

**Vista GitLab por dia (modal do dia):**
- Novo `hooks/useDayGitLabActivity.ts` (fetch lazy + cache por dia) e `components/GitLabActivityList.tsx` (lista partilhada de commits/MRs com hora, refs e link).
- O modal do dia ganha um botao "GitLab" que mostra os commits/MRs desse dia (com contagem), alarga para `max-w-2xl` quando aberto, e oferece "Registar horas via IA" ancorado a esse dia. As recomendacoes continuam escondidas por defeito.

**Rotas reais `/` e `/kanban` + provider de dados partilhado:**
- Novo grupo de rotas `app/(app)/` com `layout.tsx` que monta `components/AppDataProvider.tsx` (auth + dados OpenProject + fetch/refresh/logout). `/` → `CalendarRoute initialView="calendar"`, `/kanban` → `CalendarRoute initialView="kanban"`.
- O toggle Calendario/Kanban no TopBar passa a navegar (`router.push`) entre `/` e `/kanban`. Como o provider vive no layout do grupo `(app)`, alternar de vista NAO refaz o fetch — os dados persistem.
- `/setup` fica fora do grupo `(app)`: entrar/sair cruza essa fronteira e re-inicializa o provider com o token fresco (sem token, o provider redireciona para `/setup`). O antigo `app/page.tsx` foi removido (substituido por `app/(app)/page.tsx`).

**Diferido:** o split interno de `AIPreviewModal`/`Calendar` em ficheiros mais pequenos (organizacional; alto risco sem testes de UI).

### 2026-05-19 — Fase 12: IA como agente multi-accao + GitLab proactivo + modo seguranca + docs-as-charter

**Charter da IA como ficheiros MD (`docs/ai/`):**
- `docs/ai/charter.md` — o prompt do sistema canonico em portugues. Carregado em runtime via `lib/ai/charter.ts` (`fs.readFileSync` em modulo init). Editar este ficheiro muda o comportamento da IA sem mudar codigo.
- `docs/ai/capabilities.md`, `docs/ai/safety.md`, `docs/architecture.md`, `docs/components/{calendar,kanban,ai-flow,gitlab}.md` — espelhos para devs do que a IA sabe + como o sistema esta estruturado.

**Accoes multi-tipo (`AIAction` discriminated union):**
- Novo tipo `AIAction = log_hours | update_status`. A IA pode agora propor mudancas de estado de tarefa **e** registo de horas no mesmo plano ("Pus os Documentos Compostos em Em Desenvolvimento e proponho 4h hoje").
- Schema JSON `{"reasoning":"...","actions":[...]}` enviado aos providers que suportam `responseSchema`. Parser aceita o shape legado `{items:[...]}` como `kind:"log_hours"` para back-compat de uma release.
- `parseDistributeResponse` retorna `actions: ParsedAction[]` com discriminacao por `kind`; valida `toStatusId` contra `availableStatuses`.

**Apply pipeline multi-accao (`lib/ai/apply-actions.ts`):**
- Helper `applyActions(actions, ctx)` dispara `log_hours` em paralelo por dia (1 POST a `/api/openproject/add-time-entries` por dia) e `update_status` sequencialmente (cada chamada faz bump ao `lockVersion`).
- Resultados per-accao: succedidas sao apagadas do modal, falhadas ficam vermelhas. Toast "N estados alterados; M falharam" no fim.

**Modo seguranca "understand-first" (`useAISafetyMode`, ON por defeito):**
- Novo endpoint `app/api/ai/understand/route.ts` faz uma chamada curta que devolve `{"interpretation":"..."}` em 1-2 frases.
- Quando o toggle esta ON, o flow da paleta passa a ter 2 passos: 1) IA parafraseia o que entendeu; 2) modal "Aqui esta o que entendi: <interpretacao>" com `Avancar` / `Reformular` / `Saltar seguranca`. Saltar afecta so a chamada actual; nao muda o toggle.
- Hook `useAISafetyMode` persiste em `ai_safety_mode_v1`.

**Banner proactivo GitLab no TopBar:**
- Hook `useGitLabActivityCheck` fetcha actividade do proprio dia ao montar. Quando ha commits/MRs e o utilizador nao dispensou hoje, o TopBar mostra `[● 5 commits hoje · Revisar]`.
- Clicar abre a paleta pre-preenchida com `"Revisa a minha actividade GitLab de hoje e propoe alteracoes (estado + horas)."` e `range: "day"`. Nunca auto-executa.
- Dispensar persiste em `gitlab_banner_dismissed_at_v1`; reaparece no proximo dia.

**Audit log (`useAuditLog`):**
- Ring buffer de 200 entradas em `audit_log_v1` (localStorage). Cada accao aplicada com sucesso (status change neste momento; horas vao na proxima iteracao) escreve `{ts, kind, taskId, taskTitle, before, after, source}`.
- Base para a tab "Historico" no SettingsDrawer (UI a vir numa proxima sessao).

**Modal preview com linhas de status:**
- `AIPreviewModal` renderiza, acima dos grupos de dias, um painel "Mudancas de estado propostas" com checkbox por linha (toggle excluir), badge de confianca (alta/media/baixa) e label `De → Para`.
- Botao "Aplicar" muda para `Aplicar (Nh + M estados)` quando ha mudancas de estado seleccionadas.

**Charter como prompt sistema:**
- `buildDistributePrompt` chama `getCharterSystemPrompt()` para a mensagem `role:"system"`. Condicionais runtime (GitLab presente, meetings auto, lista de estados) viram um apendice curto abaixo do charter.
- A IA recebe agora tambem `estados_disponiveis: [{id, n, c}]` para poder emitir `update_status` validamente.

**Resolucao automatica de refIds (#6026 → tarefa 32397):**
- O IRN poe a referencia de negocio (#6026) no TITULO de uma tarefa cujo id OpenProject e diferente (#32397). O modelo nao conseguia fazer essa correspondencia de forma fiavel.
- Agora o `taskIndex` (orquestrador) e o builder do prompt resolvem cada refId em dois passos: (1) id exacto da tarefa, (2) `#NNNN` literal dentro do titulo. O payload enviado a IA ja traz `r` = ids de tarefas resolvidos e `u` = refIds sem correspondencia (que o modelo sinaliza). A regra do charter foi reescrita para "confia em `r`, sinaliza `u`".

**Cobertura do dia (preencher ate ao alvo):**
- A IA recebe agora `dias_esperados: {"YYYY-MM-DD": <horas>}` com as horas concretas por dia (resolvidas do horario), em vez de ter de inferir a estacao + dia-da-semana a partir do texto.
- Charter passou a instruir o modelo a ATINGIR `dias_esperados[d]` quando ha actividade GitLab confirmada, distribuindo proporcionalmente pelas tarefas com refId.
- Safety-net server-side `fillDailyTotals`: escala para CIMA os dias com actividade ate ao esperado (complementa o `clampDailyTotals` que escala para baixo). Nunca inventa horas em dias vazios.

**Outras melhorias:**
- `DistributeInput` aceita `availableStatuses` e `timeEntriesData`; orchestrator passa-os ao prompt e ao parser.
- `DistributeResult` agora expoe `actions: AIAction[]` (e mantem `items: AIDistributionItem[]` como alias de back-compat).
- Mensagem de retry actualizada para pedir `{"actions":[...]}` em vez de `{"items":[...]}`.
- O Calendar reseta o estado de status-actions em cancel/aplicar, e injecta auditoria em cada update bem-sucedido.

### 2026-05-19 — Sessao 7: Polish, theme toggle, mais IA, GitLab, inferencia de estados

**Bug fix critico no parser de timeline:**
- Atividades em portugues (`*Situacao* alterado de *Novo* para *Em Desenvolvimento*`) nao eram detetadas porque o parser procurava `detail.property === "status"` (nao usado pelo OpenProject PT) e fallback para `entry.comment.raw` (vazio em mudancas auto-geradas). Agora le `detail.raw` markdown directamente, ainda com regex PT/EN.
- Regex multi-palavra: `para\s+(.+?)(\s|$|<)` truncava "Em Desenvolvimento" em "Em". Substituido por regex que aceita o estado completo ate fim de linha/pontuacao/tag.
- Clamp `seg.toDate < seg.fromDate`: segmentos com fim antes do inicio sao corrigidos para serem segmentos de 1 dia.
- Transitions com data anterior a `createdAt` sao descartadas.
- Append do estado atual usa `updatedAt` (nao a data da ultima transicao), evitando segmentos zero-length.

**Inferencia de "Em Desenvolvimento" (NOVO):**
- Quando o OpenProject salta de "Novo" para "Desenvolvido" sem registar o desenvolvimento, e inserido um segmento sintetico marcado `inferred: true`.
- Configuravel em **Definicoes → Inferencia**: lista de estados iniciais, terminais, e estado a inserir.
- Visualmente apresentado com riscas diagonais no `ActivityTimelineStrip`. Clica para abrir a paleta IA com prompt pre-preenchido: "Confirma o que fizeste em <task> entre <from> e <to>".
- A IA recebe segmentos `inferred: true` no prompt e sabe que tem de perguntar ou propor horas conservadoras.

**Theme toggle (light / dark / system):**
- CSS migrado de `@media (prefers-color-scheme: dark)` para Tailwind 4 `@variant dark (.dark *)`.
- Novo `useTheme` (localStorage `theme_v1`) que aplica a classe `.dark` no `<html>` e ouve mudancas do sistema quando em modo "system".
- Botao no top bar cicla entre os tres modos (icones sol / lua / monitor).

**Sidebar scrollavel:**
- `h-full` adicionado ao `<aside>` e ao wrapper do `AppShell` para a lista de tarefas ter altura limitada e a barra de scroll interna funcionar.

**Calendar cells uniformes:**
- Altura fixa `h-28` em todas as celulas (incluindo dias sem tarefas), cap de 2 tarefas visiveis + "+N mais".

**Mais fornecedores de IA:**
- **OpenRouter** — modelos gratuitos (`meta-llama/llama-3.3-70b-instruct:free`, `google/gemini-flash-1.5:free`) e pagos (Claude, GPT-4). Headers de atribuicao incluidos.
- **OpenAI-compativel generico** — qualquer endpoint (LM Studio, vLLM, FastChat, DeepInfra, Together, Mistral La Plateforme...). URL base + modelo + chave opcional.
- 5 opcoes no picker, valores predefinidos por fornecedor.

**Integracao GitLab:**
- Nova tab "GitLab" em Definicoes: URL + Personal Access Token. Botao "Testar ligacao" chama `/api/v4/user`.
- `/api/gitlab/activity` busca commits e MRs do utilizador no intervalo. Extrai IDs de tarefa do titulo/branch (regex `(?:wp[-_]?|#)?(\d{4,6})`).
- Distribuicao IA: GitLab activity gera linhas baseline (1h por commit, 2h por MR) com `source: "gitlab"`; depois a IA refina e mescla.
- Preview modal mostra badge "GitLab" (laranja) ou "IA" (indigo) em cada linha.

**Tooltips na timeline:**
- `ActivityTimelineStrip` agora tem tooltip custom (nao native `title`) com nome, intervalo e peso. Aparece imediatamente no hover. Indica "inferido — clica para confirmar" em segmentos sinteticos.

**Default winter schedule:**
- Mudado de Mon-Thu=9h, Fri=9h para Mon-Thu=9h, Fri=7h (alinha com o horario IRN).

**Lint:**
- `useStatusWeights`, `useAIProvider`, `useTheme`, `useGitLabConfig`, `useTimelineInference` todos usam lazy initializers (evitam setState-in-effect cascading renders).
- `CommandPalette` usa keyed remount para inicializar state a partir de props sem setState-in-effect.

### 2026-05-19 — Sessao 5: Activity-aware scoring, AI assistant, full redesign

**Status timeline em vez de bookends:**
- `verify-token` agora extrai a timeline completa de cada tarefa (lista de segmentos `{status, fromDate, toDate}`), nao apenas `activeFrom`/`activeUntil`. As tres heuristicas de parsing (structured details, regex PT, regex EN) sao todas preservadas.
- Novo `lib/status-timeline.ts` com pesos predefinidos, `getStatusWeightForDay`, `deriveActiveBounds` (mantem `activeFrom`/`activeUntil` para nao quebrar o filtro coarse).
- `TodoItem` ganhou `timeline?: TaskStatusTimeline`.

**Motor de recomendacao unificado:**
- `lib/recommendations.ts` aceita agora `timelines` + `statusWeights` opcionais. Score: +4 para `dayWeight ≥ 0.5`, +2 para review states, -5 para terminais (efetivamente excluidos), alem dos +3 pinned / +2/+1 historico ja existentes.
- Horas brutas sao escaladas por `max(dayWeight, 0.2)` antes do scale-to-fill (que ficou intocado para garantir totais exatos).
- `SmartRecommendation.source` ganhou `"activity"`.
- `QuickHoursForm`, `WeekFillModal`, `MonthFillModal` propagam `timelines` + `statusWeights` automaticamente.

**Pesos configuraveis:**
- `hooks/useStatusWeights.ts` persiste overrides em `status_weights_v1`.
- `components/StatusWeightSettings/index.tsx` apresenta uma fila de sliders por estado detetado + predefinidos, com reset por estado e global.

**Redesign completo da UI:**
- Novo shell `AppShell` (sidebar colapsavel + top bar + drawer direito).
- `Sidebar` com info de utilizador, dropdown de sprint, pesquisa difusa de tarefas e logout.
- `TopBar` com navegacao do mes, acoes rapidas, paleta IA e settings cog.
- `SettingsDrawer` com tabs Horario / Pesos / IA / Meetings — consolida definicoes antes dispersas.
- `DayCell` redesenhado: cantos suaves, hover lift, animacoes de fade, pip colorido por tarefa indicando peso do estado nesse dia.
- `TaskModal` redesenhado com `ActivityTimelineStrip` (barra horizontal segmentada pelos estados, com legenda e tooltips).
- Design tokens em `globals.css`: `--accent`, `--success`, `--warn`, `--danger`, `--surface-1/2/3`, `--text-1/2/3` + animacoes `fade-in`, `slide-in-right`, `slide-up`, `pulse-soft`.
- Atalhos de teclado globais via `hooks/useKeyboardShortcuts.ts` (`Ctrl+K`, setas, T, W, M, S, Esc).
- Login screen polida com gradient avatar e copy mais clara.

**Assistente IA pluggable (`Ctrl+K`):**
- Adapters para **Gemini 2.5 Flash-Lite**, **Groq Llama 3.3 70B**, e **Ollama** (local) em `lib/ai/{gemini,groq,ollama}.ts`. Todos usam `fetch`, zero SDKs.
- `lib/ai/matcher.ts` faz pre-filtragem com Fuse.js (accent-insensitive, threshold 0.5).
- `lib/ai/prompt.ts` constroi um prompt PT estrito a pedir JSON; trunca segmentos a 60 dias para controlar tokens.
- `lib/ai/distribute.ts` orquestra: fuzzy match → top-N tarefas → LLM → `parseDistributeResponse` (valida taskIds, intervalo, hours multiplos de 0.5).
- `app/api/ai/distribute/route.ts` recebe `providerConfig` por pedido e nao regista a chave.
- `components/AIPreviewModal` mostra a proposta agrupada por dia, com hours editaveis, motivo, e botao "Aceitar e guardar" que reutiliza `/api/openproject/add-time-entries`.
- `components/CommandPalette` com sugestoes, escolha de intervalo (Hoje / Esta semana / Este mes), `⌘Enter` para submeter.
- `components/AISettings` no drawer com picker entre Gemini/Groq/Ollama, campo de chave (password), URL+modelo para Ollama, botao "Testar ligacao".
- Nova dependencia: `fuse.js`.

**Outras melhorias:**
- `app/page.tsx` reescrita com initializers lazy do `useState` (evita cascading renders em React 19).
- Calendar agora aceita `userName`, `userEmail`, `onLogout` e monta o `AppShell` internamente.
- Body scroll lock estendido para incluir paleta, drawer e preview modal.

### 2026-03-27 — Sessao 4: Fix activeFrom + Fix Horas a Mais

- Motor de recomendacao podia gerar horas acima do target — corrigido com loop iterativo que ajusta 0.5h de cada vez.
- `activeUntil` parsing usa structured details + text parsing PT/EN + fallback por status atual.
- `activeFrom` agora arranca de `createdAt` em vez de ficar `null` quando nao havia mudancas de status.
- Modal do dia usa dados live de `timeEntries.byDay`.

### 2026-03-27 — Sessao 3: Loading States, Auth Bugs, Optimistic Updates

- Spinner por dia durante save/clear; clique desativado.
- Atualizacao otimista de `timeEntries` apos sucesso.
- Fix double-encoding na rota `get-task`.
- Fix `clear-time-entries` a filtrar por user via `/users/me`.

### 2026-03-27 — Sessao 2: Toasts, Distribuicao Dinamica, Semana Navegavel, Sprints

- Toasts substituem 12 `alert()`.
- `verify-token` busca activity history e calcula `activeFrom`/`activeUntil` (single window).
- `WeekFillModal` navegavel para qualquer semana.
- Sprint dates destacadas no calendario.
- `MonthFillModal` com grelha semanal e cores por estado.

### 2026-03-27 — Sessao 1: Fundacao

- Bug "No Tasks for this month" corrigido (status field).
- Crash de Invalid Date corrigido.
- Recomendacao por scoring (pinned +3 / recent +2 / history +1).
- Filtragem por sprint com auto-deteccao.
- Horario Verao/Inverno configuravel.
- Pinning de tarefas a dias.
- Calendar decomposto em sub-componentes.
