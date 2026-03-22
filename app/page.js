"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { get, onValue, push, ref, set } from "firebase/database";
import { getFirebaseAuth, getFirebaseDatabase } from "@/lib/firebase";

const defaultCredentials = { email: "ssfamiliausa@gmail.com", password: "" };
const tabs = [
  { id: "summary", label: "Resumen" },
  { id: "expenses", label: "Gastos" },
  { id: "incomes", label: "Ingresos" },
  { id: "reconciliation", label: "Cuadre" },
  { id: "cashflow", label: "Tabla" },
  { id: "charts", label: "Graficos" },
];
const expenseCategories = [
  "Ahorros",
  "Arriendo",
  "Auto",
  "Cosas de Casa",
  "Creditos",
  "Cuentas",
  "Delivery",
  "Deporte",
  "Gastos Comunes",
  "Inversiones",
  "Minimarket",
  "Otros",
  "Panoramas",
  "Regalos para alguien",
  "Ropa",
  "Salidas a comer",
  "Salud",
  "Supermercado",
  "Suscripciones",
  "Transporte Publico",
  "Uber",
  "Vega",
  "Viajes",
];
const expenseFrequencies = ["Unico", "Mensual", "Semanal", "Bi-semanal"];
const expenseCurrencies = [
  { value: "USD", label: "USD - Dolar Estadounidense" },
  { value: "CLP", label: "CLP - Peso Chileno" },
];
const incomeFrequencies = ["Mensual", "Semanal", "Bi-semanal", "Unico"];
const incomeCurrencies = expenseCurrencies;
const fixedExpenseCategories = ["Ahorros", "Arriendo", "Creditos", "Cuentas", "Gastos Comunes", "Inversiones", "Suscripciones"];
const variableExpenseCategories = [
  "Auto",
  "Cosas de Casa",
  "Delivery",
  "Deporte",
  "Minimarket",
  "Otros",
  "Panoramas",
  "Regalos para alguien",
  "Ropa",
  "Salidas a comer",
  "Salud",
  "Supermercado",
  "Transporte Publico",
  "Uber",
  "Vega",
  "Viajes",
];
const expenseCategoryGroups = Object.fromEntries([
  ...fixedExpenseCategories.map((category) => [category, "fixed"]),
  ...variableExpenseCategories.map((category) => [category, "variable"]),
]);

