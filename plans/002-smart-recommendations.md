# Plano: Sistema Inteligente de Recomendacao de Horas

## Contexto

O motor de recomendacao atual distribui horas igualmente por todas as tarefas em desenvolvimento. Isto nao reflete o trabalho real — o utilizador pode ter trabalhado 5h numa tarefa e 2h noutra, mas o sistema sugere partes iguais.

O objetivo e criar um sistema que:
1. Permita selecao rapida das tarefas trabalhadas num dia com horas pre-preenchidas
2. Use historico de horas passadas para sugerir distribuicoes inteligentes
3. Suporte preenchimento de varios dias / semana inteira de uma vez

---

## Fase 1: Dados historicos por tarefa

**Objetivo:** Buscar e agregar horas por tarefa (nao so por dia) para alimentar recomendacoes inteligentes.

### 1A: Alterar `verify-token/route.ts`

Atualmente as time entries sao agregadas so por dia:
```
{ "2026-03-27": 7, "2026-03-26": 9 }
```

Preciso de agregar tambem por tarefa:
```
{
  byDay: { "2026-03-27": 7, "2026-03-26": 9 },
  byTask: {
    "4521": { totalHours: 45, entries: 12, lastUsed: "2026-03-27" },
    "4530": { totalHours: 22, entries: 8, lastUsed: "2026-03-25" }
  },
  byDayTask: {
    "2026-03-27": { "4521": 3, "4530": 2.5, "5158": 0.5 }
  }
}
```

**Ficheiro:** `app/api/openproject/verify-token/route.ts`
- Na secao de time entries (linha ~75), alem de agregar por dia, agregar tambem por `workPackage` ID
- Extrair `workPackageId` de `entry._links.workPackage.href` (formato: `/api/v3/work_packages/4521`)
- Calcular `totalHours`, `entries` (contagem), e `lastUsed` (data mais recente) por tarefa
- Agregar horas por dia+tarefa para saber a distribuicao exata de cada dia passado

### 1B: Atualizar tipos em `types/index.ts`

Adicionar:
```typescript
export type TaskHistory = {
  totalHours: number;
  entryCount: number;
  lastUsed: string; // "YYYY-MM-DD"
  avgHoursPerDay: number;
};

export type TimeEntriesData = {
  byDay: Record<string, number>;
  byTask: Record<string, TaskHistory>;
  byDayTask: Record<string, Record<string, number>>;
};
```

### 1C: Atualizar `page.tsx` e Calendar props

- Mudar `timeEntries` de `Record<string, number>` para `TimeEntriesData`
- Calendar recebe o objeto completo
- Manter compatibilidade: `timeEntries.byDay` substitui o antigo `timeEntries`

**Verificacao:** Build passa, comportamento identico (usa `byDay` onde antes usava o objeto plano).

---

## Fase 2: UI de selecao rapida de tarefas

**Objetivo:** Substituir o botao "Adicionar Horas Automaticamente" por uma UI interativa onde o utilizador seleciona tarefas e define horas.

### 2A: Criar componente `QuickHoursForm`

**Ficheiro:** `components/QuickHoursForm/index.tsx`

UI dentro do day detail modal:
```
+-------------------------------+
| Em que trabalhaste?           |
|-------------------------------|
| [x] Task-4521 Portal IRN 3.0h|  <- checkbox + input
| [x] Task-4530 Auth API   2.5h|
| [ ] Task-4535 Dashboard      |
| [ ] Task-4540 Reports        |
|-------------------------------|
| + Meetings (auto)        0.5h|
| Falta preencher:         1.0h|
|-------------------------------|
| Total: 6.0h / 7.0h           |
| [Distribuir Resto] [Guardar] |
+-------------------------------+
```

**Funcionalidades:**
- Lista todas as tarefas em desenvolvimento, ordenadas por:
  1. Tarefas atribuidas (pinned) ao dia — sempre no topo
  2. Tarefas com mais historico recente (baseado em `byTask.lastUsed` e `avgHoursPerDay`)
  3. Restantes por ordem alfabetica
- Cada tarefa tem checkbox + input de horas
- Horas pre-preenchidas com base no historico (`byTask[id].avgHoursPerDay`)
- Tarefas com historico recente (ultimos 5 dias uteis) vem pre-selecionadas
- Meetings task automatica (0.5h, sempre incluida)
- Mostra "Falta preencher: Xh" em tempo real
- Botao "Distribuir Resto": distribui horas em falta igualmente pelas tarefas selecionadas
- Botao "Guardar": abre ConfirmationModal com as tarefas selecionadas

### 2B: Integrar no Calendar

**Ficheiro:** `components/Calendar/index.tsx`

- Substituir a secao de recomendacao (linhas ~432-465) pelo `QuickHoursForm`
- O QuickHoursForm recebe: `allTasks`, `timeEntriesData`, `expectedHours`, `actualHours`, `dayKey`, `pinnedTaskIds`
- Remover ou manter o botao toggle "Adicionar Horas Automaticamente" — agora abre o QuickHoursForm em vez de mostrar texto

### 2C: Logica de pre-preenchimento inteligente

**Ficheiro:** `lib/recommendations.ts` (novo)

Funcao pura que calcula sugestoes:

```typescript
function calculateSmartRecommendation(params: {
  tasks: TodoItem[];
  pinnedTaskIds: string[];
  taskHistory: Record<string, TaskHistory>;
  dayTaskHistory: Record<string, number>; // horas do mesmo dia da semana anterior
  expectedHours: number;
  alreadyRegistered: number;
  meetingsTask: TodoItem | null;
}): SmartRecommendation[]
```

