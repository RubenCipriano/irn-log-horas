import type { Holiday } from "@/types";

function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function getPortugalHolidays(year: number): Holiday[] {
  const easter = getEasterSunday(year);

  const fixed: Holiday[] = [
    { name: "Ano Novo", date: new Date(year, 0, 1) },
    { name: "Dia da Liberdade", date: new Date(year, 3, 25) },
    { name: "Dia do Trabalhador", date: new Date(year, 4, 1) },
    { name: "Dia de Portugal", date: new Date(year, 5, 10) },
    { name: "Assuncao de Nossa Senhora", date: new Date(year, 7, 15) },
    { name: "Implantacao da Republica", date: new Date(year, 9, 5) },
    { name: "Dia de Todos os Santos", date: new Date(year, 10, 1) },
    { name: "Restauracao da Independencia", date: new Date(year, 11, 1) },
    { name: "Imaculada Conceicao", date: new Date(year, 11, 8) },
    { name: "Natal", date: new Date(year, 11, 25) },
  ];

  const movable: Holiday[] = [
    { name: "Carnaval", date: addDays(easter, -47) },
    { name: "Sexta-Feira Santa", date: addDays(easter, -2) },
    { name: "Pascoa", date: addDays(easter, 0) },
    { name: "Corpo de Deus", date: addDays(easter, 60) },
  ];

  return [...fixed, ...movable];
}