export default function HomePage() {
  const [credentials, setCredentials] = useState(defaultCredentials);
  const [authState, setAuthState] = useState("checking");
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("summary");
  const [snapshotTree, setSnapshotTree] = useState({});
  const [selectedVersionKey, setSelectedVersionKey] = useState("");
  const [loadedVersionKey, setLoadedVersionKey] = useState("");
  const [draft, setDraft] = useState(emptyWorkspace());
  const [expenseForm, setExpenseForm] = useState(defaultExpenseForm());
  const [incomeForm, setIncomeForm] = useState(defaultIncomeForm());
  const [adjustmentForm, setAdjustmentForm] = useState(defaultAdjustmentForm());
  const [editingExpenseId, setEditingExpenseId] = useState("");
  const [editingIncomeId, setEditingIncomeId] = useState("");
  const [editingAdjustmentId, setEditingAdjustmentId] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [dataError, setDataError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [expenseSort, setExpenseSort] = useState({ key: "movementDate", direction: "desc" });
  const [incomeSort, setIncomeSort] = useState({ key: "startDate", direction: "desc" });
  const [adjustmentSort, setAdjustmentSort] = useState({ key: "date", direction: "desc" });
  const [cashflowTooltip, setCashflowTooltip] = useState(null);
  const cashflowScrollRef = useRef(null);
  const currentDayColumnRef = useRef(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthState(nextUser ? "authenticated" : "anonymous");
      setAuthError("");
    });
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setSnapshotTree({});
      setSelectedVersionKey("");
      setLoadedVersionKey("");
      setDraft(emptyWorkspace());
      setIsInitializing(false);
      return;
    }

    let active = true;

    const initialize = async () => {
      setIsInitializing(true);

      try {
        const database = getFirebaseDatabase();
        const userRef = ref(database, `users/${user.uid}`);
        const userSnapshot = await get(userRef);

        if (!userSnapshot.exists()) {
          await set(userRef, createInitialUserData(user, localDate()));
        } else {
          const currentData = userSnapshot.val() ?? {};
          const today = localDate();

          if (!currentData.profile) {
            await set(ref(database, `users/${user.uid}/profile`), createUserProfile(user));
          }

          if (!currentData.cashflowSnapshots || !Object.keys(currentData.cashflowSnapshots).length) {
            await set(
              ref(database, `users/${user.uid}/cashflowSnapshots/${today}`),
              createInitialUserData(user, today).cashflowSnapshots[today],
            );
          }
        }
      } catch (firebaseError) {
        if (active) {
          setDataError(firebaseError.message);
        }
      } finally {
        if (active) {
          setIsInitializing(false);
        }
      }
    };

    initialize();

    return () => {
      active = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    const database = getFirebaseDatabase();
    const snapshotsRef = ref(database, `users/${user.uid}/cashflowSnapshots`);

    return onValue(
      snapshotsRef,
      (snapshot) => {
        setSnapshotTree(snapshot.val() ?? {});
        setDataError("");
      },
      (firebaseError) => {
        setDataError(firebaseError.message);
      },
    );
  }, [user?.uid]);

  const recentVersions = useMemo(() => extractRecentVersions(snapshotTree).slice(0, 5), [snapshotTree]);

  useEffect(() => {
    if (!recentVersions.length) {
      setSelectedVersionKey("");
      setLoadedVersionKey("");
      setDraft(emptyWorkspace());
      return;
    }

    if (!selectedVersionKey) {
      setSelectedVersionKey(recentVersions[0].key);
      return;
    }

    const selectedVersion = recentVersions.find((version) => version.key === selectedVersionKey);

    if (selectedVersion && loadedVersionKey !== selectedVersionKey) {
      setDraft(normalizeWorkspace(selectedVersion.payload));
      setLoadedVersionKey(selectedVersionKey);
      setExpenseForm(defaultExpenseForm());
      setIncomeForm(defaultIncomeForm());
      setAdjustmentForm(defaultAdjustmentForm());
      setEditingExpenseId("");
      setEditingIncomeId("");
      setEditingAdjustmentId("");
      setSaveState("idle");
      setDataError("");
      setSuccessMessage("");
    }
  }, [loadedVersionKey, recentVersions, selectedVersionKey]);

  const selectedVersion =
    recentVersions.find((version) => version.key === selectedVersionKey) ?? recentVersions[0] ?? null;

  const expenseEntries = useMemo(() => Object.entries(draft.expenses).map(([id, value]) => ({ id, ...value })), [draft.expenses]);
  const incomeEntries = useMemo(() => Object.entries(draft.incomes).map(([id, value]) => ({ id, ...value })), [draft.incomes]);
  const adjustmentEntries = useMemo(() => Object.entries(draft.adjustments ?? {}).map(([id, value]) => ({ id, ...value })), [draft.adjustments]);
  const expenses = useMemo(() => sortCollection(expenseEntries, expenseSort, getExpenseSortValue), [expenseEntries, expenseSort]);
  const incomes = useMemo(() => sortCollection(incomeEntries, incomeSort, getIncomeSortValue), [incomeEntries, incomeSort]);
  const adjustments = useMemo(
    () => sortCollection(adjustmentEntries, adjustmentSort, getAdjustmentSortValue),
    [adjustmentEntries, adjustmentSort],
  );

  const reimbursementTotal = incomes.reduce((sum, item) => sum + (item.isReimbursement ? Number(item.amount) || 0 : 0), 0);
  const incomeTotal = incomes.reduce((sum, item) => sum + (item.isReimbursement ? 0 : Number(item.amount) || 0), 0);
  const adjustmentTotal = adjustments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const expenseCategoryTotals = useMemo(() => {
    const totals = Object.fromEntries(expenseCategories.map((category) => [category, 0]));

    for (const expense of expenses) {
      const category = expenseCategories.includes(String(expense.category ?? "")) ? expense.category : "Otros";
      totals[category] = (totals[category] ?? 0) + (Number(expense.amount) || 0);
    }

    for (const income of incomes) {
      if (!income.isReimbursement) continue;
      const category = expenseCategories.includes(String(income.reimbursementCategory ?? "")) ? income.reimbursementCategory : "Otros";
      totals[category] = (totals[category] ?? 0) - (Number(income.amount) || 0);
    }

    return totals;
  }, [expenses, incomes]);
  const expenseTotal = Object.values(expenseCategoryTotals).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
  const balance = incomeTotal - expenseTotal + adjustmentTotal;
  const hasUnsavedChanges = JSON.stringify(sanitizeWorkspace(draft)) !== JSON.stringify(sanitizeWorkspace(selectedVersion?.payload));
  const todayKey = localDate();
  const cashflowModel = useMemo(
    () =>
      buildCashflowModel({
        expenses,
        incomes,
        adjustments,
        currentDateKey: todayKey,
      }),
    [adjustments, expenses, incomes, todayKey],
  );

  useEffect(() => {
    if (activeTab !== "cashflow") {
      setCashflowTooltip(null);
      return;
    }

    const container = cashflowScrollRef.current;
    const target = currentDayColumnRef.current;

    if (!container || !target) return;

    const frame = requestAnimationFrame(() => {
      const nextLeft = Math.max(0, target.offsetLeft - container.clientWidth / 2 + target.clientWidth / 2);
      container.scrollTo({ left: nextLeft, behavior: "smooth" });
    });

    return () => cancelAnimationFrame(frame);
  }, [activeTab, cashflowModel.todayKey, cashflowModel.dates.length]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthState("loading");

    try {
      const auth = getFirebaseAuth();
      await signInWithEmailAndPassword(auth, credentials.email.trim(), credentials.password);
    } catch (firebaseError) {
      setAuthState("anonymous");
      setAuthError(firebaseError.message);
    }
  };

  const handleLogout = async () => {
    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
    } catch (firebaseError) {
      setAuthError(firebaseError.message);
    }
  };

  const saveExpenseToDraft = (event) => {
    event.preventDefault();
    const error = validateExpense(expenseForm);

    if (error) {
      setDataError(error);
      return;
    }

    const expenseId = editingExpenseId || localId("expense");

    setDraft((current) => ({
      ...current,
      expenses: {
        ...current.expenses,
        [expenseId]: {
          name: expenseForm.name.trim(),
          amount: Number(expenseForm.amount),
          currency: expenseForm.currency,
          category: expenseForm.category,
          frequency: expenseForm.frequency,
          movementDate: expenseForm.movementDate,
          endDate: expenseForm.isRecurringIndefinite ? "" : expenseForm.endDate,
          isRecurringIndefinite: Boolean(expenseForm.isRecurringIndefinite),
          createdAt: current.expenses?.[expenseId]?.createdAt ?? Date.now(),
        },
      },
    }));

    setExpenseForm(defaultExpenseForm());
    setEditingExpenseId("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const saveIncomeToDraft = (event) => {
    event.preventDefault();
    const error = validateIncome(incomeForm);

    if (error) {
      setDataError(error);
      return;
    }

    const incomeId = editingIncomeId || localId("income");

    setDraft((current) => ({
      ...current,
      incomes: {
        ...current.incomes,
        [incomeId]: {
          name: incomeForm.name.trim(),
          amount: Number(incomeForm.amount),
          currency: incomeForm.currency,
          frequency: incomeForm.frequency,
          startDate: incomeForm.startDate,
          endDate: incomeForm.isRecurringIndefinite ? "" : incomeForm.endDate,
          isRecurringIndefinite: Boolean(incomeForm.isRecurringIndefinite),
          isReimbursement: Boolean(incomeForm.isReimbursement),
          reimbursementCategory: incomeForm.isReimbursement ? incomeForm.reimbursementCategory : "",
          createdAt: current.incomes?.[incomeId]?.createdAt ?? Date.now(),
        },
      },
    }));

    setIncomeForm(defaultIncomeForm());
    setEditingIncomeId("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const saveAdjustmentToDraft = (event) => {
    event.preventDefault();
    const error = validateAdjustment(adjustmentForm);

    if (error) {
      setDataError(error);
      return;
    }

    const adjustmentId = editingAdjustmentId || localId("adjustment");

    setDraft((current) => ({
      ...current,
      adjustments: {
        ...(current.adjustments ?? {}),
        [adjustmentId]: {
          date: adjustmentForm.date,
          amount: Number(adjustmentForm.amount),
          createdAt: current.adjustments?.[adjustmentId]?.createdAt ?? Date.now(),
        },
      },
    }));

    setAdjustmentForm(defaultAdjustmentForm());
    setEditingAdjustmentId("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const editExpense = (expenseId) => {
    const expense = draft.expenses[expenseId];
    if (!expense) return;

    setExpenseForm({
      name: expense.name ?? expense.merchantName ?? expense.detail ?? "",
      amount: String(expense.amount ?? ""),
      currency: expense.currency ?? "USD",
      category: expense.category ?? "Ahorros",
      frequency: expense.frequency ?? "Unico",
      movementDate: expense.movementDate ?? expense.date ?? localDate(),
      endDate: expense.endDate ?? "",
      isRecurringIndefinite: Boolean(expense.isRecurringIndefinite),
    });
    setEditingExpenseId(expenseId);
    setActiveTab("expenses");
  };

  const editIncome = (incomeId) => {
    const income = draft.incomes[incomeId];
    if (!income) return;

    setIncomeForm({
      name: income.name ?? "",
      amount: String(income.amount ?? ""),
      currency: income.currency ?? "USD",
      frequency: income.frequency ?? "Mensual",
      startDate: income.startDate ?? localDate(),
      endDate: income.endDate ?? "",
      isRecurringIndefinite: Boolean(income.isRecurringIndefinite),
      isReimbursement: Boolean(income.isReimbursement),
      reimbursementCategory: income.reimbursementCategory ?? "",
    });
    setEditingIncomeId(incomeId);
    setActiveTab("incomes");
  };

  const editAdjustment = (adjustmentId) => {
    const adjustment = draft.adjustments?.[adjustmentId];
    if (!adjustment) return;

    setAdjustmentForm({
      date: adjustment.date ?? localDate(),
      amount: String(adjustment.amount ?? ""),
    });
    setEditingAdjustmentId(adjustmentId);
    setActiveTab("reconciliation");
  };

  const deleteExpense = (expenseId) => {
    setDraft((current) => {
      const nextExpenses = { ...current.expenses };
      delete nextExpenses[expenseId];
      return { ...current, expenses: nextExpenses };
    });
    setSaveState("idle");
    setSuccessMessage("");
  };

  const deleteIncome = (incomeId) => {
    setDraft((current) => {
      const nextIncomes = { ...current.incomes };
      delete nextIncomes[incomeId];
      return { ...current, incomes: nextIncomes };
    });
    setSaveState("idle");
    setSuccessMessage("");
  };

  const deleteAdjustment = (adjustmentId) => {
    setDraft((current) => {
      const nextAdjustments = { ...(current.adjustments ?? {}) };
      delete nextAdjustments[adjustmentId];
      return { ...current, adjustments: nextAdjustments };
    });
    setSaveState("idle");
    setSuccessMessage("");
  };

  const showCashflowTooltip = (event, row, date) => {
    const details = row.details?.[date] ?? buildEmptyCashflowDetails(row.label, date);
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.min(rect.left, Math.max(16, window.innerWidth - 320));
    const top = Math.min(rect.bottom + 10, window.innerHeight - 180);

    setCashflowTooltip({
      left,
      top,
      title: row.label,
      date,
      lines: details.lines,
      total: details.total,
    });
  };

  const discardChanges = () => {
    setDraft(normalizeWorkspace(selectedVersion?.payload));
    setExpenseForm(defaultExpenseForm());
    setIncomeForm(defaultIncomeForm());
    setAdjustmentForm(defaultAdjustmentForm());
    setEditingExpenseId("");
    setEditingIncomeId("");
    setEditingAdjustmentId("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const saveVersion = async (sectionLabel) => {
    const sanitized = sanitizeWorkspace(draft);
    const error = validateWorkspace(sanitized);

    if (error || !user?.uid) {
      setDataError(error || "No hay sesion activa.");
      return;
    }

    setSaveState("saving");
    setDataError("");
    setSuccessMessage("");

    try {
      const database = getFirebaseDatabase();
      const snapshotDate = localDate();
      const versionsRef = ref(database, `users/${user.uid}/cashflowSnapshots/${snapshotDate}/versions`);
      const newVersionRef = push(versionsRef);
      const versionPayload = createVersionPayload(snapshotDate, sanitized, user, selectedVersion);

      await set(newVersionRef, versionPayload);

      setSnapshotTree((current) => ({
        ...current,
        [snapshotDate]: {
          ...(current[snapshotDate] ?? {}),
          versions: {
            ...(current[snapshotDate]?.versions ?? {}),
            [newVersionRef.key]: versionPayload,
          },
        },
      }));

      setSelectedVersionKey(buildKey(snapshotDate, newVersionRef.key));
      setLoadedVersionKey("");
      setSaveState("saved");
      setSuccessMessage(`La lista de ${sectionLabel} se guardo como nueva entrada.`);
    } catch (firebaseError) {
      setSaveState("error");
      setDataError(firebaseError.message);
    }
  };

  if (authState !== "authenticated") {
    return (
      <main className="login-shell">
        <section className="login-card">
          <form className="login-form" onSubmit={handleLogin}>
            <h1>Acceso</h1>

            <label>
              Usuario
              <input
                autoComplete="email"
                name="email"
                onChange={(event) => setCredentials((current) => ({ ...current, email: event.target.value }))}
                type="email"
                value={credentials.email}
              />
            </label>

            <label>
              Contrasena
              <input
                autoComplete="current-password"
                name="password"
                onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))}
                type="password"
                value={credentials.password}
              />
            </label>

            <button className="primary-button" disabled={authState === "loading"} type="submit">
              {authState === "loading" ? "Entrando..." : "Entrar"}
            </button>

            {authError ? <p className="error-text">{authError}</p> : null}
          </form>
        </section>
      </main>
    );
  }

  if (isInitializing) {
    return (
      <main className="login-shell">
        <section className="login-card loading-card">
          <h1>Preparando base de datos</h1>
          <p className="muted-text">Creando la estructura minima para la nueva interfaz.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Web App Flujo De Caja</p>
          <h1>Sketch funcional</h1>
          <p className="muted-text">Trabajas sobre un borrador local y solo guardas una nueva entrada cuando lo confirmas.</p>
        </div>

        <div className="topbar-actions">
          <label className="history-control">
            Ultimas 5 entradas
            <select onChange={(event) => setSelectedVersionKey(event.target.value)} value={selectedVersionKey}>
              {recentVersions.map((version) => (
                <option key={version.key} value={version.key}>
                  {labelVersion(version)}
                </option>
              ))}
            </select>
          </label>

          <span className={hasUnsavedChanges ? "status-chip pending" : "status-chip"}>
            {hasUnsavedChanges ? "Cambios sin guardar" : "Sin cambios pendientes"}
          </span>

          <span className="user-chip">{user?.email}</span>

          <button className="secondary-button" onClick={handleLogout} type="button">
            Cerrar sesion
          </button>
        </div>
      </section>

      <section className="tabs-card">
        <div className="tabs-bar" role="tablist" aria-label="Pestanas principales">
          {tabs.map((tab) => (
            <button
              className={activeTab === tab.id ? "tab-button active" : "tab-button"}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="tab-panel">
          {activeTab === "summary" ? (
            <section className="summary-panel">
              <div className="summary-grid">
                <article className="summary-card">
                  <span>Ingresos reales</span>
                  <strong>{money(incomeTotal, "USD")}</strong>
                </article>
                <article className="summary-card">
                  <span>Reembolsos aplicados</span>
                  <strong>{money(reimbursementTotal, "USD")}</strong>
                </article>
                <article className="summary-card">
                  <span>Gastos netos</span>
                  <strong>{money(expenseTotal, "USD")}</strong>
                </article>
                <article className="summary-card">
                  <span>Cuadres</span>
                  <strong>{money(adjustmentTotal, "USD")}</strong>
                </article>
                <article className="summary-card">
                  <span>Saldo actual</span>
                  <strong>{money(balance, "USD")}</strong>
                </article>
              </div>

              <section className="panel-card blank-panel summary-note">
                <div className="panel-heading">
                  <h2>Resumen general</h2>
                  <p>Desde aqui controlas la version cargada, el estado del borrador y el balance general antes de pasar a cada pestana operativa.</p>
                </div>

                <div className="summary-meta">
                  <div>
                    <span className="summary-meta-label">Version activa</span>
                    <strong>{selectedVersion ? selectedVersion.snapshotDate : "Sin datos"}</strong>
                  </div>
                  <div>
                    <span className="summary-meta-label">Entrada seleccionada</span>
                    <strong>{selectedVersion ? labelVersion(selectedVersion) : "Sin historial todavia"}</strong>
                  </div>
                  <div>
                    <span className="summary-meta-label">Registros en borrador</span>
                    <strong>{expenses.length + incomes.length + adjustments.length} movimientos</strong>
                  </div>
                  <div>
                    <span className="summary-meta-label">Criterio aplicado</span>
                    <strong>Los reembolsos descuentan gastos y los cuadres ajustan saldo sin ser ingreso ni gasto.</strong>
                  </div>
                </div>
              </section>
            </section>
          ) : null}

          {activeTab === "expenses" ? (
            <section className="workspace-stack expenses-stack">
              <div className="expense-tab-header">
                <h2>Gestion de Gastos</h2>
              </div>

              <form className="panel-card panel-frame entry-form expense-entry-form" onSubmit={saveExpenseToDraft}>
                <div className="expense-form-title">
                  <h3>{editingExpenseId ? "Modificar Gasto" : "Registrar Nuevo Gasto"}</h3>
                </div>

                <div className="expense-form-grid">
                  <label className="expense-field expense-field-full">
                    Nombre:
                    <input name="name" onChange={(e) => setExpenseForm((c) => ({ ...c, name: e.target.value }))} value={expenseForm.name} />
                  </label>
                  <label className="expense-field">
                    Monto:
                    <input inputMode="decimal" name="amount" onChange={(e) => setExpenseForm((c) => ({ ...c, amount: e.target.value }))} value={expenseForm.amount} />
                  </label>
                  <label className="expense-field">
                    Moneda:
                    <select name="currency" onChange={(e) => setExpenseForm((c) => ({ ...c, currency: e.target.value }))} value={expenseForm.currency}>
                      {expenseCurrencies.map((currencyOption) => (
                        <option key={currencyOption.value} value={currencyOption.value}>
                          {currencyOption.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="expense-field">
                    Categoria:
                    <select name="category" onChange={(e) => setExpenseForm((c) => ({ ...c, category: e.target.value }))} value={expenseForm.category}>
                      <option value="" disabled>
                        -- Selecciona Categoria --
                      </option>
                      {expenseCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="expense-field">
                    Frecuencia:
                    <select name="frequency" onChange={(e) => setExpenseForm((c) => ({ ...c, frequency: e.target.value }))} value={expenseForm.frequency}>
                      {expenseFrequencies.map((frequency) => (
                        <option key={frequency} value={frequency}>
                          {frequency}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="expense-field">
                    Fecha Movimiento:
                    <input
                      name="movementDate"
                      onChange={(e) => setExpenseForm((c) => ({ ...c, movementDate: e.target.value }))}
                      type="date"
                      value={expenseForm.movementDate}
                    />
                  </label>
                  <label className="expense-field">
                    Fecha Fin (si aplica):
                    <input
                      disabled={expenseForm.isRecurringIndefinite}
                      name="endDate"
                      onChange={(e) => setExpenseForm((c) => ({ ...c, endDate: e.target.value }))}
                      type="date"
                      value={expenseForm.endDate}
                    />
                  </label>
                </div>

                <label className="expense-checkbox">
                  <input
                    checked={expenseForm.isRecurringIndefinite}
                    name="isRecurringIndefinite"
                    onChange={(e) => setExpenseForm((c) => ({ ...c, isRecurringIndefinite: e.target.checked, endDate: e.target.checked ? "" : c.endDate }))}
                    type="checkbox"
                  />
                  Gasto recurrente sin fin
                </label>

                <div className="button-row">
                  <button className="primary-button" type="submit">
                    {editingExpenseId ? "Actualizar gasto" : "Anadir gasto"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setExpenseForm(defaultExpenseForm());
                      setEditingExpenseId("");
                    }}
                    type="button"
                  >
                    Limpiar
                  </button>
                </div>

                <div className="button-row">
                  <button className="secondary-button" onClick={discardChanges} type="button">
                    Descartar cambios
                  </button>
                  <button className="primary-button" disabled={saveState === "saving"} onClick={() => saveVersion("gastos")} type="button">
                    {saveState === "saving" ? "Guardando..." : "Guardar lista de gastos"}
                  </button>
                </div>

                {successMessage ? <p className="success-text">{successMessage}</p> : null}
                {dataError ? <p className="error-text">{dataError}</p> : null}
              </form>

              <section className="panel-card panel-frame panel-table">
                <div className="panel-heading">
                  <h2>Lista de gastos</h2>
                  <p>Las entradas quedan visibles como lista editable antes de guardarlas como nueva version.</p>
                </div>

                <div className="table-wrap">
                  {expenses.length ? (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{renderSortHeader("Fecha Movimiento", "movementDate", expenseSort, setExpenseSort)}</th>
                          <th>{renderSortHeader("Nombre", "name", expenseSort, setExpenseSort)}</th>
                          <th>{renderSortHeader("Categoria", "category", expenseSort, setExpenseSort)}</th>
                          <th>{renderSortHeader("Frecuencia", "frequency", expenseSort, setExpenseSort)}</th>
                          <th>{renderSortHeader("Fecha Fin", "endDate", expenseSort, setExpenseSort)}</th>
                          <th>{renderSortHeader("Estado", "status", expenseSort, setExpenseSort)}</th>
                          <th>{renderSortHeader("Moneda", "currency", expenseSort, setExpenseSort)}</th>
                          <th>{renderSortHeader("Monto", "amount", expenseSort, setExpenseSort)}</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenses.map((expense) => (
                          <tr key={expense.id}>
                            <td>{formatDateLabel(expense.movementDate ?? expense.date)}</td>
                            <td>{expense.name ?? expense.merchantName ?? expense.detail ?? "Sin nombre"}</td>
                            <td>{expense.category || "Otros"}</td>
                            <td>{expense.frequency || "Unico"}</td>
                            <td>{expense.isRecurringIndefinite ? "Sin fin" : expense.endDate ? formatDateLabel(expense.endDate) : "No aplica"}</td>
                            <td>{expense.isRecurringIndefinite ? "Recurrente sin fin" : expense.endDate ? "Con termino" : "Unico"}</td>
                            <td>{expense.currency || "USD"}</td>
                            <td className="amount-cell">{money(expense.amount, expense.currency)}</td>
                            <td className="actions-cell">
                              <div className="table-actions">
                                <button className="secondary-button" onClick={() => editExpense(expense.id)} type="button">Modificar</button>
                                <button className="danger-button" onClick={() => deleteExpense(expense.id)} type="button">Quitar</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted-text">Todavia no hay gastos en la lista.</p>
                  )}
                </div>
              </section>
            </section>
          ) : null}

          {activeTab === "incomes" ? (
            <section className="workspace-stack incomes-stack">
              <div className="income-tab-header">
                <h2>Gestion de Ingresos</h2>
              </div>

              <form className="panel-card panel-frame entry-form income-entry-form" onSubmit={saveIncomeToDraft}>
                <div className="income-form-title">
                  <h3>{editingIncomeId ? "Modificar Ingreso" : "Registrar Nuevo Ingreso"}</h3>
                </div>

                <div className="income-form-grid">
                  <label className="income-field">
                    Nombre:
                    <input name="name" onChange={(e) => setIncomeForm((c) => ({ ...c, name: e.target.value }))} value={incomeForm.name} />
                  </label>
                  <label className="income-field">
                    Monto Neto:
                    <input inputMode="decimal" name="amount" onChange={(e) => setIncomeForm((c) => ({ ...c, amount: e.target.value }))} value={incomeForm.amount} />
                  </label>
                  <label className="income-field">
                    Moneda:
                    <select name="currency" onChange={(e) => setIncomeForm((c) => ({ ...c, currency: e.target.value }))} value={incomeForm.currency}>
                      {incomeCurrencies.map((currencyOption) => (
                        <option key={currencyOption.value} value={currencyOption.value}>
                          {currencyOption.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="income-field">
                    Frecuencia:
                    <select name="frequency" onChange={(e) => setIncomeForm((c) => ({ ...c, frequency: e.target.value }))} value={incomeForm.frequency}>
                      {incomeFrequencies.map((frequency) => (
                        <option key={frequency} value={frequency}>
                          {frequency}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="income-field">
                    Fecha Inicio / Unica:
                    <input name="startDate" onChange={(e) => setIncomeForm((c) => ({ ...c, startDate: e.target.value }))} type="date" value={incomeForm.startDate} />
                  </label>
                  <label className="income-field">
                    Fecha Fin (si aplica):
                    <input
                      disabled={incomeForm.isRecurringIndefinite}
                      name="endDate"
                      onChange={(e) => setIncomeForm((c) => ({ ...c, endDate: e.target.value }))}
                      type="date"
                      value={incomeForm.endDate}
                    />
                  </label>
                </div>

                <div className="income-checkbox-group">
                  <label className="income-checkbox">
                    <input
                      checked={incomeForm.isRecurringIndefinite}
                      name="isRecurringIndefinite"
                      onChange={(e) => setIncomeForm((c) => ({ ...c, isRecurringIndefinite: e.target.checked, endDate: e.target.checked ? "" : c.endDate }))}
                      type="checkbox"
                    />
                    Ingreso recurrente sin fin
                  </label>

                  <label className="income-checkbox">
                    <input
                      checked={incomeForm.isReimbursement}
                      name="isReimbursement"
                      onChange={(e) => setIncomeForm((c) => ({ ...c, isReimbursement: e.target.checked, reimbursementCategory: e.target.checked ? c.reimbursementCategory : "" }))}
                      type="checkbox"
                    />
                    Es un reembolso
                  </label>
                </div>

                {incomeForm.isReimbursement ? (
                  <label className="income-field income-reimbursement-field">
                    Categoria que se ajusta:
                    <select
                      name="reimbursementCategory"
                      onChange={(e) => setIncomeForm((c) => ({ ...c, reimbursementCategory: e.target.value }))}
                      value={incomeForm.reimbursementCategory}
                    >
                      <option value="" disabled>
                        -- Selecciona Categoria --
                      </option>
                      {expenseCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <div className="button-row income-button-row">
                  <button className="primary-button" type="submit">
                    {editingIncomeId ? "Actualizar ingreso" : "Agregar Ingreso"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setIncomeForm(defaultIncomeForm());
                      setEditingIncomeId("");
                    }}
                    type="button"
                  >
                    Limpiar
                  </button>
                </div>

                <div className="button-row income-button-row">
                  <button className="secondary-button" onClick={discardChanges} type="button">
                    Descartar cambios
                  </button>
                  <button className="primary-button" disabled={saveState === "saving"} onClick={() => saveVersion("ingresos")} type="button">
                    {saveState === "saving" ? "Guardando..." : "Guardar lista de ingresos"}
                  </button>
                </div>

                {successMessage ? <p className="success-text">{successMessage}</p> : null}
                {dataError ? <p className="error-text">{dataError}</p> : null}
              </form>

              <section className="panel-card panel-frame panel-table">
                <div className="panel-heading">
                  <h2>Lista de ingresos</h2>
                  <p>Los reembolsos ajustan la categoria indicada y no se suman como ingreso real.</p>
                </div>

                <div className="table-wrap">
                  {incomes.length ? (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{renderSortHeader("Fecha Inicio", "startDate", incomeSort, setIncomeSort)}</th>
                          <th>{renderSortHeader("Nombre", "name", incomeSort, setIncomeSort)}</th>
                          <th>{renderSortHeader("Tipo", "type", incomeSort, setIncomeSort)}</th>
                          <th>{renderSortHeader("Categoria Ajuste", "reimbursementCategory", incomeSort, setIncomeSort)}</th>
                          <th>{renderSortHeader("Frecuencia", "frequency", incomeSort, setIncomeSort)}</th>
                          <th>{renderSortHeader("Fecha Fin", "endDate", incomeSort, setIncomeSort)}</th>
                          <th>{renderSortHeader("Estado", "status", incomeSort, setIncomeSort)}</th>
                          <th>{renderSortHeader("Moneda", "currency", incomeSort, setIncomeSort)}</th>
                          <th>{renderSortHeader("Monto", "amount", incomeSort, setIncomeSort)}</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {incomes.map((income) => (
                          <tr key={income.id}>
                            <td>{income.startDate ? formatDateLabel(income.startDate) : formatTimestampLabel(income.createdAt)}</td>
                            <td>{income.name || "Sin nombre"}</td>
                            <td>{income.isReimbursement ? "Reembolso" : "Ingreso real"}</td>
                            <td>{income.isReimbursement ? income.reimbursementCategory || "Sin categoria" : "No aplica"}</td>
                            <td>{income.frequency || "Mensual"}</td>
                            <td>{income.isRecurringIndefinite ? "Sin fin" : income.endDate ? formatDateLabel(income.endDate) : "No aplica"}</td>
                            <td>{income.isRecurringIndefinite ? "Recurrente sin fin" : income.endDate ? "Con termino" : "Unico"}</td>
                            <td>{income.currency || "USD"}</td>
                            <td className="amount-cell">{money(income.amount, income.currency || "USD")}</td>
                            <td className="actions-cell">
                              <div className="table-actions">
                                <button className="secondary-button" onClick={() => editIncome(income.id)} type="button">Modificar</button>
                                <button className="danger-button" onClick={() => deleteIncome(income.id)} type="button">Quitar</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted-text">Todavia no hay ingresos en la lista.</p>
                  )}
                </div>
              </section>
            </section>
          ) : null}

          {activeTab === "reconciliation" ? (
            <section className="workspace-stack reconciliation-stack">
              <div className="reconciliation-tab-header">
                <h2>Gestion de Cuadre</h2>
              </div>

              <form className="panel-card panel-frame entry-form reconciliation-entry-form" onSubmit={saveAdjustmentToDraft}>
                <div className="reconciliation-form-title">
                  <h3>{editingAdjustmentId ? "Modificar Ajuste de Cuadre" : "Registrar Ajuste de Cuadre"}</h3>
                </div>

                <div className="reconciliation-form-grid">
                  <label className="reconciliation-field">
                    Fecha Ajuste:
                    <input name="date" onChange={(e) => setAdjustmentForm((c) => ({ ...c, date: e.target.value }))} type="date" value={adjustmentForm.date} />
                  </label>
                  <label className="reconciliation-field">
                    Ajuste:
                    <input inputMode="decimal" name="amount" onChange={(e) => setAdjustmentForm((c) => ({ ...c, amount: e.target.value }))} value={adjustmentForm.amount} />
                  </label>
                </div>

                <p className="reconciliation-helper">
                  Usa valores negativos o positivos para cuadrar la diferencia entre el flujo registrado y el saldo real de tu cuenta.
                </p>

                <div className="button-row reconciliation-button-row">
                  <button className="primary-button" type="submit">
                    {editingAdjustmentId ? "Actualizar cuadre" : "Agregar cuadre"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setAdjustmentForm(defaultAdjustmentForm());
                      setEditingAdjustmentId("");
                    }}
                    type="button"
                  >
                    Limpiar
                  </button>
                </div>

                <div className="button-row reconciliation-button-row">
                  <button className="secondary-button" onClick={discardChanges} type="button">
                    Descartar cambios
                  </button>
                  <button className="primary-button" disabled={saveState === "saving"} onClick={() => saveVersion("cuadres")} type="button">
                    {saveState === "saving" ? "Guardando..." : "Guardar lista de cuadres"}
                  </button>
                </div>

                {successMessage ? <p className="success-text">{successMessage}</p> : null}
                {dataError ? <p className="error-text">{dataError}</p> : null}
              </form>

              <section className="panel-card panel-frame panel-table">
                <div className="panel-heading">
                  <h2>Lista de cuadres</h2>
                  <p>Estos ajustes corrigen el saldo del flujo de caja sin sumarse como ingreso ni clasificarse como gasto.</p>
                </div>

                <div className="table-wrap">
                  {adjustments.length ? (
                    <table className="data-table reconciliation-table">
                      <thead>
                        <tr>
                          <th>{renderSortHeader("Fecha Ajuste", "date", adjustmentSort, setAdjustmentSort)}</th>
                          <th>{renderSortHeader("Categoria", "type", adjustmentSort, setAdjustmentSort)}</th>
                          <th>{renderSortHeader("Ajuste", "amount", adjustmentSort, setAdjustmentSort)}</th>
                          <th>{renderSortHeader("Impacto", "impact", adjustmentSort, setAdjustmentSort)}</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adjustments.map((adjustment) => (
                          <tr key={adjustment.id}>
                            <td>{formatDateLabel(adjustment.date)}</td>
                            <td>Cuadre</td>
                            <td className="amount-cell">{money(adjustment.amount, "USD")}</td>
                            <td>{Number(adjustment.amount) < 0 ? "Reduce saldo" : Number(adjustment.amount) > 0 ? "Aumenta saldo" : "Sin efecto"}</td>
                            <td className="actions-cell">
                              <div className="table-actions">
                                <button className="secondary-button" onClick={() => editAdjustment(adjustment.id)} type="button">Modificar</button>
                                <button className="danger-button" onClick={() => deleteAdjustment(adjustment.id)} type="button">Quitar</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted-text">Todavia no hay ajustes de cuadre en la lista.</p>
                  )}
                </div>
              </section>
            </section>
          ) : null}

          {activeTab === "cashflow" ? (
            <section className="panel-card cashflow-panel">
              <div className="panel-heading">
                <h2>Flujo de caja detallado</h2>
                <p>
                  Vista diaria del mes actual. El dia de hoy queda resaltado y el cuadro se centra automaticamente para dejarlo a la vista.
                </p>
              </div>

              <div className="cashflow-month-label">{cashflowModel.monthLabel}</div>

              <div className="cashflow-table-wrap" onMouseLeave={() => setCashflowTooltip(null)} ref={cashflowScrollRef}>
                <table className="cashflow-table">
                  <thead>
                    <tr>
                      <th className="cashflow-sticky cashflow-concept-head">Categoria / Concepto</th>
                      {cashflowModel.dates.map((date) => (
                        <th
                          className={date.key === cashflowModel.todayKey ? "cashflow-day-head today-column" : "cashflow-day-head"}
                          key={date.key}
                          ref={date.key === cashflowModel.todayKey ? currentDayColumnRef : null}
                        >
                          <span>{date.shortLabel}</span>
                          <span>{date.yearLabel}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cashflowModel.rows.map((row) => (
                      <tr className={row.className} key={row.key}>
                        <th className="cashflow-sticky cashflow-row-label">{row.label}</th>
                        {cashflowModel.dates.map((date) => (
                          <td
                            className={date.key === cashflowModel.todayKey ? "today-column" : ""}
                            key={`${row.key}-${date.key}`}
                            onMouseEnter={(event) => showCashflowTooltip(event, row, date.key)}
                            onMouseLeave={() => setCashflowTooltip(null)}
                          >
                            {formatCashflowAmount(row.values?.[date.key] ?? 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {cashflowTooltip ? (
                <div className="cashflow-tooltip" style={{ left: `${cashflowTooltip.left}px`, top: `${cashflowTooltip.top}px` }}>
                  <strong>{cashflowTooltip.title}</strong>
                  <span>{formatDateLabel(cashflowTooltip.date)}</span>
                  {cashflowTooltip.lines.length ? (
                    <div className="cashflow-tooltip-lines">
                      {cashflowTooltip.lines.map((line, index) => (
                        <p key={`${cashflowTooltip.title}-${cashflowTooltip.date}-${index}`}>{line}</p>
                      ))}
                    </div>
                  ) : (
                    <p>Sin movimientos registrados.</p>
                  )}
                  <p className="cashflow-tooltip-total">Total: {formatCashflowAmount(cashflowTooltip.total)}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          {activeTab === "charts" ? (
            <section className="panel-card blank-panel">
              <div className="panel-heading">
                <h2>Graficos</h2>
                <p>Esta pestana queda reservada para indicadores y visualizaciones.</p>
              </div>
              <p className="placeholder-copy">Cuando quieras, aqui armamos barras, lineas y distribuciones por categoria.</p>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function renderSortHeader(label, key, sortState, setSortState) {
  const isActive = sortState.key === key;
  const indicator = isActive ? (sortState.direction === "asc" ? "^" : "v") : "-";

  return (
    <button
      className={isActive ? "sort-button active" : "sort-button"}
      onClick={() => setSortState((current) => nextSortState(current, key))}
      type="button"
    >
      <span>{label}</span>
      <span className="sort-indicator">{indicator}</span>
    </button>
  );
}

function createInitialUserData(user, snapshotDate) {
  return {
    profile: createUserProfile(user),
    cashflowSnapshots: {
      [snapshotDate]: {
        versions: {
          [localId("version")]: createVersionPayload(snapshotDate, emptyWorkspace(), user),
        },
      },
    },
  };
}

function createUserProfile(user) {
  return { uid: user.uid, email: user.email ?? "", currency: "USD", createdAt: Date.now() };
}

function createVersionPayload(snapshotDate, payload, user, sourceVersion = null) {
  const savedAt = Date.now();
  return {
    snapshotDate,
    savedAt,
    createdByUid: user?.uid ?? "",
    createdByEmail: user?.email ?? "",
    sourceSnapshotDate: sourceVersion?.snapshotDate ?? null,
    sourceVersionId: sourceVersion?.versionId ?? null,
    payload: { ...sanitizeWorkspace(payload), updatedAt: savedAt },
  };
}

function emptyWorkspace() {
  return { expenses: {}, incomes: {}, adjustments: {}, updatedAt: Date.now() };
}

function defaultExpenseForm() {
  return {
    name: "",
    amount: "",
    currency: "USD",
    category: "Ahorros",
    frequency: "Unico",
    movementDate: localDate(),
    endDate: "",
    isRecurringIndefinite: false,
  };
}

function defaultIncomeForm() {
  return {
    name: "",
    amount: "",
    currency: "USD",
    frequency: "Mensual",
    startDate: localDate(),
    endDate: "",
    isRecurringIndefinite: true,
    isReimbursement: false,
    reimbursementCategory: "",
  };
}

function defaultAdjustmentForm() {
  return {
    date: localDate(),
    amount: "",
  };
}

function localId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hasWorkspaceShape(value) {
  return Boolean(value && typeof value === "object" && "expenses" in value && "incomes" in value);
}

function hasWorkspaceContent(workspace) {
  return Boolean(
    Object.keys(workspace?.expenses ?? {}).length ||
      Object.keys(workspace?.incomes ?? {}).length ||
      Object.keys(workspace?.adjustments ?? {}).length,
  );
}

function normalizeWorkspace(source) {
  if (!source) return emptyWorkspace();
  const candidate = source.payload ?? source;

  if (candidate.entries) {
    return convertLegacyEntries(candidate.entries, candidate.createdAt ?? candidate.savedAt);
  }

  return sanitizeWorkspace({
    expenses: candidate.expenses ?? {},
    incomes: candidate.incomes ?? {},
    adjustments: candidate.adjustments ?? {},
    updatedAt: candidate.updatedAt ?? candidate.savedAt ?? candidate.createdAt ?? Date.now(),
  });
}

function sanitizeWorkspace(workspace) {
  return {
    expenses: Object.fromEntries(
      Object.entries(workspace?.expenses ?? {}).map(([id, value]) => [
        id,
        {
          name: String(value?.name ?? value?.merchantName ?? value?.detail ?? "").trim(),
          amount: Number(value?.amount) || 0,
          currency: value?.currency === "CLP" ? "CLP" : "USD",
          category: expenseCategories.includes(String(value?.category ?? "")) ? String(value?.category) : "Otros",
          frequency: expenseFrequencies.includes(String(value?.frequency ?? "")) ? String(value?.frequency) : "Unico",
          movementDate: String(value?.movementDate ?? value?.date ?? localDate()),
          endDate: String(value?.endDate ?? "").trim(),
          isRecurringIndefinite: Boolean(value?.isRecurringIndefinite),
          createdAt: Number(value?.createdAt) || Date.now(),
        },
      ]),
    ),
    incomes: Object.fromEntries(
      Object.entries(workspace?.incomes ?? {}).map(([id, value]) => [
        id,
        {
          name: String(value?.name ?? "").trim(),
          amount: Number(value?.amount) || 0,
          currency: value?.currency === "CLP" ? "CLP" : "USD",
          frequency: incomeFrequencies.includes(String(value?.frequency ?? value?.recurrence ?? "")) ? String(value?.frequency ?? value?.recurrence) : "Unico",
          startDate: String(value?.startDate ?? localDate(new Date(Number(value?.createdAt) || Date.now()))),
          endDate: String(value?.endDate ?? "").trim(),
          isRecurringIndefinite: Boolean(value?.isRecurringIndefinite),
          isReimbursement: Boolean(value?.isReimbursement),
          reimbursementCategory: expenseCategories.includes(String(value?.reimbursementCategory ?? "")) ? String(value?.reimbursementCategory) : "",
          createdAt: Number(value?.createdAt) || Date.now(),
        },
      ]),
    ),
    adjustments: Object.fromEntries(
      Object.entries(workspace?.adjustments ?? {}).map(([id, value]) => [
        id,
        {
          date: String(value?.date ?? localDate()),
          amount: Number(value?.amount) || 0,
          createdAt: Number(value?.createdAt) || Date.now(),
        },
      ]),
    ),
    updatedAt: Number(workspace?.updatedAt) || Date.now(),
  };
}

function convertLegacyEntries(entries, updatedAt = Date.now()) {
  const workspace = emptyWorkspace();
  for (const [id, value] of Object.entries(entries ?? {})) {
    if (value?.type === "income") {
      workspace.incomes[id] = {
        name: String(value?.description ?? "").trim(),
        amount: Number(value?.amount) || 0,
        currency: "USD",
        frequency: "Unico",
        startDate: localDate(new Date(Number(value?.createdAt) || Date.now())),
        endDate: "",
        isRecurringIndefinite: false,
        isReimbursement: false,
        reimbursementCategory: "",
        createdAt: Number(value?.createdAt) || Date.now(),
      };
    } else {
      workspace.expenses[id] = {
        name: String(value?.description ?? "").trim(),
        amount: Number(value?.amount) || 0,
        currency: "USD",
        category: "Otros",
        frequency: "Unico",
        movementDate: localDate(new Date(Number(value?.createdAt) || Date.now())),
        endDate: "",
        isRecurringIndefinite: false,
        createdAt: Number(value?.createdAt) || Date.now(),
      };
    }
  }
  workspace.updatedAt = Number(updatedAt) || Date.now();
  return workspace;
}

function extractRecentVersions(snapshotTree) {
  const versions = [];
  for (const [snapshotDate, snapshotValue] of Object.entries(snapshotTree ?? {})) {
    if (snapshotValue?.versions) {
      for (const [versionId, version] of Object.entries(snapshotValue.versions)) {
        versions.push({
          key: buildKey(snapshotDate, versionId),
          snapshotDate,
          versionId,
          savedAt: Number(version?.savedAt) || 0,
          payload: normalizeWorkspace(version),
        });
      }
    } else if (snapshotValue) {
      versions.push({
        key: buildKey(snapshotDate, `legacy_${snapshotValue.createdAt ?? 0}`),
        snapshotDate,
        versionId: `legacy_${snapshotValue.createdAt ?? 0}`,
        savedAt: Number(snapshotValue?.createdAt) || 0,
        payload: normalizeWorkspace(snapshotValue),
      });
    }
  }
  return versions.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

function getLatestVersion(snapshotTree) {
  return extractRecentVersions(snapshotTree)[0] ?? null;
}

function buildKey(snapshotDate, versionId) {
  return `${snapshotDate}__${versionId}`;
}

function validateExpense(expense) {
  if (!String(expense.name ?? "").trim()) return "El gasto debe tener nombre.";
  if (!Number.isFinite(Number(expense.amount)) || Number(expense.amount) <= 0) return "El gasto debe tener un valor mayor que cero.";
  if (!expenseCategories.includes(String(expense.category ?? ""))) return "Selecciona una categoria valida para el gasto.";
  if (!expenseFrequencies.includes(String(expense.frequency ?? ""))) return "Selecciona una frecuencia valida para el gasto.";
  if (!String(expense.movementDate ?? "").trim()) return "El gasto debe tener fecha de movimiento.";
  return "";
}

function validateIncome(income) {
  if (!String(income.name ?? "").trim()) return "El ingreso debe tener nombre.";
  if (!Number.isFinite(Number(income.amount)) || Number(income.amount) <= 0) return "El ingreso debe tener un valor mayor que cero.";
  if (!incomeFrequencies.includes(String(income.frequency ?? ""))) return "Selecciona una frecuencia valida para el ingreso.";
  if (!String(income.startDate ?? "").trim()) return "El ingreso debe tener fecha de inicio o unica.";
  if (income.isReimbursement && !expenseCategories.includes(String(income.reimbursementCategory ?? ""))) {
    return "Selecciona la categoria que se debe ajustar con el reembolso.";
  }
  return "";
}

function validateAdjustment(adjustment) {
  if (!String(adjustment.date ?? "").trim()) return "El cuadre debe tener fecha.";
  if (!Number.isFinite(Number(adjustment.amount)) || Number(adjustment.amount) === 0) {
    return "El cuadre debe tener un valor distinto de cero.";
  }
  return "";
}

function validateWorkspace(workspace) {
  for (const expense of Object.values(workspace.expenses ?? {})) {
    const error = validateExpense(expense);
    if (error) return error;
  }
  for (const income of Object.values(workspace.incomes ?? {})) {
    const error = validateIncome(income);
    if (error) return error;
  }
  for (const adjustment of Object.values(workspace.adjustments ?? {})) {
    const error = validateAdjustment(adjustment);
    if (error) return error;
  }
  return "";
}

function nextSortState(currentSort, key) {
  if (currentSort.key === key) {
    return { key, direction: currentSort.direction === "asc" ? "desc" : "asc" };
  }

  return { key, direction: defaultSortDirection(key) };
}

function defaultSortDirection(key) {
  if (["movementDate", "startDate", "date", "endDate", "amount"].includes(key)) {
    return "desc";
  }

  return "asc";
}

function sortCollection(items, sortState, valueGetter) {
  return [...items].sort((left, right) => {
    const result = compareSortValues(valueGetter(left, sortState.key), valueGetter(right, sortState.key), sortState.direction);
    if (result !== 0) return result;
    return (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0);
  });
}

function compareSortValues(leftValue, rightValue, direction) {
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
  }

  const normalizedLeft = String(leftValue);
  const normalizedRight = String(rightValue);
  const comparison = normalizedLeft.localeCompare(normalizedRight, "es", { sensitivity: "base", numeric: true });
  return direction === "asc" ? comparison : comparison * -1;
}

function getExpenseSortValue(expense, key) {
  switch (key) {
    case "movementDate":
      return dateToTimestamp(expense.movementDate ?? expense.date);
    case "name":
      return normalizeSortText(expense.name ?? expense.merchantName ?? expense.detail);
    case "category":
      return normalizeSortText(expense.category);
    case "frequency":
      return normalizeSortText(expense.frequency);
    case "endDate":
      return expense.isRecurringIndefinite ? null : dateToTimestamp(expense.endDate);
    case "status":
      return normalizeSortText(expense.isRecurringIndefinite ? "Recurrente sin fin" : expense.endDate ? "Con termino" : "Unico");
    case "currency":
      return normalizeSortText(expense.currency);
    case "amount":
      return Number(expense.amount) || 0;
    default:
      return null;
  }
}

function getIncomeSortValue(income, key) {
  switch (key) {
    case "startDate":
      return dateToTimestamp(income.startDate) ?? (Number(income.createdAt) || 0);
    case "name":
      return normalizeSortText(income.name);
    case "type":
      return normalizeSortText(income.isReimbursement ? "Reembolso" : "Ingreso real");
    case "reimbursementCategory":
      return normalizeSortText(income.isReimbursement ? income.reimbursementCategory : "No aplica");
    case "frequency":
      return normalizeSortText(income.frequency);
    case "endDate":
      return income.isRecurringIndefinite ? null : dateToTimestamp(income.endDate);
    case "status":
      return normalizeSortText(income.isRecurringIndefinite ? "Recurrente sin fin" : income.endDate ? "Con termino" : "Unico");
    case "currency":
      return normalizeSortText(income.currency);
    case "amount":
      return Number(income.amount) || 0;
    default:
      return null;
  }
}

function getAdjustmentSortValue(adjustment, key) {
  switch (key) {
    case "date":
      return dateToTimestamp(adjustment.date);
    case "type":
      return normalizeSortText("Cuadre");
    case "amount":
      return Number(adjustment.amount) || 0;
    case "impact":
      return normalizeSortText(Number(adjustment.amount) < 0 ? "Reduce saldo" : Number(adjustment.amount) > 0 ? "Aumenta saldo" : "Sin efecto");
    default:
      return null;
  }
}

function buildCashflowModel({ expenses, incomes, adjustments, currentDateKey }) {
  const dates = getMonthDateParts(currentDateKey);
  const displayStart = dates[0]?.key ?? currentDateKey;
  const displayEnd = dates[dates.length - 1]?.key ?? currentDateKey;

  const incomeByDate = {};
  const incomeDetailsByDate = {};
  const adjustmentByDate = {};
  const adjustmentDetailsByDate = {};
  const fixedTotalByDate = {};
  const fixedDetailsByDate = {};
  const variableTotalByDate = {};
  const variableDetailsByDate = {};
  const categoryValues = Object.fromEntries(expenseCategories.map((category) => [category, {}]));
  const categoryDetails = Object.fromEntries(expenseCategories.map((category) => [category, {}]));
  const dailyImpactByDate = {};

  const registerCategoryImpact = (date, category, amount, line) => {
    increaseDateValue(dailyImpactByDate, date, amount);
    const group = getExpenseCategoryGroup(category);

    if (date < displayStart || date > displayEnd) {
      return;
    }

    increaseDateValue(categoryValues[category], date, amount);
    appendDateLine(categoryDetails[category], date, line);

    if (group === "fixed") {
      increaseDateValue(fixedTotalByDate, date, amount);
      appendDateLine(fixedDetailsByDate, date, line);
    } else {
      increaseDateValue(variableTotalByDate, date, amount);
      appendDateLine(variableDetailsByDate, date, line);
    }
  };

  for (const expense of expenses) {
    const occurrenceDates = buildRecurringDates({
      startDate: expense.movementDate ?? expense.date,
      frequency: expense.frequency,
      endDate: expense.endDate,
      isRecurringIndefinite: expense.isRecurringIndefinite,
      displayEnd,
    });

    for (const date of occurrenceDates) {
      const amount = -(Number(expense.amount) || 0);
      const category = expenseCategories.includes(String(expense.category ?? "")) ? expense.category : "Otros";
      const line = formatCashflowLine({
        amount,
        currency: expense.currency,
        label: expense.name || "Gasto",
        date,
      });
      registerCategoryImpact(date, category, amount, line);
    }
  }

  for (const income of incomes) {
    const occurrenceDates = buildRecurringDates({
      startDate: income.startDate,
      frequency: income.frequency,
      endDate: income.endDate,
      isRecurringIndefinite: income.isRecurringIndefinite,
      displayEnd,
    });

    for (const date of occurrenceDates) {
      const amount = Number(income.amount) || 0;

      if (income.isReimbursement) {
        const category = expenseCategories.includes(String(income.reimbursementCategory ?? "")) ? income.reimbursementCategory : "Otros";
        const line = formatCashflowLine({
          amount,
          currency: income.currency,
          label: `Reembolso ${income.name || "sin nombre"}`,
          date,
        });
        registerCategoryImpact(date, category, amount, line);
        continue;
      }

      increaseDateValue(dailyImpactByDate, date, amount);
      if (date < displayStart || date > displayEnd) continue;

      increaseDateValue(incomeByDate, date, amount);
      appendDateLine(
        incomeDetailsByDate,
        date,
        formatCashflowLine({
          amount,
          currency: income.currency,
          label: income.name || "Ingreso",
          date,
        }),
      );
    }
  }

  for (const adjustment of adjustments) {
    const date = adjustment.date;
    const amount = Number(adjustment.amount) || 0;
    increaseDateValue(dailyImpactByDate, date, amount);

    if (date < displayStart || date > displayEnd) continue;

    increaseDateValue(adjustmentByDate, date, amount);
    appendDateLine(
      adjustmentDetailsByDate,
      date,
      formatCashflowLine({
        amount,
        currency: "USD",
        label: "Cuadre manual",
        date,
      }),
    );
  }

  const openingBalanceByDate = {};
  const openingDetailsByDate = {};
  const netFlowByDate = {};
  const netFlowDetailsByDate = {};
  const closingBalanceByDate = {};
  const closingDetailsByDate = {};

  let runningBalance = Object.entries(dailyImpactByDate)
    .filter(([date]) => date < displayStart)
    .reduce((sum, [, amount]) => sum + (Number(amount) || 0), 0);

  for (const date of dates.map((item) => item.key)) {
    const opening = runningBalance;
    const income = incomeByDate[date] ?? 0;
    const fixedTotal = fixedTotalByDate[date] ?? 0;
    const variableTotal = variableTotalByDate[date] ?? 0;
    const netFlow = income + fixedTotal + variableTotal;
    const adjustment = adjustmentByDate[date] ?? 0;
    const closing = opening + netFlow + adjustment;

    openingBalanceByDate[date] = opening;
    netFlowByDate[date] = netFlow;
    closingBalanceByDate[date] = closing;

    openingDetailsByDate[date] = {
      lines: opening ? [`Saldo acumulado hasta ayer: ${formatCashflowAmount(opening)}`] : ["Sin arrastre previo."],
      total: opening,
    };

    const flowLines = [
      ...(incomeDetailsByDate[date] ?? []),
      ...(fixedDetailsByDate[date] ?? []),
      ...(variableDetailsByDate[date] ?? []),
    ];

    netFlowDetailsByDate[date] = {
      lines: flowLines.length ? flowLines : ["Sin movimientos de flujo."],
      total: netFlow,
    };

    closingDetailsByDate[date] = {
      lines: [
        `Saldo inicial: ${formatCashflowAmount(opening)}`,
        `Flujo neto: ${formatCashflowAmount(netFlow)}`,
        `Cuadre: ${formatCashflowAmount(adjustment)}`,
      ],
      total: closing,
    };

    runningBalance = closing;
  }

  const rows = [
    makeCashflowRow("openingBalance", "Saldo Inicial", openingBalanceByDate, openingDetailsByDate, "cashflow-balance-row"),
    makeCashflowRow("incomeNet", "Ingreso Total Neto", incomeByDate, buildRowDetails(incomeDetailsByDate, incomeByDate, "Sin ingresos reales."), "cashflow-summary-row"),
    ...fixedExpenseCategories.map((category) =>
      makeCashflowRow(category, category, categoryValues[category], buildRowDetails(categoryDetails[category], categoryValues[category], "Sin movimientos.")),
    ),
    makeCashflowRow("fixedTotal", "Total Gastos Fijos", fixedTotalByDate, buildRowDetails(fixedDetailsByDate, fixedTotalByDate, "Sin gastos fijos."), "cashflow-total-row"),
    ...variableExpenseCategories.map((category) =>
      makeCashflowRow(category, category, categoryValues[category], buildRowDetails(categoryDetails[category], categoryValues[category], "Sin movimientos.")),
    ),
    makeCashflowRow(
      "variableTotal",
      "Total Gastos Variables",
      variableTotalByDate,
      buildRowDetails(variableDetailsByDate, variableTotalByDate, "Sin gastos variables."),
      "cashflow-total-row",
    ),
    makeCashflowRow("netFlow", "Flujo Neto del Periodo", netFlowByDate, netFlowDetailsByDate, "cashflow-total-row"),
    makeCashflowRow(
      "reconciliation",
      "Cuadre",
      adjustmentByDate,
      buildRowDetails(adjustmentDetailsByDate, adjustmentByDate, "Sin ajustes de cuadre."),
      "cashflow-total-row",
    ),
    makeCashflowRow("closingBalance", "Saldo Final Estimado", closingBalanceByDate, closingDetailsByDate, "cashflow-final-row"),
  ];

  return {
    dates,
    rows,
    todayKey: currentDateKey,
    monthLabel: new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(parseDateKey(currentDateKey)),
  };
}

function makeCashflowRow(key, label, values, details, className = "") {
  return {
    key,
    label,
    values,
    details,
    className,
  };
}

function buildRowDetails(linesByDate, totalsByDate, emptyLabel) {
  const details = {};

  for (const date of new Set([...Object.keys(linesByDate ?? {}), ...Object.keys(totalsByDate ?? {})])) {
    details[date] = {
      lines: linesByDate?.[date]?.length ? linesByDate[date] : [emptyLabel],
      total: totalsByDate?.[date] ?? 0,
    };
  }

  return details;
}

function buildEmptyCashflowDetails(label, date) {
  if (label === "Saldo Inicial") {
    return { lines: ["Sin arrastre previo."], total: 0 };
  }

  return { lines: ["Sin movimientos registrados."], total: 0 };
}

function getMonthDateParts(dateKey) {
  const baseDate = parseDateKey(dateKey);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const formatter = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit" });

  return Array.from({ length: totalDays }, (_, index) => {
    const current = new Date(year, month, index + 1);
    return {
      key: localDate(current),
      shortLabel: formatter.format(current),
      yearLabel: String(year),
    };
  });
}

function buildRecurringDates({ startDate, frequency, endDate, isRecurringIndefinite, displayEnd }) {
  if (!startDate) return [];

  const start = parseDateKey(startDate);
  const limit = parseDateKey(displayEnd);
  const explicitEnd = endDate ? parseDateKey(endDate) : null;

  if (Number.isNaN(start.getTime()) || Number.isNaN(limit.getTime()) || start > limit) {
    return [];
  }

  if (frequency === "Unico") {
    return [localDate(start)];
  }

  if (!isRecurringIndefinite && !explicitEnd) {
    return [localDate(start)];
  }

  const effectiveEnd = explicitEnd && explicitEnd < limit ? explicitEnd : limit;
  const anchorDay = start.getDate();
  const dates = [];
  let current = new Date(start);
  let guard = 0;

  while (current <= effectiveEnd && guard < 5000) {
    dates.push(localDate(current));

    if (frequency === "Semanal") {
      current = addDays(current, 7);
    } else if (frequency === "Bi-semanal") {
      current = addDays(current, 14);
    } else if (frequency === "Mensual") {
      current = addMonthsPreservingDay(current, anchorDay);
    } else {
      break;
    }

    guard += 1;
  }

  return dates;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonthsPreservingDay(date, desiredDay) {
  const nextMonthIndex = date.getMonth() + 1;
  const nextYear = date.getFullYear() + Math.floor(nextMonthIndex / 12);
  const nextMonth = nextMonthIndex % 12;
  const lastDay = new Date(nextYear, nextMonth + 1, 0).getDate();
  return new Date(nextYear, nextMonth, Math.min(desiredDay, lastDay));
}

function parseDateKey(value) {
  return new Date(`${value}T00:00:00`);
}

function getExpenseCategoryGroup(category) {
  return expenseCategoryGroups[category] ?? "variable";
}

function increaseDateValue(target, date, amount) {
  target[date] = (target[date] ?? 0) + (Number(amount) || 0);
}

function appendDateLine(target, date, line) {
  if (!target[date]) {
    target[date] = [];
  }

  target[date].push(line);
}

function formatCashflowLine({ amount, currency, label, date }) {
  return `${money(amount, currency || "USD")} - ${label} (${date})`;
}

function formatCashflowAmount(value) {
  return money(value, "USD");
}

function normalizeSortText(value) {
  const text = String(value ?? "").trim();
  return text ? text.toLocaleLowerCase("es") : null;
}

function dateToTimestamp(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value, currency) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: currency === "CLP" ? 0 : 2,
  }).format(Number(value) || 0);
}

function labelVersion(version) {
  return `${version.snapshotDate} | ${new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.savedAt))}`;
}

function toUsdAmount(expense) {
  return Number(expense.amount) || 0;
}

function formatDateLabel(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short" }).format(date);
}

function formatTimestampLabel(value) {
  if (!value) return "Sin fecha";
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short" }).format(date);
}

