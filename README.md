# Website Log Horas - IRN

Aplicacao web para registo de horas de trabalho no OpenProject do IRN (Instituto dos Registos e do Notariado).

## Funcionalidades

- Autenticacao via API token do OpenProject
- Calendario mensal com feriados nacionais portugueses (fixos + moveis baseados na Pascoa)
- Visualizacao do estado das horas por dia (verde = correto, vermelho = em falta, amarelo = incorreto)
- Spinner animado por dia durante operacoes de guardar/apagar, com atualizacao otimista de cores
- Recomendacao inteligente de horas baseada no historico de trabalho (scoring: pinned +3, recente +2, historico +1)
- Tarefas filtradas por dia — so aparecem tarefas que estavam ativas nesse dia (`activeFrom`/`activeUntil`)
- Selecao rapida de tarefas com horas pre-preenchidas (baseado no historico)
- Preenchimento de semana inteira (navegavel para qualquer semana)
- Preenchimento de mes inteiro (grelha semanal com pre-visualizacao)
- Possibilidade de editar as horas recomendadas antes de guardar
- Atribuicao manual de tarefas a dias especificos (pinning)
- Horario de trabalho configuravel (Verao/Inverno, horas por dia da semana)
- Filtragem por sprint com visualizacao do periodo no calendario
- Guardar e apagar horas diretamente no OpenProject
- Limpar horas de qualquer combinacao de dias (modal com calendario mensal)
- Toast notifications nao-bloqueantes (sucesso, erro, aviso)

### Status das Tarefas

| Status | Significado | Incluido nas recomendacoes |
|--------|-------------|---------------------------|
| Em Desenvolvimento | Estou a desenvolver ativamente | Sim |
| Desenvolvido | Acabei de desenvolver (foi para QA) | Sim |
| Novo | Ainda nao toquei | Sim |
| Em Teste | Em QA/testing | Sim |
| OnHold | Espera de Merge Request | Nao |
| Rejeitado | Voltou para tras (nao trabalhei) | Nao |

## Como Rodar

### Desenvolvimento Local

```bash
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000) no browser.

### Comandos Disponiveis

| Comando | Descricao |
|---------|-----------|
| `npm run dev` | Servidor de desenvolvimento (porta 3000) |
| `npm run build` | Build de producao |
| `npm run start` | Servidor de producao |
| `npm run lint` | Verificacao ESLint |

### Deploy com Docker

```bash
./deploy.sh    # Linux/Mac
deploy.bat     # Windows
```

Producao corre na porta **3700** (container: `website-log-horas`).

### Docker Compose Manual

```bash
docker-compose build
docker-compose up -d
```

## Stack

- **Next.js 16** (App Router)
- **React 19**
- **TypeScript**
- **Tailwind CSS 4**
- **OpenProject REST API** (v3)

## Estrutura do Projeto

```
app/
  page.tsx                          # Login + vista principal (owns timeEntries state)
  layout.tsx                        # Layout raiz (lang=pt)
  api/openproject/
    verify-token/route.ts           # Validar token, buscar tarefas, horas, sprints, atividades
    get-task/route.ts               # Buscar tarefa por ID
    add-time-entries/route.ts       # Criar entradas de tempo (decimal -> ISO 8601)
    clear-time-entries/route.ts     # Apagar entradas de tempo (scoped por utilizador)
components/
  Calendar/
    index.tsx                       # Componente principal (~775 linhas, orchestrador)
    DayCell.tsx                     # Celula do dia (cores, spinner, sprint ring)
    TaskModal.tsx                   # Modal de detalhes da tarefa
    ConfirmationModal.tsx           # Modal de confirmacao (horas editaveis)
    ClearHoursModal.tsx             # Modal de apagar horas (dia individual)
    ClearMonthModal.tsx             # Modal de apagar horas (calendario mensal, multi-dia)
  QuickHoursForm/index.tsx          # Formulario rapido de horas (com historico e filtragem por dia)
  WeekFillModal/index.tsx           # Preenchimento de semana (navegavel, automatico)
  MonthFillModal/index.tsx          # Preenchimento de mes (grelha semanal, automatico)
  ScheduleSettings/index.tsx        # Configuracao do horario de trabalho (Verao/Inverno)
  TaskAssignmentModal/index.tsx     # Atribuir tarefas a dias (pinning)
  Toast/
    ToastContext.tsx                 # Provider + useToast hook
    ToastContainer.tsx              # Render de notificacoes (top-right, auto-dismiss 4s)
    index.ts                        # Re-exports
  Providers.tsx                     # Client wrapper com ToastProvider
hooks/
  useWorkSchedule.ts                # Hook do horario configuravel (localStorage)
  useTaskAssignments.ts             # Hook de atribuicao de tarefas (localStorage)
lib/
  calendar-utils.ts                 # Utilitarios (formatHours, toKey, getWeekDays, etc.)
  holidays.ts                       # Feriados nacionais portugueses
  recommendations.ts                # Motor de recomendacao inteligente (scoring + variacao)
  task-filtering.ts                 # Filtragem de tarefas por dia (activeFrom/activeUntil)
