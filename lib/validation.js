import * as v from "valibot";

const monthKeyPattern = /^\d{4}-\d{2}$/;

function asTrimmedText(message) {
  return v.pipe(v.string(), v.trim(), v.minLength(1, message));
}

function asDateText(message) {
  return v.pipe(v.string(), v.trim(), v.minLength(1, message));
}

function asMonthKey(message) {
  return v.pipe(v.string(), v.trim(), v.minLength(1, message), v.regex(monthKeyPattern, "Selecciona meses validos para el grafico."));
}

function asPositiveAmount(message) {
  return v.pipe(
    v.union([v.string(), v.number()]),
    v.transform((value) => Number(value)),
    v.number("Ingresa un numero valido."),
    v.finite("Ingresa un numero valido."),
    v.minValue(0.01, message),
  );
}

function asNonZeroAmount(message) {
  return v.pipe(
    v.union([v.string(), v.number()]),
    v.transform((value) => Number(value)),
    v.number("Ingresa un numero valido."),
    v.finite("Ingresa un numero valido."),
    v.check((value) => value !== 0, message),
  );
}

function firstErrorMessage(result, fallbackMessage) {
  return result.issues?.[0]?.message ?? fallbackMessage;
}

export function validateExpenseRecord(expense, { categories, frequencies }) {
  const schema = v.object({
    name: asTrimmedText("El gasto debe tener nombre."),
    amount: asPositiveAmount("El gasto debe tener un valor mayor que cero."),
    category: v.picklist(categories, "Selecciona una categoria valida para el gasto."),
    frequency: v.picklist(frequencies, "Selecciona una frecuencia valida para el gasto."),
    movementDate: asDateText("El gasto debe tener fecha de movimiento."),
    endDate: v.optional(v.string()),
    isRecurringIndefinite: v.optional(v.boolean()),
  });
  const result = v.safeParse(schema, expense);

  if (!result.success) {
    return firstErrorMessage(result, "No se pudo validar el gasto.");
  }

  if (!expense.isRecurringIndefinite && expense.endDate && String(expense.endDate) < String(expense.movementDate)) {
    return "La fecha de fin del gasto no puede ser anterior a la fecha de movimiento.";
  }

  return "";
}

export function validateBudgetRecord(budget, { categories, frequencies }) {
  const schema = v.object({
    name: asTrimmedText("El presupuesto debe tener nombre."),
    amount: asPositiveAmount("El presupuesto debe tener un valor mayor que cero."),
    frequency: v.picklist(frequencies, "Selecciona una frecuencia valida para el presupuesto."),
    startDate: asDateText("El presupuesto debe tener fecha de inicio."),
    endDate: v.optional(v.string()),
    isRecurringIndefinite: v.optional(v.boolean()),
    linkedCategories: v.pipe(
      v.array(v.picklist(categories, "El presupuesto contiene categorias no validas.")),
      v.minLength(1, "Selecciona al menos una categoria para el presupuesto."),
    ),
  });
  const result = v.safeParse(schema, budget);

  if (!result.success) {
    return firstErrorMessage(result, "No se pudo validar el presupuesto.");
  }

  if (!budget.isRecurringIndefinite && budget.endDate && String(budget.endDate) < String(budget.startDate)) {
    return "La fecha de fin del presupuesto no puede ser anterior a la fecha de inicio.";
  }

  return "";
}

export function validateIncomeRecord(income, { categories, frequencies }) {
  const schema = v.object({
    name: asTrimmedText("El ingreso debe tener nombre."),
    amount: asPositiveAmount("El ingreso debe tener un valor mayor que cero."),
    frequency: v.picklist(frequencies, "Selecciona una frecuencia valida para el ingreso."),
    startDate: asDateText("El ingreso debe tener fecha de inicio o unica."),
    endDate: v.optional(v.string()),
    isRecurringIndefinite: v.optional(v.boolean()),
    isReimbursement: v.optional(v.boolean()),
    reimbursementCategory: v.optional(v.string()),
  });
  const result = v.safeParse(schema, income);

  if (!result.success) {
    return firstErrorMessage(result, "No se pudo validar el ingreso.");
  }

  if (income.isReimbursement && !categories.includes(String(income.reimbursementCategory ?? ""))) {
    return "Selecciona la categoria que se debe ajustar con el reembolso.";
  }

  if (!income.isRecurringIndefinite && income.endDate && String(income.endDate) < String(income.startDate)) {
    return "La fecha de fin del ingreso no puede ser anterior a la fecha de inicio.";
  }

  return "";
}

export function validateAdjustmentRecord(adjustment) {
  const schema = v.object({
    date: asDateText("El cuadre debe tener fecha."),
    amount: asNonZeroAmount("El cuadre debe tener un valor distinto de cero."),
  });
  const result = v.safeParse(schema, adjustment);

  if (!result.success) {
    return firstErrorMessage(result, "No se pudo validar el cuadre.");
  }

  return "";
}

export function validateAnalysisSettingsRecord(settings) {
  const schema = v.object({
    startDate: asDateText("La fecha base es obligatoria."),
    endDate: asDateText("La fecha de fin es obligatoria."),
    chartStartMonth: asMonthKey("El mes inicial del grafico es obligatorio."),
    chartEndMonth: asMonthKey("El mes final del grafico es obligatorio."),
  });
  const result = v.safeParse(schema, settings);

  if (!result.success) {
    return firstErrorMessage(result, "No se pudo validar la configuracion.");
  }

  if (String(settings.startDate) > String(settings.endDate)) {
    return "La fecha base no puede ser posterior a la fecha de fin.";
  }

  if (String(settings.chartStartMonth) > String(settings.chartEndMonth)) {
    return "El mes inicial del grafico no puede ser posterior al mes final.";
  }

  return "";
}
