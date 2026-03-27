# Plano: Toasts, Distribuicao Dinamica de Tarefas, Semana Navegavel

## Contexto

Varios problemas e melhorias pedidas:
1. **Erros de permissao** ao apagar horas — mostrados como JSON raw num alert()
2. **alert() em todo o lado** — 12 chamadas. UI feia, bloqueia a pagina
3. **Distribuicao monotona** — o preencher semana/mes usa as MESMAS tarefas para todos os dias. Na realidade, tarefas sao criadas, mudadas e fechadas ao longo do tempo. O dia 1 pode ter task A+B, o dia 10 pode ter task C+D
4. **Semana fixa** — "Preencher Semana" mostra sempre a semana atual. Deveria ser "Preencher UMA semana" — com navegacao para qualquer semana

---

## Fase 1: Toast Notification System

**Objetivo:** Substituir todos os `alert()` por toasts nao-bloqueantes.

### 1A: Tipos — `types/index.ts`

Adicionar:
```typescript
export type ToastType = "success" | "error" | "warning";
export type Toast = { id: string; message: string; type: ToastType };
```

### 1B: Criar `components/Toast/ToastContext.tsx`

- React Context com `ToastProvider` e `useToast()` hook
- Estado: `Toast[]`
- `addToast(message, type)` — gera ID unico, adiciona ao array
- Auto-dismiss apos 4s via `setTimeout` num `useEffect`
- Cleanup no unmount

### 1C: Criar `components/Toast/ToastContainer.tsx`

- Posicao `fixed top-4 right-4 z-[100]` (acima dos modais z-50)
- Cores: verde (success), vermelho (error), amarelo (warning)
- Texto branco, rounded, shadow, botao X para fechar manual
- Animacao slide-in (keyframes em `globals.css`)

### 1D: Criar `components/Toast/index.ts`

Re-export `ToastProvider` e `useToast`.

### 1E: Criar `components/Providers.tsx`

Client component que envolve children com `ToastProvider`. Usado em `app/layout.tsx`:
```tsx
<Providers>{children}</Providers>
```

### 1F: Substituir 12 `alert()` em `components/Calendar/index.tsx`

Importar `useToast` e substituir cada alert:
- `alert("...sucesso...")` → `addToast("...", "success")`
- `alert("Erro...")` → `addToast("...", "error")`
- `alert("Nao existem...")` → `addToast("...", "warning")`

Localizacoes (linhas aproximadas no ficheiro atual):
- L145: save success
- L153: save error
- L163: no hours warning
- L177: clear success
- L183: clear error
- L214: batch save success
- L218: batch save errors
- L222: batch save exception
- L254: batch clear success
- L257: nothing to clear
- L260: batch clear errors
- L265: batch clear exception

### 1G: Tratar erros de permissao em `clear-time-entries/route.ts`

Atualmente o erro 403 do OpenProject e devolvido como texto raw. Alterar:
- Detetar `deleteResponse.status === 403` → contar como `permissionErrors`
- Resposta incluir `permissionErrors: number` separado dos `errors`
- No Calendar, mostrar toast especifico: `"Sem permissao para apagar X entrada(s)."`

**Verificacao:** Build passa, zero `alert(` no codigo, toasts aparecem em cada fluxo.

---

## Fase 2: Historico de Estado por Tarefa + Utilitario de Filtragem

**Objetivo:** Saber quando cada tarefa ficou ativa e quando "fechou" (passou a Desenvolvido/Fechada), usando o historico real de mudancas de estado do OpenProject.

### Conceito

Uma tarefa e "ativa" entre a data em que recebeu um estado de trabalho (Novo, Em Desenvolvimento, Em Especificacao) e a data em que passou a um estado terminal (Desenvolvido, Fechada). Exemplo:
- Task criada dia 10/3 (estado: Novo) → `activeFrom = "2026-03-10"`
- Passa a "Em Desenvolvimento" dia 11/3
- Passa a "Desenvolvido" dia 13/3 → `activeUntil = "2026-03-13"`
- Horas registadas: dias 10, 11, 12, 13

### 2A: Atualizar `TodoItem` em `types/index.ts`

Adicionar campos de intervalo de atividade:
```typescript
export type TodoItem = {
  // ... campos existentes ...
  activeFrom?: string | null;   // "YYYY-MM-DD" — data do primeiro estado de trabalho
  activeUntil?: string | null;  // "YYYY-MM-DD" — data em que passou a Desenvolvido/Fechada (null = ainda ativa)
};
```

### 2B: Buscar historico de atividades em `verify-token/route.ts`

Apos mapear os work packages, buscar o historico de cada tarefa em paralelo:

```typescript
// Buscar activities de cada work package em paralelo
const todosWithHistory = await Promise.all(todos.map(async (todo) => {
  try {
    const activitiesUrl = `${baseUrl}/api/v3/work_packages/${todo.id}/activities`;
    const activitiesRes = await fetch(activitiesUrl, { headers });
    if (!activitiesRes.ok) return todo;

    const activitiesData = await activitiesRes.json();
    const elements = activitiesData._embedded?.elements || [];

    let activeFrom: string | null = null;
    let activeUntil: string | null = null;

    for (const entry of elements) {
      const date = entry.createdAt?.split("T")[0];
      if (!date) continue;

      // Procurar mudancas de status nos detalhes
      const details = entry._embedded?.details || entry.details || [];
      for (const detail of details) {
        // OpenProject journal details para status tem format: "Status changed from X to Y"
        // Ou via _links: detail._links?.newValue?.title
        if (detail._type === "StatusChangedActivity" ||
            detail.property === "status" ||
            detail.fieldName === "status") {

          // Primeiro estado de trabalho = activeFrom
          if (!activeFrom) activeFrom = date;

          // Se o novo estado e terminal, marcar activeUntil
          const newStatus = (detail._links?.newValue?.title || detail.newValue || "").toLowerCase();
          const terminalStatuses = ["desenvolvido", "developed", "fechado", "closed", "rejected", "rejeitado"];
          if (terminalStatuses.some(s => newStatus.includes(s))) {
            activeUntil = date;
          }
        }
      }
    }

    // Se nao encontrou historico de status, usar createdAt como activeFrom
    if (!activeFrom) {
      activeFrom = todo.date ? (typeof todo.date === 'string' ? todo.date : null) : null;
    }

    return { ...todo, activeFrom, activeUntil };
  } catch {
    return todo; // fallback: sem historico
  }
}));
```

Performance: ~20-50 chamadas paralelas, ~500ms total extra. Aceitavel.

### 2C: Criar `lib/task-filtering.ts`

```typescript
import type { TodoItem } from "@/types";

export function isTaskActiveOnDay(task: TodoItem, dayKey: string): boolean {
  const start = task.activeFrom || null;
  const end = task.activeUntil || null;

  // Sem datas de atividade: tarefa sempre disponivel
  if (!start && !end) return true;

  // Com start, sem end: tarefa ainda ativa (desde o inicio)
  if (start && !end) return start <= dayKey;

  // Com end, sem start: ativa ate fechar
  if (!start && end) return dayKey <= end;

  // Com ambos: ativa no intervalo [start, end]
  return start! <= dayKey && dayKey <= end!;
}

export function getActiveTasksForDay(tasks: TodoItem[], dayKey: string): TodoItem[] {
  return tasks.filter(t => isTaskActiveOnDay(t, dayKey));
}
```

### 2D: Atualizar `page.tsx`

O `todosWithDates` mapping (L44-47) ja faz spread de todos os campos. Os novos `activeFrom`/`activeUntil` sao strings, passam diretamente. Sem alteracoes necessarias.

**Verificacao:** Build passa, cada tarefa tem `activeFrom`/`activeUntil` baseado no historico real de mudancas de estado.

---

## Fase 3: Distribuicao Dinamica por Dia + Melhorias no Day Modal

**Objetivo:** Cada dia recebe apenas as tarefas que estavam ativas nesse dia. Mostrar horas registadas por tarefa no modal do dia. Meetings task SEMPRE incluida.

### 3A: Mostrar "Tarefas trabalhadas" no day detail modal

**Ficheiro:** `components/Calendar/index.tsx` (day detail modal, ~L524)

Quando o dia tem horas registadas (`actualHours > 0`), mostrar uma secao "Tarefas trabalhadas" que usa `timeEntries.byDayTask[dayKey]` para listar cada tarefa e as horas registadas nesse dia.

