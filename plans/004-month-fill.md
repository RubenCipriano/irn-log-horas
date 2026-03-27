# Plano: Preencher Mes com Pre-visualizacao

## Contexto

Existe ja um "Preencher Semana" (WeekFillModal) que permite preencher 5 dias de uma vez. O utilizador quer o mesmo para o mes inteiro — selecionar tarefas, ver a pre-visualizacao de todos os dias, e guardar tudo de uma vez.

---

## Fase 1: Criar MonthFillModal

**Ficheiro:** `components/MonthFillModal/index.tsx`

### Props (iguais ao WeekFillModal + extras)
- `currentYear`, `currentMonth` — mes a preencher
- `timeEntries: TimeEntriesData` — horas existentes
- `allTasks: TodoItem[]` — tarefas filtradas (sprint/mes)
- `meetingsTask`, `meetingsTaskId` — task de meetings
- `getExpectedHours` — horas esperadas por dia
- `isHoliday` — verificar feriados
- `isSaving`, `onSave`, `onClose` — handlers

### Gerar lista de dias do mes

```typescript
function getMonthWorkDays(year: number, month: number, isHoliday, getExpectedHours, timeEntries): MonthDay[] {
  const daysInMonth = getDaysInMonth(year, month);
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // skip weekends
    const dayKey = toKey(date);
    if (isHoliday(dayKey)) continue; // skip holidays
    const expected = getExpectedHours(date) ?? 0;
    const actual = timeEntries.byDay[dayKey] || 0;
    days.push({ date, dayKey, expected, actual, label: ... });
  }
  return days;
}
```

### UI do Modal (3 secoes)

```
+------------------------------------------+
| Preencher Mes — Marco 2026           [x] |
|------------------------------------------|
|                                          |
| 1. SELECAO DE TAREFAS                   |
| (igual ao WeekFill — checkboxes + horas) |
|                                          |
| [x] Task-4521 Portal IRN          3.0h  |
| [x] Task-4530 Auth API            2.5h  |
| + Meetings                         0.5h  |
| Total base: 6.0h                         |
|                                          |
|------------------------------------------|
|                                          |
| 2. PRE-VISUALIZACAO POR SEMANA          |
|                                          |
| Semana 1 (1-5 Marco)                    |
| ┌────┬────┬────┬────┬────┐              |
| │Seg │Ter │Qua │Qui │Sex │              |
| │ 1  │ 2  │ 3  │ 4  │ 5  │              |
| │7.0h│7.0h│7.0h│7.0h│9.0h│ ← esperado  |
| │6.0h│6.0h│6.0h│6.0h│8.0h│ ← a add     |
| │ ✓  │ ✓  │ ✓  │ ✓  │ ✓  │ ← selecionado|
| └────┴────┴────┴────┴────┘              |
|                                          |
| Semana 2 (8-12 Marco)                   |
| ┌────┬────┬────┬────┬────┐              |
| │Seg │Ter │Qua │Qui │Sex │              |
| │ 8  │ 9  │ 10 │ 11 │ 12 │              |
| │7.0h│7.0h│7.0h│7.0h│9.0h│              |
| │ 0  │6.0h│6.0h│6.0h│8.0h│ ← 8 ja tem  |
| │ —  │ ✓  │ ✓  │ ✓  │ ✓  │              |
| └────┴────┴────┴────┴────┘              |
|                                          |
| ... mais semanas ...                     |
|                                          |
|------------------------------------------|
|                                          |
| 3. RESUMO                               |
|                                          |
| Dias a preencher: 18 / 22               |
| Total de horas: 132.0h                  |
| Tarefas: 3                              |
|                                          |
| [Cancelar]        [Guardar 18 dia(s)]   |
+------------------------------------------+
```

### Logica de selecao de dias

- Dias uteis sem feriado: incluidos
- Dias ja com horas completas (`actual >= expected`): **desmarcados** mas possiveis de marcar
- Dias ja com horas parciais: marcados, `hoursToAdd = expected - actual`
- Dias sem horas: marcados, `hoursToAdd = expected`
- Checkbox individual por dia para incluir/excluir
- Toggle por semana ("selecionar/desmarcar semana inteira")

### Escala de horas por dia

Igual ao WeekFillModal — para cada dia:
```
hoursNeeded = expectedHours - actualHours
scale = hoursNeeded / taskTotal
taskHoursForDay = task.hours * scale  (arredondado a 0.5)
```

Dias com 7h e dias com 9h recebem distribuicoes diferentes automaticamente.