types/
  index.ts                          # Tipos TypeScript centralizados
plans/                              # Planos de implementacao (001-007)
```

## Changelog

### 2026-03-27 - Sessao 3: Loading States, Bugs de Auth, Optimistic Updates

**Loading State por Dia:**
- Spinner animado por dia no calendario durante operacoes de guardar/apagar (overlay semi-transparente)
- Operacoes bulk (Semana/Mes): todos os dias mostram spinner, cada um desaparece a medida que completa
- Clique desativado nos dias em loading (cursor `wait`)

**Atualizacao Otimista:**
- Dias ficam verdes/sem cor imediatamente apos guardar/apagar, sem esperar pelo reload completo da API
- Callback `onTimeEntriesUpdate` permite ao Calendar atualizar `timeEntries` do `page.tsx` de forma otimista

**Bug Fixes:**
- Corrigido double-encoding de autenticacao na rota `get-task` (causava 401)
- Corrigido `clear-time-entries`: filtrava apenas por data sem filtrar por utilizador — apanhava entradas de todos os utilizadores e recebia 403 ao tentar apagar entradas alheias. Agora usa `/users/me` + paginacao

### 2026-03-27 - Sessao 2: Toasts, Distribuicao Dinamica, Semana Navegavel, Sprints, Limpar Horas

**Limpar Horas (ClearMonthModal):**
- Modal unificado com calendario mensal para selecionar quaisquer dias para apagar horas
- Grelha semanal com cores (vermelho = selecionado, cinza = sem horas), toggle por semana, barra de progresso
- Substituiu o antigo ClearWeekModal — funciona para qualquer combinacao de dias
- Limpar dia rapido: icone "x" no hover de um dia com horas

**Toast Notifications:**
- Substituidos todos os 12 `alert()` por toast notifications nao-bloqueantes (top-right, auto-dismiss 4s)
- Sistema: `ToastProvider` + `ToastContainer` + `useToast()` hook
- Cores por tipo: verde (sucesso), vermelho (erro), amarelo (aviso)

**Distribuicao Dinamica de Tarefas:**
- API `verify-token` busca historico de atividades de cada tarefa em paralelo
- Cada tarefa tem `activeFrom`/`activeUntil` — so aparece nos dias em que estava ativa
- Preencher Semana e Mes e 100% automatico (sem selecao manual de tarefas)
- Meetings task sempre incluida. Variacao deterministica (±0.5h) entre dias

**Semana Navegavel:**
- WeekFillModal permite navegar para qualquer semana (setas < >)
- Mostra range da semana (ex: "17-21 Marco 2026"), recalcula automaticamente

**Visualizacao de Sprint:**
- Dias dentro do periodo da sprint destacados com borda branca no calendario
- Datas da sprint (inicio - fim) mostradas junto ao dropdown
- API `verify-token` busca datas de inicio/fim das versions do OpenProject

**Preencher Mes (MonthFillModal):**
- Grelha semanal (5 colunas Seg-Sex), cores por estado, toggle por semana, resumo totais

### 2026-03-27 - Sessao 1: Fundacao, Recomendacoes, Sprints, Qualidade

**Bug Fixes:**
- Corrigido erro "No Tasks for this month": campo status extraido incorretamente da API
- Corrigido crash de Invalid Date quando tarefas nao tem data (`Date | null`)
- Removida filtragem de tarefas por mes — todas as tarefas em desenvolvimento ficam disponiveis

**Recomendacao Inteligente de Horas:**
- Scoring: pinned +3, recente +2, historico +1. Pre-preenchimento com base na media historica
- QuickHoursForm: checkboxes, badges "Historico"/"Atribuida", distribuicao automatica
- WeekFillModal: selecionar dias e tarefas, distribuicao proporcional ao horario de cada dia
- Dados historicos: `byDay`, `byTask` (total, media, ultima utilizacao), `byDayTask`

**Filtragem por Sprint:**
- Dropdown auto-detecta sprint com mais tarefas. Persistido em localStorage
- API filtra apenas tarefas abertas (`status: "o"`). Cada tarefa inclui sprint e `updatedAt`
- Pre-selecao total: todas as tarefas vem selecionadas por default

**Horario de Trabalho Configuravel:**
- UI Verao/Inverno, horas por dia da semana, meses de verao ajustaveis. Persistido em localStorage

**Atribuicao de Tarefas (Pinning):**
- Atribuir tarefas a dias especificos. Prioridade nas recomendacoes

**Qualidade:**
- Calendar decomposto de 937 para ~775 linhas + sub-componentes + utilidades
- Tipos centralizados em `types/index.ts`, utilitarios em `lib/`
- Hooks customizados: `useWorkSchedule`, `useTaskAssignments`
- Metadata: titulo "Registo de Horas - IRN", lang="pt"
- Removidos console.log de producao
