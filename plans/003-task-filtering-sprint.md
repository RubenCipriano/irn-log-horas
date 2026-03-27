# Plano: Filtragem de Tarefas por Sprint e Pre-selecao

## Contexto

O utilizador trabalha em sprints de 2 semanas (atualmente sprint 34). Os problemas atuais:
1. Recomendacoes nao vem pre-selecionadas por default — requer demasiado trabalho manual
2. Aparecem tarefas fechadas (closed/done) que nao deviam aparecer
3. Aparecem tarefas de meses antigos que ja nao sao relevantes
4. Nao ha filtragem por sprint — o utilizador so quer ver tarefas da sprint atual

---

## Fase 1: Filtrar tarefas fechadas e buscar sprint na API

**Objetivo:** Excluir tarefas fechadas e trazer informacao de sprint/version do OpenProject.

### 1A: Atualizar query na API `verify-token/route.ts`

**Ficheiro:** `app/api/openproject/verify-token/route.ts`

Atualmente (linha ~54):
```
/api/v3/work_packages?filters=[{"assignee":{"operator":"=","values":["userId"]}}]&pageSize=1000
```

Alterar para excluir tarefas fechadas na query:
```
/api/v3/work_packages?filters=[
  {"assignee":{"operator":"=","values":["userId"]}},
  {"status":{"operator":"!","values":["closed"]}}
]&pageSize=1000
```

Nota: O OpenProject usa `isClosed` como propriedade do status. Alternativamente, filtrar por `status` com operator `o` (open) que retorna apenas work packages com status aberto.

### 1B: Extrair sprint/version dos work packages

Na mesma rota, ao mapear os work packages (linha ~66-71), extrair tambem:
- `wp._links?.version?.title` — nome da sprint (ex: "Sprint 34")
- `wp._links?.version?.href` — link da sprint (para extrair ID)
- `wp.updatedAt` — ultima atualizacao (para filtro de mes)

### 1C: Atualizar tipo `TodoItem`

**Ficheiro:** `types/index.ts`

Adicionar campos:
```typescript
export type TodoItem = {
  id: string;
  title: string;
  date: Date | null;
  url?: string;
  status?: string;
  sprint?: string;       // NOVO: nome da sprint (ex: "Sprint 34")
  updatedAt?: string;    // NOVO: data de ultima atualizacao "YYYY-MM-DD"
  isClosed?: boolean;    // NOVO: se o status e fechado
};
```

**Verificacao:** Build passa, tarefas fechadas ja nao aparecem na lista.

---

## Fase 2: Filtrar por mes e sprint no frontend

**Objetivo:** No Calendar, filtrar `monthDevelopmentTasks` para mostrar apenas tarefas relevantes.

### 2A: Alterar `monthDevelopmentTasks` no Calendar

**Ficheiro:** `components/Calendar/index.tsx` (linha ~238)

Atualmente:
```typescript
const monthDevelopmentTasks = useMemo(() => {
  return todoList.filter(todo =>
    todo.status && IN_PROGRESS_STATUSES.some(...)
  );
}, [todoList]);
```

Alterar para filtrar por:
1. Status em `IN_PROGRESS_STATUSES` (manter)
2. Nao esta fechada (`!todo.isClosed`)
3. Sprint atual OU tarefas do mes atual

```typescript
const monthDevelopmentTasks = useMemo(() => {
  return todoList.filter(todo => {
    // Deve ter status valido
    if (!todo.status || !IN_PROGRESS_STATUSES.some(s =>
      todo.status!.toLowerCase().includes(s.toLowerCase()))) return false;

    // Nao pode estar fechada
    if (todo.isClosed) return false;

    // Se tem sprint, filtrar pela sprint ativa
    if (activeSprint && todo.sprint) {
      return todo.sprint === activeSprint;
    }

    // Fallback: filtrar por mes (updatedAt ou date no mes atual)
    if (todo.updatedAt) {
      const updated = new Date(todo.updatedAt);
      return updated.getMonth() === currentMonth && updated.getFullYear() === currentYear;
    }

    return true; // sem data, incluir
  });
}, [todoList, currentMonth, currentYear, activeSprint]);
```

