# Plano: Visualizacao de Datas da Sprint no Calendario

## Contexto

Quando o utilizador seleciona uma sprint no dropdown, quer ver visualmente no calendario quais os dias que pertencem a essa sprint. Ex: Sprint 34 de 20/3 a 27/3 — os dias 20 a 27 devem ter uma borda branca/destacada para identificar rapidamente o periodo da sprint.

**Problema atual:** A app so tem o **nome** da sprint (ex: "Sprint 34") extraido de `wp._links?.version?.title`. Nao tem as datas de inicio/fim. O OpenProject disponibiliza estas datas na API de versions (`/api/v3/versions`), mas a app nao as busca.

---

## Fase 1: Buscar datas das sprints na API

### 1A: Novo tipo `SprintInfo`

**Ficheiro:** `types/index.ts`

```typescript
export type SprintInfo = {
  id: string;
  name: string;
  startDate: string | null; // "YYYY-MM-DD"
  endDate: string | null;   // "YYYY-MM-DD"
};
```

### 1B: Buscar versions na rota `verify-token`

**Ficheiro:** `app/api/openproject/verify-token/route.ts`

Apos buscar os work packages, extrair os IDs unicos de version dos work packages e buscar os detalhes de cada version:

1. Recolher `versionHrefs` unicos de `wp._links?.version?.href` (ex: `/api/v3/versions/42`)
2. Para cada href unico, fazer `GET {baseUrl}{href}` para obter `startDate` e `endDate`
3. Construir array de `SprintInfo` e incluir na response como `sprints`

Alternativamente (mais eficiente): buscar todas as versions do projeto de uma vez:
- Extrair project IDs dos work packages: `wp._links?.project?.href`
- Para cada projeto unico: `GET {baseUrl}/api/v3/projects/{id}/versions`
- Mapear versions para `SprintInfo[]`

### 1C: Incluir `sprints` na response da API

A response passa a ter:
```json
{
  "success": true,
  "user": { ... },
  "todos": [ ... ],
  "timeEntries": { ... },
  "sprints": [
    { "id": "42", "name": "Sprint 34", "startDate": "2026-03-20", "endDate": "2026-03-27" }
  ]
}
```

---

## Fase 2: Propagar dados de sprint ate ao Calendar

### 2A: Atualizar `page.tsx`

**Ficheiro:** `app/page.tsx`

- Adicionar estado: `const [sprints, setSprints] = useState<SprintInfo[]>([])`
- Extrair `data.sprints` da response do `verify-token`
- Passar `sprints` como prop ao `Calendar`

### 2B: Atualizar props do Calendar

**Ficheiro:** `components/Calendar/index.tsx`

- Adicionar `sprints?: SprintInfo[]` ao `CalendarProps`
- Computar `activeSprintInfo` com useMemo: encontrar o SprintInfo cujo `name === activeSprint`

---

## Fase 3: Visualizar periodo da sprint no calendario

### 3A: Computar quais dias pertencem a sprint

**Ficheiro:** `components/Calendar/index.tsx`

Adicionar memo que calcula o set de dias dentro da sprint ativa:
```typescript
const sprintDayKeys = useMemo(() => {
  if (!activeSprintInfo?.startDate || !activeSprintInfo?.endDate) return new Set<string>();
  const keys = new Set<string>();
  const start = new Date(activeSprintInfo.startDate);
  const end = new Date(activeSprintInfo.endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    keys.add(toKey(d));
  }
  return keys;
}, [activeSprintInfo]);
```

### 3B: Passar `isInSprint` ao DayCell

**Ficheiro:** `components/Calendar/index.tsx` (no loop de render do grid)

Calcular e passar:
```typescript
const isInSprint = activeSprint ? sprintDayKeys.has(key) : false;
```

### 3C: Estilizar DayCell com borda de sprint

**Ficheiro:** `components/Calendar/DayCell.tsx`

Adicionar prop `isInSprint?: boolean` e aplicar borda visual:

- Quando `isInSprint === true`: adicionar `ring-2 ring-white ring-opacity-80` (ou borda branca semelhante)
- A borda de sprint nao deve sobrepor a borda de "hoje" (`ring-indigo-400`) — usar estilo diferente, ex: `border-2 border-white` em vez de ring
- Opcao alternativa: usar uma borda com cor neutra/branca e um leve shadow, tipo `shadow-[0_0_0_2px_rgba(255,255,255,0.8)]`

Proposta de implementacao:
```tsx
className={`... ${isInSprint ? "ring-2 ring-white dark:ring-slate-300" : ""} ${isToday ? "ring-2 ring-indigo-400" : ""}`}
```

Nota: se ambos `isInSprint` e `isToday` forem true, `isToday` deve ter prioridade visual. Usar logica condicional:
```tsx
const ringClass = isToday
  ? "ring-2 ring-indigo-400"
  : isInSprint
  ? "ring-2 ring-white dark:ring-slate-300"
  : "";
```

### 3D: Legenda visual (opcional mas recomendado)

Junto ao dropdown de sprint, mostrar texto pequeno com as datas:
```
Sprint: [Sprint 34 ▼]  (20 Mar - 27 Mar)  (8 tarefas)
```

---

## Ficheiros a modificar

| Ficheiro | Tipo | Descricao |
|----------|------|-----------|
| `types/index.ts` | Modificar | Adicionar tipo `SprintInfo` |
| `app/api/openproject/verify-token/route.ts` | Modificar | Buscar versions com datas, incluir `sprints` na response |
| `app/page.tsx` | Modificar | Estado `sprints`, passar como prop ao Calendar |
| `components/Calendar/index.tsx` | Modificar | Receber `sprints`, computar `sprintDayKeys`, passar `isInSprint` ao DayCell |
| `components/Calendar/DayCell.tsx` | Modificar | Prop `isInSprint`, estilo visual (ring/borda branca) |
| `README.md` | Modificar | Changelog |

## Verificacao

1. `npm run build` — sem erros
2. Login → verificar que a response inclui `sprints` com datas
3. Selecionar sprint no dropdown → dias dentro do periodo ficam com borda branca
4. Dia "hoje" mantem borda indigo (prioridade sobre sprint)
5. Sprint sem datas (startDate/endDate null) → nenhuma borda extra
6. Trocar de sprint → borda atualiza para o novo periodo
7. Selecionar "Todas" → bordas de sprint desaparecem