**Algoritmo:**
1. Calcular `hoursNeeded = expectedHours - alreadyRegistered`
2. Adicionar meetings task (0.5h)
3. Para cada tarefa, calcular um "score de relevancia":
   - +3 se esta pinned ao dia
   - +2 se foi usada nos ultimos 5 dias uteis
   - +1 se tem historico qualquer
   - 0 se nunca foi usada
4. Ordenar tarefas por score (desc)
5. Pre-selecionar tarefas com score >= 2
6. Pre-preencher horas: usar `avgHoursPerDay` do historico, ou distribuicao igual se sem historico
7. Ajustar para que o total = expectedHours (escalar proporcionalmente)

**Verificacao:** Clicar num dia mostra as tarefas ordenadas por relevancia, com horas pre-preenchidas inteligentes.

---

## Fase 3: Preenchimento multi-dia (semana inteira)

**Objetivo:** Permitir preencher varios dias de uma vez com a mesma distribuicao.

### 3A: Criar componente `WeekFillModal`

**Ficheiro:** `components/WeekFillModal/index.tsx`

UI:
```
+-------------------------------------+
| Preencher Semana                     |
|--------------------------------------|
| Semana de 23/03 a 27/03/2026         |
|                                      |
| Dias a preencher:                    |
| [x] Seg 23 (esperado: 7h, atual: 0h)|
| [x] Ter 24 (esperado: 7h, atual: 0h)|
| [x] Qua 25 (esperado: 7h, atual: 0h)|
| [ ] Qui 26 (esperado: 7h, atual: 7h)| <- ja preenchido
| [x] Sex 27 (esperado: 9h, atual: 0h)|
|                                      |
| Distribuicao (aplicada a todos):     |
| [x] Task-4521 Portal IRN       3.0h |
| [x] Task-4530 Auth API         2.5h |
| + Meetings                      0.5h |
|                                      |
| Horas ajustadas por dia:             |
| Seg: 6.0/7.0 (faltam 1.0h)          |
| Sex: 6.0/9.0 (faltam 3.0h)          |
| [Distribuir Resto] [Guardar Tudo]    |
+-------------------------------------+
```

**Funcionalidades:**
- Botao "Preencher Semana" no header do calendario (junto a BACK/NEXT/Hoje)
- Mostra todos os dias uteis da semana atual
- Checkboxes para selecionar quais dias preencher (dias ja com horas completas deselecionados)
- Mesma UI de selecao de tarefas do QuickHoursForm (reutilizar)
- Para dias com horas esperadas diferentes (ex: sexta = 9h vs seg-qui = 7h), mostra aviso e permite "Distribuir Resto" por dia
- Ao guardar, chama `add-time-entries` para cada dia selecionado

### 3B: Adaptar logica para multi-dia

**Ficheiro:** `lib/recommendations.ts`

- Funcao `calculateWeekRecommendation` que recebe array de dias e calcula distribuicao para cada um
- Para dias com horas diferentes (7h vs 9h), distribui as horas extra na sexta pelas tarefas selecionadas
- Reutiliza a logica de `calculateSmartRecommendation` por dia

### 3C: Integrar no Calendar

**Ficheiro:** `components/Calendar/index.tsx`

- Adicionar botao "Preencher Semana" no header
- Estado `showWeekFill` para controlar modal
- Calcular dias da semana atual com base em `currentYear`/`currentMonth`
- Passar dados necessarios ao `WeekFillModal`

**Verificacao:** Pode preencher semana inteira com um clique, horas ajustadas por dia conforme horario.

---

## Fase 4: Polish

### 4A: Guardar preferencias de distribuicao

- Ao guardar horas manualmente, registar a distribuicao usada em localStorage
- Na proxima vez que abrir o mesmo dia da semana, sugerir distribuicao similar
- Key: `last_distribution_${dayOfWeek}` (ex: `last_distribution_1` para segunda)

### 4B: Feedback visual

- Ao pre-preencher com historico, mostrar badge "Baseado no teu historico" junto as sugestoes
- Cores diferentes para tarefas pre-selecionadas vs manuais

---

## Dependencias entre fases

```
Fase 1 (Dados historicos) → Fase 2 (Selecao rapida + inteligente)
                           → Fase 3 (Multi-dia)
                                     ↓
                           Fase 4 (Polish)
```

Fase 1 e pre-requisito. Fases 2 e 3 podem ser feitas em paralelo apos Fase 1.

---

## Ficheiros a criar/modificar

| Ficheiro | Acao | Fase |
|----------|------|------|
| `types/index.ts` | Adicionar `TaskHistory`, `TimeEntriesData`, `SmartRecommendation` | 1 |
| `app/api/openproject/verify-token/route.ts` | Agregar time entries por tarefa e dia+tarefa | 1 |
| `app/page.tsx` | Adaptar para novo formato `TimeEntriesData` | 1 |
| `components/Calendar/index.tsx` | Adaptar props, integrar QuickHoursForm e WeekFillModal | 2, 3 |
| `lib/recommendations.ts` | Novo — logica de recomendacao inteligente | 2 |
| `components/QuickHoursForm/index.tsx` | Novo — UI de selecao rapida | 2 |
| `components/WeekFillModal/index.tsx` | Novo — UI multi-dia | 3 |

## Verificacao final

1. `npm run build` sem erros
2. Login → clicar num dia → ver tarefas ordenadas por historico
3. Pre-selecao de tarefas com historico recente
4. Horas pre-preenchidas com base na media historica
5. "Distribuir Resto" distribui falta pelas tarefas selecionadas
6. "Preencher Semana" preenche todos os dias uteis sem horas
7. Horas guardadas corretamente no OpenProject
8. Reload → historico atualizado com as novas entradas