### 2B: Configuracao de sprint ativa

**Ficheiro:** `components/Calendar/index.tsx`

Adicionar estado para sprint ativa:
- `const [activeSprint, setActiveSprint] = useState<string | null>(null)`
- Auto-detectar: ao carregar tarefas, encontrar a sprint mais comum entre as tarefas abertas
- Mostrar dropdown no header para trocar de sprint se necessario

### 2C: Dropdown de sprint no UI

Junto ao botao "Preencher Semana" e configuracoes, adicionar um dropdown simples:
```
Sprint: [Sprint 34 ▼]
```

- Populado com todas as sprints unicas encontradas nas tarefas
- Opcao "Todas" para desativar filtro
- Sprint mais comum vem selecionada por default

**Verificacao:** So aparecem tarefas da sprint ativa. Dropdown permite trocar.

---

## Fase 3: Pre-selecao automatica de todas as tarefas

**Objetivo:** Todas as tarefas filtradas devem vir pre-selecionadas por default.

### 3A: Alterar scoring no `lib/recommendations.ts`

**Ficheiro:** `lib/recommendations.ts`

Atualmente a pre-selecao e `score >= 2` (so pinned e historico recente). Como agora as tarefas ja estao filtradas por sprint/mes, TODAS devem vir selecionadas.

Alterar:
```typescript
// ANTES:
const selected = score >= 2;

// DEPOIS:
const selected = true; // todas pre-selecionadas (ja filtradas por sprint)
```

### 3B: Manter horas inteligentes

Mesmo com todas pre-selecionadas, as horas continuam pre-preenchidas com base no historico:
- Tarefas com historico: `avgHoursPerDay`
- Tarefas sem historico: distribuicao igual do restante

### 3C: Ajustar escala para preencher o dia completo

Com todas selecionadas, a escala deve garantir que `totalHours == expectedHours`:
- Escalar proporcionalmente as horas pre-preenchidas
- Arredondar a 0.5h
- Corrigir diferenca de arredondamento na ultima tarefa

**Verificacao:** Ao abrir o QuickHoursForm, todas as tarefas da sprint vem selecionadas com horas que somam o total esperado.

---

## Fase 4: Melhorar a detecao de sprint

### 4A: Auto-detectar sprint ativa

Ao receber as tarefas do `verify-token`:
1. Agrupar tarefas por sprint
2. A sprint com mais tarefas abertas e a sprint ativa
3. Guardar em `localStorage` para persistir entre sessoes

### 4B: Considerar data da sprint

Se a sprint tiver datas de inicio/fim (OpenProject normalmente tem):
- Determinar sprint ativa pela data de hoje vs periodo da sprint
- Mais fiavel que contar tarefas

Para buscar versoes com datas, podemos fazer uma chamada adicional:
```
GET /api/v3/versions?filters=[{"sharing":{"operator":"=","values":["none"]}}]
```

Cada version tem `startDate` e `endDate`.

---

## Ficheiros a modificar

| Ficheiro | Alteracao | Fase |
|----------|-----------|------|
| `types/index.ts` | Adicionar `sprint`, `updatedAt`, `isClosed` ao TodoItem | 1 |
| `app/api/openproject/verify-token/route.ts` | Filtrar fechadas na API, extrair sprint/version e updatedAt | 1 |
| `components/Calendar/index.tsx` | Filtrar monthDevelopmentTasks por sprint/mes, dropdown de sprint | 2 |
| `lib/recommendations.ts` | Pre-selecionar todas as tarefas (selected = true) | 3 |
| `lib/calendar-utils.ts` | Adicionar status fechados a excluir (se necessario) | 1 |

## Verificacao final

1. `npm run build` sem erros
2. Login → tarefas fechadas NAO aparecem
3. Apenas tarefas da sprint atual aparecem
4. Dropdown permite trocar de sprint
5. QuickHoursForm: TODAS as tarefas vem pre-selecionadas
6. Horas pre-preenchidas somam o total esperado para o dia
7. WeekFillModal: mesma logica aplicada
