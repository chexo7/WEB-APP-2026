import * as v from "valibot";

const monthKeyPattern = /^\d{4}-\d{2}$/;
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
const usdOnlyMessage = "Convierte el monto a USD antes de guardarlo. El flujo, presupuesto y cuadre trabajan en una sola moneda base.";

function asTrimmedText(message) {
  return v.pipe(v.string(), v.trim(), v.minLength(1, message));
}

function asDateText(message) {
  return v.pipe(v.string(), v.trim(), v.minLength(1, message));
}

function asMonthKey(message) {
  return v.pipe(v.string(), v.trim(), v.minLength(1, message), v.regex(monthKeyPattern, "Selecciona meses validos para el grafico."));
}

function asUsdCurrency() {
  return v.optional(v.picklist(["USD"], usdOnlyMessage));
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

function asAmount(message = "Ingresa un numero valido.") {
  return v.pipe(
    v.union([v.string(), v.number()]),
    v.transform((value) => Number(value)),
    v.number(message),
    v.finite(message),
  );
}

function firstErrorMessage(result, fallbackMessage) {
  return result.issues?.[0]?.message ?? fallbackMessage;
}

function isValidDateKey(value) {
  const text = String(value ?? "").trim();
  if (!dateKeyPattern.test(text)) return false;

  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidMonthKey(value) {
  const text = String(value ?? "").trim();
  if (!monthKeyPattern.test(text)) return false;

  const [, month] = text.split("-").map(Number);
  return month >= 1 && month <= 12;
}

function validateDateField(value, message) {
  return isValidDateKey(value) ? "" : message;
}

function validateOptionalDateField(value, message) {
  return value && !isValidDateKey(value) ? message : "";
}

export function validateExpenseRecord(expense, { categories, frequencies }) {
  const schema = v.object({
    name: asTrimmedText("El gasto debe tener nombre."),
    amount: asPositiveAmount("El gasto debe tener un valor mayor que cero."),
    currency: asUsdCurrency(),
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

  const movementDateError = validateDateField(expense.movementDate, "El gasto debe tener una fecha de movimiento valida.");
  if (movementDateError) return movementDateError;

  const endDateError = validateOptionalDateField(expense.endDate, "La fecha de fin del gasto no es valida.");
  if (endDateError) return endDateError;

  if (!expense.isRecurringIndefinite && expense.endDate && String(expense.endDate) < String(expense.movementDate)) {
    return "La fecha de fin del gasto no puede ser anterior a la fecha de movimiento.";
  }

  return "";
}

export function validateBudgetRecord(budget, { categories, frequencies }) {
  const schema = v.object({
    name: asTrimmedText("El presupuesto debe tener nombre."),
    amount: asPositiveAmount("El presupuesto debe tener un valor mayor que cero."),
    currency: asUsdCurrency(),
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

  const startDateError = validateDateField(budget.startDate, "El presupuesto debe tener una fecha de inicio valida.");
  if (startDateError) return startDateError;

  const endDateError = validateOptionalDateField(budget.endDate, "La fecha de fin del presupuesto no es valida.");
  if (endDateError) return endDateError;

  if (!budget.isRecurringIndefinite && budget.endDate && String(budget.endDate) < String(budget.startDate)) {
    return "La fecha de fin del presupuesto no puede ser anterior a la fecha de inicio.";
  }

  return "";
}

export function validateIncomeRecord(income, { categories, frequencies }) {
  const schema = v.object({
    name: asTrimmedText("El ingreso debe tener nombre."),
    amount: asPositiveAmount("El ingreso debe tener un valor mayor que cero."),
    currency: asUsdCurrency(),
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

  const startDateError = validateDateField(income.startDate, "El ingreso debe tener una fecha de inicio valida.");
  if (startDateError) return startDateError;

  const endDateError = validateOptionalDateField(income.endDate, "La fecha de fin del ingreso no es valida.");
  if (endDateError) return endDateError;

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

  const dateError = validateDateField(adjustment.date, "El cuadre debe tener una fecha valida.");
  if (dateError) return dateError;

  return "";
}

export function validateBalanceSnapshotRecord(snapshot) {
  const schema = v.object({
    date: asDateText("El saldo observado debe tener fecha."),
    cashUsd: asAmount(),
    chileUsd: asAmount(),
    schwabUsd: asAmount(),
    bofaUsd: asAmount(),
  });
  const result = v.safeParse(schema, snapshot);

  if (!result.success) {
    return firstErrorMessage(result, "No se pudo validar el saldo observado.");
  }

  const dateError = validateDateField(snapshot.date, "El saldo observado debe tener una fecha valida.");
  if (dateError) return dateError;

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

  const startDateError = validateDateField(settings.startDate, "La fecha base no es valida.");
  if (startDateError) return startDateError;

  const endDateError = validateDateField(settings.endDate, "La fecha de fin no es valida.");
  if (endDateError) return endDateError;

  if (!isValidMonthKey(settings.chartStartMonth) || !isValidMonthKey(settings.chartEndMonth)) {
    return "Selecciona meses validos para el grafico.";
  }

  if (String(settings.startDate) > String(settings.endDate)) {
    return "La fecha base no puede ser posterior a la fecha de fin.";
  }

  if (String(settings.chartStartMonth) > String(settings.chartEndMonth)) {
    return "El mes inicial del grafico no puede ser posterior al mes final.";
  }

  return "";
}