---

## Fase 2: Pre-visualizacao em grelha semanal

### Layout da pre-visualizacao

Agrupar dias por semanas (Seg-Sex). Cada semana e uma linha de 5 colunas:

```typescript
function groupByWeeks(days: MonthDay[]): MonthDay[][] {
  const weeks: MonthDay[][] = [];
  let currentWeek: MonthDay[] = [];
  let lastWeekNum = -1;

  for (const day of days) {
    const weekNum = getWeekNumber(day.date);
    if (weekNum !== lastWeekNum && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(day);
    lastWeekNum = weekNum;
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);
  return weeks;
}
```

Cada celula mostra:
- Numero do dia
- Horas esperadas
- Horas a adicionar (calculadas)
- Estado: checkbox marcado/desmarcado, ou "ja completo"
- Cor: verde (completo), amarelo (parcial), cinza (vazio)

### Codigo de cores na pre-visualizacao

| Estado | Cor | Significado |
|--------|-----|-------------|
| Ja completo | Verde | `actual >= expected`, nao precisa de horas |
| Parcial | Amarelo | `actual > 0 && actual < expected`, vai completar |
| Vazio | Cinza/azul | `actual === 0`, vai preencher tudo |
| Excluido | Cinza opaco | Utilizador desmarcou manualmente |

---

## Fase 3: Integrar no Calendar

### Botao "Preencher Mes"

**Ficheiro:** `components/Calendar/index.tsx`

Adicionar botao junto ao "Preencher Semana":
```
[BACK] [NEXT] [Hoje] [Preencher Semana] [Preencher Mes]
```

### Estado e modal

```typescript
const [showMonthFill, setShowMonthFill] = useState(false);
```

### Reutilizar `saveMultipleDays`

A funcao `saveMultipleDays` ja existe e aceita `{ date, recommendations }[]` — funciona para qualquer numero de dias. Reutilizar diretamente.

---

## Fase 4: Otimizacao de UX

### 4A: Contagem e resumo

No fundo do modal, mostrar:
- "Dias a preencher: X / Y" (X selecionados, Y uteis no mes)
- "Total de horas a adicionar: Xh"
- "Tarefas selecionadas: X"

### 4B: Scroll suave

O modal pode ter muitos dias (~22 uteis). Usar `max-h-[70vh] overflow-y-auto` no corpo do modal com as semanas numa lista scrollavel.

### 4C: Confirmacao antes de guardar

Dado que pode afetar ~20 dias, mostrar um dialogo de confirmacao:
"Tem a certeza que quer adicionar horas a X dias?"

---

## Ficheiros a criar/modificar

| Ficheiro | Acao | Fase |
|----------|------|------|
| `components/MonthFillModal/index.tsx` | Criar — modal completo | 1, 2 |
| `components/Calendar/index.tsx` | Adicionar botao + estado + render modal | 3 |
| `lib/calendar-utils.ts` | Adicionar `getMonthWorkDays()` se necessario | 1 |

## Fase 5: Fix scroll do body quando modal esta aberto

### Problema

Quando qualquer modal esta aberto (WeekFill, MonthFill, DayDetail, etc.), o body/html ainda permite scroll por baixo do overlay. Isto causa um efeito visual onde o conteudo do calendario se move por tras do modal.

### Solucao

Quando um modal abre, adicionar `overflow: hidden` ao body. Quando fecha, remover.

**Ficheiro:** `components/Calendar/index.tsx`

Usar um `useEffect` que observa os estados de todos os modais:

```typescript
useEffect(() => {
  const anyModalOpen = !!(selectedDay || selectedTodo || confirmationModal || clearHoursModal || showWeekFill || showMonthFill || showTaskAssignment);
  document.body.style.overflow = anyModalOpen ? "hidden" : "";
  return () => { document.body.style.overflow = ""; };
}, [selectedDay, selectedTodo, confirmationModal, clearHoursModal, showWeekFill, showMonthFill, showTaskAssignment]);
```

---

## Verificacao final

1. `npm run build` sem erros
2. Botao "Preencher Mes" aparece no header
3. Modal mostra todos os dias uteis do mes agrupados por semana
4. Dias com horas completas vem desmarcados
5. Pre-visualizacao mostra horas a adicionar por dia
6. Selecionar/desmarcar dias individualmente funciona
7. "Guardar X dia(s)" cria entradas para todos os dias selecionados
8. Horas escaladas corretamente (7h vs 9h)
9. Apos guardar, calendario atualiza com as novas horas