```tsx
{/* Antes da secao "Horas de trabalho:" */}
{timeEntries.byDayTask[toKey(selectedDay.date)] && (
  <div className="mt-3">
    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Tarefas trabalhadas:</p>
    {Object.entries(timeEntries.byDayTask[toKey(selectedDay.date)]).map(([taskId, hours]) => {
      const task = todoList.find(t => t.id === taskId);
      return (
        <div key={taskId} className="flex justify-between ...">
          <span>{task?.title || `Task #${taskId}`}</span>
          <span>{formatHours(hours)}h</span>
        </div>
      );
    })}
  </div>
)}
```

Nota: Requer importar `formatHours` de volta ao Calendar (foi removido anteriormente).

### 3B: Meetings task SEMPRE incluida nas recomendacoes

**Ficheiro:** `lib/recommendations.ts`

O meetings task ja e adicionado `if (meetingsTask)` (L29). O problema e que `meetingsTask` pode ser `null` se o fetch falhou. Duas correcoes:

1. No `recommendations.ts`: se `meetingsTaskId` existe mas `meetingsTask` e null, criar um placeholder:
```typescript
if (meetingsTask) {
  // ... logica existente
} else if (meetingsTaskId) {
  // Meetings task nao carregou, adicionar placeholder
  recommendations.push({
    taskId: meetingsTaskId,
    taskTitle: "Meetings",
    hours: Math.min(0.5, hoursNeeded),
    selected: true,
    source: "pinned",
  });
  hoursAssigned += Math.min(0.5, hoursNeeded);
}
```

2. No `QuickHoursForm`: o meetings task nao pode ser desmarcado (ja implementado, L56) — manter.

### 3C: QuickHoursForm (dia individual) — filtrar por dia

**Ficheiro:** `components/Calendar/index.tsx`

Onde passa `allTasks={monthDevelopmentTasks}` ao `QuickHoursForm`, filtrar:
```tsx
import { getActiveTasksForDay } from "@/lib/task-filtering";
// ...
allTasks={getActiveTasksForDay(monthDevelopmentTasks, toKey(selectedDay.date))}
```

### 3D: Semana e Mes = 100% automatico (sem selecao de tarefas)

**Regra fundamental:** Preencher Semana e Preencher Mes NAO permitem escolher tarefas. O sistema percorre cada dia, busca as tarefas ativas nesse dia, e calcula a recomendacao automaticamente. O utilizador so escolhe quais DIAS preencher.

#### WeekFillModal — reescrever como automatico

**Ficheiro:** `components/WeekFillModal/index.tsx`

Remover completamente o painel de selecao de tarefas. O modal mostra:
1. Navegacao de semana (setas < >) — Fase 4
2. Lista de dias com checkboxes (quais preencher)
3. **Pre-visualizacao automatica** — para cada dia selecionado, calcular recomendacao usando `calculateSmartRecommendations` com `getActiveTasksForDay`:
   ```
   Seg 10: Task A (2.5h) + Task B (3.0h) + Meetings (0.5h) = 6.0h
   Ter 11: Task A (3.0h) + Task C (2.5h) + Meetings (0.5h) = 6.0h
   ...
   ```
4. Botao "Guardar X dia(s)"

No `handleSave`, para cada dia selecionado:
```typescript
const dayTasks = getActiveTasksForDay(allTasks, day.dayKey);
const recs = calculateSmartRecommendations({
  tasks: dayTasks,
  taskHistory, meetingsTask, meetingsTaskId,
  expectedHours: day.expectedHours,
  alreadyRegistered: day.actualHours,
  ...
});
// Guardar as recomendacoes deste dia
```

#### MonthFillModal — mesma logica automatica

**Ficheiro:** `components/MonthFillModal/index.tsx`

Mesmo approach: remover selecao de tarefas. Mostrar grelha semanal com pre-visualizacao do que seria adicionado em cada dia (calculado automaticamente).

### 3E: Horas ligeiramente aleatorias

**Ficheiro:** `lib/recommendations.ts`

Para que os dias nao tenham distribuicoes identicas, adicionar variacao ao distribuir horas:

```typescript
// Apos calcular a distribuicao base, aplicar variacao ±0.5h
function addVariation(hours: number, seed: number): number {
  // Usar seed (baseado no dayKey hash) para ser deterministico
  const variation = ((seed % 3) - 1) * 0.5; // -0.5, 0, ou +0.5
  return Math.max(0.5, Math.round((hours + variation) * 2) / 2);
}
```

Isto garante que Task A pode ter 2.5h na segunda e 3h na terca, sem ser igual todos os dias. A variacao e deterministica (baseada no hash do dia) para que re-calcular de o mesmo resultado.

Apos a variacao, ajustar o total para coincidir com as horas esperadas.

### 3F: Preview no MonthFillModal

Na grelha semanal, cada celula mostra:
- Numero de tarefas ativas nesse dia
- Total de horas a adicionar
- Cor por estado (verde/amarelo/azul)

**Verificacao:**
- Semana/Mes: nao ha selecao de tarefas, tudo automatico
- Cada dia tem tarefas diferentes baseadas no intervalo activeFrom-activeUntil
- Horas variam ligeiramente entre dias para a mesma tarefa
- Meetings task aparece SEMPRE
- Clicar num dia com horas mostra "Tarefas trabalhadas" com breakdown

---

## Fase 4: Semana Navegavel (Qualquer Semana)

**Objetivo:** "Preencher Semana" permite navegar para qualquer semana, nao so a atual.

### 4A: Estado de navegacao no WeekFillModal

Substituir `today` fixo por estado navegavel:
```typescript
const [referenceDate, setReferenceDate] = useState<Date>(today);
```

`weekDays` passa a ser `useMemo` derivado de `referenceDate` (nao mais `useState` com valor fixo).

### 4B: Setas de navegacao no header do modal

```
< Semana Anterior | 17-21 Marco 2026 | Semana Seguinte >
```

```typescript
const goToPrevWeek = () => setReferenceDate(prev => {
  const d = new Date(prev); d.setDate(d.getDate() - 7); return d;
});
const goToNextWeek = () => setReferenceDate(prev => {
  const d = new Date(prev); d.setDate(d.getDate() + 7); return d;
});
```

### 4C: Adicionar `formatWeekRange` a `lib/calendar-utils.ts`

```typescript
export function formatWeekRange(ref: Date): string {
  const days = getWeekDays(ref);
  const first = days[0], last = days[days.length - 1];
  if (first.getMonth() === last.getMonth()) {
    return `${first.getDate()}-${last.getDate()} ${MONTHS_PT[first.getMonth()]} ${first.getFullYear()}`;
  }
  return `${first.getDate()} ${MONTHS_PT[first.getMonth()]} - ${last.getDate()} ${MONTHS_PT[last.getMonth()]}`;
}
```

### 4D: Recalcular selecoes de dias e tarefas ao mudar de semana

Ao mudar `referenceDate`:
- Recalcular `weekDays` (via useMemo)
- Resetar selecao de dias (auto-selecionar dias incompletos)
- Recalcular recomendacoes de tarefas (uniao das tarefas ativas nessa semana)

### 4E: Atualizar titulo do modal

De "Preencher Semana" para "Preencher Semana" com o range visivel:
```
Preencher Semana
< 17-21 Marco 2026 >
```

**Verificacao:** Abrir modal, clicar setas, semana muda, dias e tarefas atualizam.

---

## Ficheiros a criar/modificar

### Novos ficheiros:
| Ficheiro | Descricao |
|----------|-----------|
| `components/Toast/ToastContext.tsx` | Provider + hook useToast |
| `components/Toast/ToastContainer.tsx` | Render dos toasts |
| `components/Toast/index.ts` | Re-exports |
| `components/Providers.tsx` | Client wrapper para layout |
| `lib/task-filtering.ts` | `isTaskActiveOnDay`, `getActiveTasksForDay` |

### Ficheiros a modificar:
| Ficheiro | Alteracoes |
|----------|-----------|
| `types/index.ts` | Adicionar `Toast`, `ToastType`, `startDate`/`dueDate` ao TodoItem |
| `app/globals.css` | Keyframes para animacao do toast |
| `app/layout.tsx` | Envolver com `<Providers>` |
| `app/api/openproject/verify-token/route.ts` | Adicionar `startDate`, `dueDate` ao mapeamento |
| `app/api/openproject/clear-time-entries/route.ts` | Detetar erros 403, devolver `permissionErrors` |
| `components/Calendar/index.tsx` | Substituir 12 alert() por addToast(); filtrar tarefas por dia para QuickHoursForm |
| `components/WeekFillModal/index.tsx` | Navegacao de semana (referenceDate, setas, formatWeekRange); filtragem dinamica por dia no handleSave |
| `components/MonthFillModal/index.tsx` | Filtragem dinamica por dia no handleSave |
| `lib/calendar-utils.ts` | Adicionar `formatWeekRange` |
| `README.md` | Changelog |

## Ordem de implementacao

```
Fase 1 (Toasts) → sem dependencias, fazer primeiro
Fase 2 (startDate/dueDate + task-filtering) → sem dependencias de Fase 1
Fase 3 (Distribuicao dinamica) → depende de Fase 2
Fase 4 (Semana navegavel) → depende de Fase 2 e 3
```

## Verificacao final

1. `npm run build` sem erros
2. Zero `alert(` no codigo — todas as notificacoes sao toasts
3. Toasts aparecem top-right, auto-dismiss 4s, cores corretas (verde/vermelho/amarelo)
4. Erros de permissao mostram toast amarelo: "Sem permissao para apagar X entrada(s)"
5. Clicar num dia com horas → mostra "Tarefas trabalhadas" com breakdown por tarefa (usando byDayTask)
6. Meetings task (0.5h) aparece SEMPRE em todas as recomendacoes, mesmo se o fetch falhou
7. Tarefa com startDate=01/03 e dueDate=10/03 so aparece nos dias 1-10
8. Preencher Semana: setas navegam entre semanas, tarefas mudam por dia
9. Preencher Mes: cada dia tem tarefas diferentes baseadas nas datas
10. QuickHoursForm (dia): so mostra tarefas ativas nesse dia
